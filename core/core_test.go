package omscore

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v7/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v7/internal/registry"
	"github.com/router-for-me/CLIProxyAPI/v7/sdk/api/handlers"
	sdkauth "github.com/router-for-me/CLIProxyAPI/v7/sdk/auth"
	coreauth "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/auth"
	coreexecutor "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/executor"
	sdkconfig "github.com/router-for-me/CLIProxyAPI/v7/sdk/config"
)

type fakeAuthenticator struct{ record *coreauth.Auth }

func (*fakeAuthenticator) Provider() string { return "fake-provider" }
func (f *fakeAuthenticator) Login(context.Context, *config.Config, *sdkauth.LoginOptions) (*coreauth.Auth, error) {
	return f.record, nil
}
func (*fakeAuthenticator) RefreshLead() *time.Duration { return nil }

type captureExecutor struct {
	mu  sync.Mutex
	ids []string
}

func (*captureExecutor) Identifier() string { return "test-provider" }
func (e *captureExecutor) Execute(_ context.Context, auth *coreauth.Auth, _ coreexecutor.Request, _ coreexecutor.Options) (coreexecutor.Response, error) {
	e.mu.Lock()
	e.ids = append(e.ids, auth.ID)
	e.mu.Unlock()
	return coreexecutor.Response{Payload: []byte(`{"ok":true}`)}, nil
}
func (*captureExecutor) ExecuteStream(context.Context, *coreauth.Auth, coreexecutor.Request, coreexecutor.Options) (*coreexecutor.StreamResult, error) {
	return nil, errors.New("unused")
}
func (*captureExecutor) Refresh(_ context.Context, auth *coreauth.Auth) (*coreauth.Auth, error) {
	return auth, nil
}
func (*captureExecutor) CountTokens(context.Context, *coreauth.Auth, coreexecutor.Request, coreexecutor.Options) (coreexecutor.Response, error) {
	return coreexecutor.Response{}, errors.New("unused")
}
func (*captureExecutor) HttpRequest(context.Context, *coreauth.Auth, *http.Request) (*http.Response, error) {
	return nil, errors.New("unused")
}
func (e *captureExecutor) last() string {
	e.mu.Lock()
	defer e.mu.Unlock()
	if len(e.ids) == 0 {
		return ""
	}
	return e.ids[len(e.ids)-1]
}
func (e *captureExecutor) count() int { e.mu.Lock(); defer e.mu.Unlock(); return len(e.ids) }

func TestCentralLoginManagerPersistsProviderCredential(t *testing.T) {
	dir := t.TempDir()
	record := &coreauth.Auth{ID: "fake.json", FileName: "fake.json", Provider: "fake-provider", Metadata: map[string]any{"type": "fake-provider", "email": "user@example.test", "access_token": "fake-token"}}
	store := sdkauth.NewFileTokenStore()
	store.SetBaseDir(dir)
	manager := sdkauth.NewManager(store, &fakeAuthenticator{record: record})
	got, path, err := manager.Login(context.Background(), "fake-provider", &config.Config{AuthDir: dir}, &sdkauth.LoginOptions{NoBrowser: true})
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != record.ID || path != filepath.Join(dir, record.FileName) {
		t.Fatalf("unexpected login result: auth=%+v path=%q", got, path)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var saved map[string]any
	if err := json.Unmarshal(data, &saved); err != nil {
		t.Fatal(err)
	}
	if saved["email"] != "user@example.test" {
		t.Fatalf("persisted identity = %#v", saved["email"])
	}
	if _, _, err := manager.Login(context.Background(), "missing-provider", &config.Config{AuthDir: dir}, nil); err == nil {
		t.Fatal("unknown provider login unexpectedly succeeded")
	}
}

func TestOMSExactAccountPinIsFailClosed(t *testing.T) {
	const model = "oms-contract-model"
	executor := &captureExecutor{}
	manager := coreauth.NewManager(nil, nil, nil)
	manager.RegisterExecutor(executor)
	high := &coreauth.Auth{ID: "high-priority", Provider: "test-provider", Status: coreauth.StatusActive, Attributes: map[string]string{"priority": "100"}}
	selected := &coreauth.Auth{ID: "oms-selected", Provider: "test-provider", Status: coreauth.StatusActive, Attributes: map[string]string{"priority": "0"}}
	for _, auth := range []*coreauth.Auth{high, selected} {
		if _, err := manager.Register(context.Background(), auth); err != nil {
			t.Fatal(err)
		}
		registry.GetGlobalRegistry().RegisterClient(auth.ID, auth.Provider, []*registry.ModelInfo{{ID: model}})
		t.Cleanup(func() { registry.GetGlobalRegistry().UnregisterClient(auth.ID) })
	}
	handler := handlers.NewBaseAPIHandlers(&sdkconfig.SDKConfig{}, manager)
	request := handlers.ModelExecutionRequest{EntryProtocol: "openai", ExitProtocol: "openai", Model: model, Body: []byte(`{"model":"oms-contract-model"}`), ForcedProvider: "test-provider", AuthID: selected.ID}
	if response, errMessage := handler.ExecuteModel(context.Background(), request); errMessage != nil || response.StatusCode != http.StatusOK {
		t.Fatalf("exact pin failed: response=%+v error=%+v", response, errMessage)
	}
	if executor.last() != selected.ID {
		t.Fatalf("executed %q, want exact OMS selection %q", executor.last(), selected.ID)
	}

	selected.Disabled = true
	selected.Status = coreauth.StatusDisabled
	if _, err := manager.Update(context.Background(), selected); err != nil {
		t.Fatal(err)
	}
	before := executor.count()
	if _, errMessage := handler.ExecuteModel(context.Background(), request); errMessage == nil {
		t.Fatal("disabled exact pin fell back instead of failing")
	}
	if executor.count() != before {
		t.Fatal("provider was called after selected account became disabled")
	}

	request.AuthID = "missing"
	if _, errMessage := handler.ExecuteModel(context.Background(), request); errMessage == nil {
		t.Fatal("missing exact pin fell back instead of failing")
	}
	if executor.count() != before {
		t.Fatal("provider was called for missing selected account")
	}
}
