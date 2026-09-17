package omscore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v7/internal/registry"
	"github.com/router-for-me/CLIProxyAPI/v7/sdk/api/handlers"
	sdkauth "github.com/router-for-me/CLIProxyAPI/v7/sdk/auth"
	"github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy"
	coreauth "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/auth"
	sdkconfig "github.com/router-for-me/CLIProxyAPI/v7/sdk/config"
)

// ProductionCore embeds CLIProxyAPI's lifecycle and shares its auth manager with
// the OMS exact-account facade. It never parses provider token bytes itself.
type ProductionCore struct {
	mu        sync.RWMutex
	accounts  map[string]Account
	active    string
	manager   *coreauth.Manager
	handler   *handlers.BaseAPIHandler
	service   *cliproxy.Service
	started   chan struct{}
	startOnce sync.Once
	statePath string
}

func NewProductionCore(configPath, managementPassword string) (*ProductionCore, error) {
	cfg, err := sdkconfig.LoadConfig(configPath)
	if err != nil {
		return nil, fmt.Errorf("load core config: %w", err)
	}
	if cfg.Host != "127.0.0.1" && cfg.Host != "localhost" && cfg.Host != "::1" {
		return nil, errors.New("core service must bind to loopback")
	}
	tokenStore := sdkauth.GetTokenStore()
	if setter, ok := tokenStore.(interface{ SetBaseDir(string) }); ok {
		setter.SetBaseDir(cfg.AuthDir)
	}
	manager := coreauth.NewManager(tokenStore, nil, nil)
	core := &ProductionCore{accounts: make(map[string]Account), manager: manager, handler: handlers.NewBaseAPIHandlers(&cfg.SDKConfig, manager), started: make(chan struct{}), statePath: filepath.Join(filepath.Dir(configPath), "active.json")}
	service, err := cliproxy.NewBuilder().WithConfig(cfg).WithConfigPath(configPath).WithCoreAuthManager(manager).WithLocalManagementPassword(managementPassword).WithHooks(cliproxy.Hooks{OnAfterStart: func(*cliproxy.Service) { core.RefreshAccounts(); core.startOnce.Do(func() { close(core.started) }) }}).Build()
	if err != nil {
		return nil, fmt.Errorf("build core service: %w", err)
	}
	core.service = service
	return core, nil
}

