package omscore

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"

	"github.com/router-for-me/CLIProxyAPI/v7/internal/registry"
	"github.com/router-for-me/CLIProxyAPI/v7/sdk/api/handlers"
	coreauth "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/auth"
	coreexecutor "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/executor"
	sdkconfig "github.com/router-for-me/CLIProxyAPI/v7/sdk/config"
)

// Account is policy metadata. Credential bytes remain owned by the auth core.
type Account struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	AuthID   string `json:"-"`
	Provider string `json:"provider"`
	Model    string `json:"model"`
	Disabled bool   `json:"disabled"`
}

type CoreModel struct {
	ID       string `json:"id"`
	Provider string `json:"provider"`
}

type Runtime interface {
	Models() []CoreModel
	Current() (Account, bool)
	Select(string) error
	SelectModel(string, string) error
	Execute(context.Context, string, string, []byte) ([]byte, http.Header, string, error)
	ExecuteStream(context.Context, string, string, []byte) (<-chan []byte, <-chan error, http.Header, string, error)
}

type MockCore struct {
	mu       sync.RWMutex
	accounts map[string]Account
	active   string
	manager  *coreauth.Manager
	handler  *handlers.BaseAPIHandler
	executor *mockExecutor
	closed   bool
}

type mockExecutor struct {
	mu  sync.Mutex
	ids []string
}

func (*mockExecutor) Identifier() string { return "mock-provider" }
func (e *mockExecutor) Execute(_ context.Context, auth *coreauth.Auth, _ coreexecutor.Request, _ coreexecutor.Options) (coreexecutor.Response, error) {
	e.mu.Lock()
	e.ids = append(e.ids, auth.ID)
	e.mu.Unlock()
	return coreexecutor.Response{Payload: []byte(fmt.Sprintf(`{"id":"mock","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":%q},"finish_reason":"stop"}]}`, "served by "+auth.ID))}, nil
}
func (e *mockExecutor) ExecuteStream(_ context.Context, auth *coreauth.Auth, _ coreexecutor.Request, _ coreexecutor.Options) (*coreexecutor.StreamResult, error) {
	e.mu.Lock()
	e.ids = append(e.ids, auth.ID)
	e.mu.Unlock()
	chunks := make(chan coreexecutor.StreamChunk, 2)
	chunks <- coreexecutor.StreamChunk{Payload: []byte(fmt.Sprintf("data: {\"account\":%q}\n", auth.ID))}
	chunks <- coreexecutor.StreamChunk{Payload: []byte("data: [DONE]\n\n")}
	close(chunks)
	return &coreexecutor.StreamResult{Chunks: chunks}, nil
}
func (*mockExecutor) Refresh(_ context.Context, auth *coreauth.Auth) (*coreauth.Auth, error) {
	return auth, nil
}
func (*mockExecutor) CountTokens(context.Context, *coreauth.Auth, coreexecutor.Request, coreexecutor.Options) (coreexecutor.Response, error) {
	return coreexecutor.Response{}, errors.New("mock token counting is intentionally unsupported")
}
func (*mockExecutor) HttpRequest(context.Context, *coreauth.Auth, *http.Request) (*http.Response, error) {
	return nil, errors.New("mock HTTP is intentionally unsupported")
}
func (e *mockExecutor) ExecutedIDs() []string {
	e.mu.Lock()
	defer e.mu.Unlock()
	return append([]string(nil), e.ids...)
}

func NewMockCore(accounts []Account) (*MockCore, error) {
	if len(accounts) == 0 {
		return nil, errors.New("at least one mock account is required")
	}
	executor := &mockExecutor{}
	manager := coreauth.NewManager(nil, nil, nil)
	manager.RegisterExecutor(executor)
	core := &MockCore{accounts: make(map[string]Account), manager: manager, executor: executor}
	for _, account := range accounts {
		if account.Name == "" || account.AuthID == "" || account.Provider != executor.Identifier() || account.Model == "" {
			core.Close()
			return nil, fmt.Errorf("invalid mock account %q", account.Name)
		}
		if _, exists := core.accounts[account.Name]; exists {
			core.Close()
			return nil, fmt.Errorf("duplicate mock account %q", account.Name)
		}
		auth := &coreauth.Auth{ID: account.AuthID, Provider: account.Provider, Status: coreauth.StatusActive, Disabled: account.Disabled}
		if account.Disabled {
			auth.Status = coreauth.StatusDisabled
		}
		if _, err := manager.Register(context.Background(), auth); err != nil {
			core.Close()
			return nil, err
		}
		registry.GetGlobalRegistry().RegisterClient(account.AuthID, account.Provider, []*registry.ModelInfo{{ID: account.Model}})
		if account.ID == "" {
			account.ID = account.Name
		}
		core.accounts[account.Name] = account
		if core.active == "" && !account.Disabled {
			core.active = account.Name
		}
	}
	core.handler = handlers.NewBaseAPIHandlers(&sdkconfig.SDKConfig{}, manager)
	return core, nil
}

