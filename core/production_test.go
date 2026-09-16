package omscore

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v7/internal/registry"
	coreauth "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/auth"
)

func freePort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port
}

func TestProductionSelectByStableIDKeepsCanonicalAccountKey(t *testing.T) {
	account := Account{ID: "stable-id", Name: "user@example.test", AuthID: "auth-file", Provider: "test"}
	registry.GetGlobalRegistry().RegisterClient(account.AuthID, account.Provider, []*registry.ModelInfo{{ID: "model"}})
	defer registry.GetGlobalRegistry().UnregisterClient(account.AuthID)
	manager := coreauth.NewManager(nil, nil, nil)
	if _, err := manager.Register(context.Background(), &coreauth.Auth{ID: account.AuthID, Index: account.ID, Label: account.Name, Provider: account.Provider, Status: coreauth.StatusActive}); err != nil {
		t.Fatal(err)
	}
	statePath := filepath.Join(t.TempDir(), "active.json")
	core := &ProductionCore{accounts: map[string]Account{}, manager: manager, statePath: statePath}
	if err := core.SelectModel(account.ID, "model"); err != nil {
		t.Fatal(err)
	}
	core.RefreshAccounts()
	current, ok := core.Current()
	if !ok || current.Name != account.Name || current.Model != "model" {
		t.Fatalf("current=%+v ok=%v", current, ok)
	}
	if len(core.accounts) != 1 {
		t.Fatalf("selection created duplicate keys: %+v", core.accounts)
	}
	restarted := &ProductionCore{accounts: map[string]Account{}, manager: manager, statePath: statePath}
	restarted.RefreshAccounts()
	restored, restoredOK := restarted.Current()
	if !restoredOK || restored.ID != account.ID || restored.Model != "model" {
		t.Fatalf("selection was not restored: %+v ok=%v", restored, restoredOK)
	}
	auth, _ := manager.GetByID(account.AuthID)
	auth.Unavailable = true
	auth.Status = coreauth.StatusError
	if _, err := manager.Update(context.Background(), auth); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := core.Execute(context.Background(), "openai", "model", []byte(`{"model":"model"}`)); err == nil {
		t.Fatal("runtime unavailable account reached executor")
	}
}

func TestProductionAccountsWithSharedEmailDoNotOverwriteEachOther(t *testing.T) {
	manager := coreauth.NewManager(nil, nil, nil)
	for i, provider := range []string{"antigravity", "claude", "codex", "codex"} {
		id := fmt.Sprintf("auth-%d", i)
		index := fmt.Sprintf("idx-%d", i)
		if _, err := manager.Register(context.Background(), &coreauth.Auth{ID: id, Index: index, Label: "same@example.test", Provider: provider, Status: coreauth.StatusActive}); err != nil {
			t.Fatal(err)
		}
		registry.GetGlobalRegistry().RegisterClient(id, provider, []*registry.ModelInfo{{ID: "model"}})
		defer registry.GetGlobalRegistry().UnregisterClient(id)
	}
	core := &ProductionCore{accounts: map[string]Account{}, manager: manager}
	accounts := core.RefreshAccounts()
	if len(accounts) != 4 || len(core.accounts) != 4 {
		t.Fatalf("shared identity accounts were overwritten: %+v", accounts)
	}
	if err := core.SelectModel("idx-2", "model"); err != nil {
		t.Fatal(err)
	}
	for range 5 {
		core.RefreshAccounts()
	}
	current, ok := core.Current()
	if !ok || current.ID != "idx-2" {
		t.Fatalf("stable selection drifted across duplicate display names: %+v", current)
	}
}

func TestProductionCoreLifecycleWithoutCredentials(t *testing.T) {
	servicePort := freePort(t)
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.yaml")
	config := fmt.Sprintf("host: 127.0.0.1\nport: %d\nauth-dir: %q\napi-keys:\n  - offline-service-key\nremote-management:\n  allow-remote: false\n  disable-control-panel: true\nplugins:\n  enabled: false\n", servicePort, filepath.Join(dir, "auth"))
	if err := os.WriteFile(configPath, []byte(config), 0o600); err != nil {
		t.Fatal(err)
	}
	core, err := NewProductionCore(configPath, "offline-management-token-32-characters")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- core.Run(ctx) }()
	readyCtx, readyCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer readyCancel()
	if err := core.WaitStarted(readyCtx); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for {
		req, _ := http.NewRequest(http.MethodGet, fmt.Sprintf("http://127.0.0.1:%d/v1/models", servicePort), nil)
		req.Header.Set("Authorization", "Bearer offline-service-key")
		resp, requestErr := http.DefaultClient.Do(req)
		if requestErr == nil {
			_ = resp.Body.Close()
			if resp.StatusCode != http.StatusOK {
				t.Fatalf("models status=%d", resp.StatusCode)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("provider core did not start: %v", requestErr)
		}
		time.Sleep(50 * time.Millisecond)
	}
	if accounts := core.Accounts(); len(accounts) != 0 {
		t.Fatalf("accounts=%v, want none", accounts)
	}
	cancel()
	select {
	case err := <-done:
		if err != nil && err != context.Canceled {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("provider core did not stop")
	}
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()
	if err := core.Shutdown(shutdownCtx); err != nil {
		t.Fatal(err)
	}
}