func (c *ProductionCore) Run(ctx context.Context) error      { return c.service.Run(ctx) }
func (c *ProductionCore) Shutdown(ctx context.Context) error { return c.service.Shutdown(ctx) }
func (c *ProductionCore) WaitStarted(ctx context.Context) error {
	select {
	case <-c.started:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func authDisplayName(auth *coreauth.Auth) string {
	if label := strings.TrimSpace(auth.Label); label != "" {
		return label
	}
	for _, key := range []string{"email", "account", "account_id"} {
		if value, ok := auth.Metadata[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return auth.ID
}

func (c *ProductionCore) RefreshAccounts() []Account {
	c.mu.Lock()
	defer c.mu.Unlock()
	next := make(map[string]Account)
	models := make(map[string]string, len(c.accounts))
	for _, existing := range c.accounts {
		if existing.Model != "" {
			models[existing.AuthID] = existing.Model
		}
	}
	for _, auth := range c.manager.List() {
		if auth == nil {
			continue
		}
		auth.EnsureIndex()
		name := authDisplayName(auth)
		if _, exists := next[name]; exists {
			name = fmt.Sprintf("%s [%s:%s]", name, auth.Provider, auth.Index)
		}
		next[name] = Account{ID: auth.Index, Name: name, AuthID: auth.ID, Provider: auth.Provider, Model: models[auth.ID], Disabled: auth.Disabled || auth.Unavailable || auth.Status == coreauth.StatusDisabled || auth.Status == coreauth.StatusError}
	}
	c.accounts = next
	activeExists := false
	for _, account := range next {
		if account.ID == c.active {
			activeExists = true
			break
		}
	}
	if !activeExists {
		c.active = ""
	}
	if c.active == "" {
		c.restoreSelectionLocked()
	}
	out := make([]Account, 0, len(next))
	for _, account := range next {
		out = append(out, account)
	}
	return out
}

func (c *ProductionCore) Accounts() []Account { return c.RefreshAccounts() }
func accountModels(account Account) []*registry.ModelInfo {
	models := registry.GetGlobalRegistry().GetModelsForClient(account.AuthID)
	// Disabled credentials are removed from the shared registry. OMS still needs their
	// provider catalogue so users can configure the model before quota resets.
	if len(models) == 0 && account.Provider == "claude" {
		return registry.GetClaudeModels()
	}
	return models
}

func (c *ProductionCore) Models() []CoreModel {
	seen := make(map[string]bool)
	out := []CoreModel{}
	for _, account := range c.RefreshAccounts() {
		for _, info := range accountModels(account) {
			if info == nil {
				continue
			}
			key := account.Provider + "\x00" + info.ID
			if !seen[key] {
				seen[key] = true
				out = append(out, CoreModel{ID: info.ID, Provider: account.Provider})
			}
		}
	}
	return out
}
func (c *ProductionCore) Current() (Account, bool) {
	find := func() (Account, bool) {
		for _, account := range c.accounts {
			if account.ID == c.active {
				return account, true
			}
		}
		return Account{}, false
	}
	c.mu.RLock()
	account, ok := find()
	c.mu.RUnlock()
	if ok {
		return account, true
	}
	c.RefreshAccounts()
	c.mu.RLock()
	defer c.mu.RUnlock()
	return find()
}
func (c *ProductionCore) Select(name string) error { return c.SelectModel(name, "") }
func (c *ProductionCore) SelectModel(name, model string) error {
	c.RefreshAccounts()
	c.mu.Lock()
	defer c.mu.Unlock()
	account, ok := c.accounts[name]
	selectedKey := name
	if !ok {
		for key, candidate := range c.accounts {
			if candidate.ID == name {
				account, ok, selectedKey = candidate, true, key
				break
			}
		}
	}
	if !ok {
		return fmt.Errorf("unknown account %q", name)
	}
	if account.Disabled {
		return fmt.Errorf("account %q is disabled", name)
	}
	if model != "" {
		supported := false
		for _, info := range accountModels(account) {
			if info != nil && info.ID == model {
				supported = true
				break
			}
		}
		if !supported {
			return fmt.Errorf("account %q does not provide model %q", name, model)
		}
		account.Model = model
		c.accounts[selectedKey] = account
	}
	if account.Model == "" {
		return fmt.Errorf("model required for account %q", name)
	}
	c.active = account.ID
	return c.persistSelectionLocked(account)
}

func (c *ProductionCore) persistSelectionLocked(account Account) error {
	if c.statePath == "" {
		return nil
	}
	data, err := json.Marshal(struct {
		Account string `json:"account"`
		Model   string `json:"model"`
	}{account.ID, account.Model})
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(c.statePath), 0o700); err != nil {
		return err
	}
	tmp := c.statePath + ".tmp"
	if err := os.WriteFile(tmp, append(data, '\n'), 0o600); err != nil {
		return err
	}
	if err := os.Chmod(tmp, 0o600); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, c.statePath)
}

func (c *ProductionCore) restoreSelectionLocked() {
	if c.statePath == "" {
		return
	}
	var state struct {
		Account string `json:"account"`
		Model   string `json:"model"`
	}
	data, err := os.ReadFile(c.statePath)
	if err != nil || json.Unmarshal(data, &state) != nil || state.Account == "" || state.Model == "" {
		return
	}
	for key, account := range c.accounts {
		if account.ID != state.Account || account.Disabled {
			continue
		}
		for _, info := range accountModels(account) {
			if info != nil && info.ID == state.Model {
				account.Model = state.Model
				c.accounts[key] = account
				c.active = account.ID
				return
			}
		}
	}
}

func (c *ProductionCore) Execute(ctx context.Context, protocol, model string, body []byte) ([]byte, http.Header, string, error) {
	c.RefreshAccounts()
	account, ok := c.Current()
	if !ok {
		return nil, nil, "", errors.New("no account selected")
	}
	if account.Disabled {
		return nil, nil, account.Name, errors.New("selected account unavailable")
	}
	if model != account.Model {
		return nil, nil, account.Name, fmt.Errorf("selected account does not provide model %q", model)
	}
	response, errMessage := c.handler.ExecuteModel(ctx, handlers.ModelExecutionRequest{EntryProtocol: protocol, ExitProtocol: protocol, Model: model, Body: body, ForcedProvider: account.Provider, AuthID: account.AuthID})
	if errMessage != nil {
		return nil, nil, account.Name, errors.New("selected account unavailable")
	}
	return response.Body, response.Headers, account.Name, nil
}
func (c *ProductionCore) ExecuteStream(ctx context.Context, protocol, model string, body []byte) (<-chan []byte, <-chan error, http.Header, string, error) {
	c.RefreshAccounts()
	account, ok := c.Current()
	if !ok {
		return nil, nil, nil, "", errors.New("no account selected")
	}
	if account.Disabled {
		return nil, nil, nil, account.Name, errors.New("selected account unavailable")
	}
	if model != account.Model {
		return nil, nil, nil, account.Name, fmt.Errorf("selected account does not provide model %q", model)
	}
	stream, errMessage := c.handler.ExecuteModelStream(ctx, handlers.ModelExecutionRequest{EntryProtocol: protocol, ExitProtocol: protocol, Model: model, Stream: true, Body: body, ForcedProvider: account.Provider, AuthID: account.AuthID})
	if errMessage != nil {
		return nil, nil, nil, account.Name, errors.New("selected account unavailable")
	}
	chunks, errs := make(chan []byte), make(chan error, 1)
	go func() {
		defer close(chunks)
		defer close(errs)
		for chunk := range stream.Chunks {
			if chunk.Err != nil {
				select {
				case errs <- chunk.Err:
				case <-ctx.Done():
				}
				return
			}
			if len(chunk.Payload) > 0 {
				select {
				case chunks <- append([]byte(nil), chunk.Payload...):
				case <-ctx.Done():
					return
				}
			}
		}
	}()
	return chunks, errs, stream.Headers, account.Name, nil
}

func (c *ProductionCore) WaitForAccounts(ctx context.Context) error {
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		if len(c.RefreshAccounts()) > 0 {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}