func (c *MockCore) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return
	}
	for _, account := range c.accounts {
		registry.GetGlobalRegistry().UnregisterClient(account.AuthID)
	}
	c.closed = true
}
func (c *MockCore) Select(name string) error { return c.SelectModel(name, "") }
func (c *MockCore) SelectModel(name, model string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return errors.New("core is closed")
	}
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
	if model != "" && model != account.Model {
		return fmt.Errorf("account %q does not provide model %q", name, model)
	}
	c.active = selectedKey
	return nil
}
func (c *MockCore) Models() []CoreModel {
	seen := make(map[string]bool)
	out := []CoreModel{}
	for _, account := range c.accounts {
		key := account.Provider + "\x00" + account.Model
		if !seen[key] {
			seen[key] = true
			out = append(out, CoreModel{ID: account.Model, Provider: account.Provider})
		}
	}
	return out
}
func (c *MockCore) Current() (Account, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	account, ok := c.accounts[c.active]
	return account, ok && !c.closed
}
func (c *MockCore) Execute(ctx context.Context, protocol, model string, body []byte) ([]byte, http.Header, string, error) {
	account, ok := c.Current()
	if !ok {
		return nil, nil, "", errors.New("no account selected")
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
func (c *MockCore) ExecuteStream(ctx context.Context, protocol, model string, body []byte) (<-chan []byte, <-chan error, http.Header, string, error) {
	account, ok := c.Current()
	if !ok {
		return nil, nil, nil, "", errors.New("no account selected")
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
				errs <- chunk.Err
				return
			}
			chunks <- chunk.Payload
		}
	}()
	return chunks, errs, stream.Headers, account.Name, nil
}
func (c *MockCore) ExecutedIDs() []string                      { return c.executor.ExecutedIDs() }
func (c *MockCore) Handler(token string) (http.Handler, error) { return NewHandler(c, token) }

func NewHandler(runtime Runtime, token string) (http.Handler, error) {
	if len(token) < 32 {
		return nil, errors.New("sidecar bearer token must be at least 32 characters")
	}
	authorized := func(request *http.Request) bool {
		given, expected := []byte(request.Header.Get("Authorization")), []byte("Bearer "+token)
		return len(given) == len(expected) && subtle.ConstantTimeCompare(given, expected) == 1
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/models", func(writer http.ResponseWriter, request *http.Request) {
		if !authorized(request) {
			http.Error(writer, "unauthorized", http.StatusUnauthorized)
			return
		}
		models := runtime.Models()
		data := make([]map[string]any, 0, len(models))
		for _, model := range models {
			data = append(data, map[string]any{"id": model.ID, "object": "model", "owned_by": model.Provider})
		}
		writeJSON(writer, http.StatusOK, map[string]any{"object": "list", "data": data})
	})
	mux.HandleFunc("GET /v1/oms/accounts", func(writer http.ResponseWriter, request *http.Request) {
		if !authorized(request) {
			http.Error(writer, "unauthorized", http.StatusUnauthorized)
			return
		}
		if lister, ok := runtime.(interface{ Accounts() []Account }); ok {
			writeJSON(writer, http.StatusOK, map[string]any{"accounts": lister.Accounts()})
			return
		}
		account, ok := runtime.Current()
		if !ok {
			writeJSON(writer, http.StatusOK, map[string]any{"accounts": []Account{}})
			return
		}
		writeJSON(writer, http.StatusOK, map[string]any{"accounts": []Account{account}})
	})
	mux.HandleFunc("GET /v1/oms/status", func(writer http.ResponseWriter, request *http.Request) {
		if !authorized(request) {
			http.Error(writer, "unauthorized", http.StatusUnauthorized)
			return
		}
		account, ok := runtime.Current()
		if !ok {
			http.Error(writer, "no account selected", http.StatusServiceUnavailable)
			return
		}
		writeJSON(writer, http.StatusOK, map[string]any{"current_account": account})
	})
	mux.HandleFunc("PUT /v1/oms/account", func(writer http.ResponseWriter, request *http.Request) {
		if !authorized(request) {
			http.Error(writer, "unauthorized", http.StatusUnauthorized)
			return
		}
		request.Body = http.MaxBytesReader(writer, request.Body, 4096)
		var payload struct {
			Account string `json:"account"`
			Model   string `json:"model"`
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil || strings.TrimSpace(payload.Account) == "" {
			writeJSON(writer, http.StatusBadRequest, map[string]any{"error": "invalid account selection"})
			return
		}
		if err := runtime.SelectModel(payload.Account, payload.Model); err != nil {
			writeJSON(writer, http.StatusNotFound, map[string]any{"error": err.Error()})
			return
		}
		writeJSON(writer, http.StatusOK, map[string]any{"current_account": payload.Account})
	})
	handleModel := func(protocol string) http.HandlerFunc {
		return func(writer http.ResponseWriter, request *http.Request) {
			if !authorized(request) {
				http.Error(writer, "unauthorized", http.StatusUnauthorized)
				return
			}
			request.Body = http.MaxBytesReader(writer, request.Body, 32<<20)
			body, err := io.ReadAll(request.Body)
			if err != nil {
				writeJSON(writer, http.StatusBadRequest, map[string]any{"error": "invalid request"})
				return
			}
			var payload struct {
				Model  string `json:"model"`
				Stream bool   `json:"stream"`
			}
			if json.Unmarshal(body, &payload) != nil || payload.Model == "" {
				writeJSON(writer, http.StatusBadRequest, map[string]any{"error": "model is required"})
				return
			}
			if payload.Stream {
				chunks, errs, headers, account, err := runtime.ExecuteStream(request.Context(), protocol, payload.Model, body)
				if err != nil {
					writeJSON(writer, http.StatusConflict, map[string]any{"error": "selected account unavailable"})
					return
				}
				copyHeaders(writer.Header(), headers)
				writer.Header().Set("Content-Type", "text/event-stream")
				writer.Header().Set("X-OMS-Account", account)
				writer.WriteHeader(http.StatusOK)
				flusher, _ := writer.(http.Flusher)
				sawDone := false
				for chunks != nil || errs != nil {
					select {
					case chunk, ok := <-chunks:
						if !ok {
							chunks = nil
							continue
						}
						trimmed := bytes.TrimSpace(chunk)
						if bytes.Contains(trimmed, []byte("[DONE]")) {
							sawDone = true
						}
						if bytes.HasPrefix(trimmed, []byte("data:")) || bytes.HasPrefix(trimmed, []byte("event:")) {
							_, _ = writer.Write(chunk)
							if !bytes.HasSuffix(chunk, []byte("\n\n")) {
								if bytes.HasSuffix(chunk, []byte("\n")) {
									_, _ = writer.Write([]byte("\n"))
								} else {
									_, _ = writer.Write([]byte("\n\n"))
								}
							}
						} else if len(trimmed) > 0 {
							_, _ = writer.Write([]byte("data: "))
							_, _ = writer.Write(trimmed)
							_, _ = writer.Write([]byte("\n\n"))
						}
						if flusher != nil {
							flusher.Flush()
						}
					case streamErr, ok := <-errs:
						if !ok {
							errs = nil
							continue
						}
						if streamErr != nil {
							_, _ = writer.Write([]byte("data: {\"error\":\"upstream stream failed\"}\n\n"))
							return
						}
					case <-request.Context().Done():
						return
					}
				}
				if protocol != "claude" && !sawDone {
					_, _ = writer.Write([]byte("data: [DONE]\n\n"))
					if flusher != nil {
						flusher.Flush()
					}
				}
				return
			}
			response, headers, account, err := runtime.Execute(request.Context(), protocol, payload.Model, body)
			if err != nil {
				writeJSON(writer, http.StatusConflict, map[string]any{"error": "selected account unavailable"})
				return
			}
			copyHeaders(writer.Header(), headers)
			writer.Header().Set("Content-Type", "application/json")
			writer.Header().Set("X-OMS-Account", account)
			writer.WriteHeader(http.StatusOK)
			_, _ = writer.Write(response)
		}
	}
	mux.HandleFunc("POST /v1/chat/completions", handleModel("openai"))
	mux.HandleFunc("POST /v1/responses", handleModel("openai-response"))
	mux.HandleFunc("POST /v1/messages", handleModel("claude"))
	return mux, nil
}

func copyHeaders(destination, source http.Header) {
	for key, values := range source {
		for _, value := range values {
			destination.Add(key, value)
		}
	}
}
func writeJSON(writer http.ResponseWriter, status int, payload any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(payload)
}
