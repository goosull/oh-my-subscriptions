package omscore

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMockSidecarPinsPolicyAccountEndToEnd(t *testing.T) {
	core, err := NewMockCore([]Account{
		{Name: "a", AuthID: "auth-a", Provider: "mock-provider", Model: "mock-model"},
		{ID: "stable-b", Name: "b", AuthID: "auth-b", Provider: "mock-provider", Model: "mock-model"},
		{Name: "blocked", AuthID: "auth-blocked", Provider: "mock-provider", Model: "mock-model", Disabled: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer core.Close()
	const token = "offline-test-token-with-at-least-32-characters"
	handler, err := core.Handler(token)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(handler)
	defer server.Close()
	client := server.Client()

	request := func(method, path string, payload any, authenticated bool) *http.Response {
		var body io.Reader
		if payload != nil {
			raw, _ := json.Marshal(payload)
			body = bytes.NewReader(raw)
		}
		req, err := http.NewRequest(method, server.URL+path, body)
		if err != nil {
			t.Fatal(err)
		}
		if authenticated {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		if payload != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return resp
	}

	models := request(http.MethodGet, "/v1/models", nil, true)
	if models.StatusCode != http.StatusOK {
		t.Fatalf("models status=%d", models.StatusCode)
	}
	var catalog struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.NewDecoder(models.Body).Decode(&catalog)
	_ = models.Body.Close()
	if len(catalog.Data) != 1 || catalog.Data[0].ID != "mock-model" {
		t.Fatalf("models=%+v", catalog.Data)
	}

	unauthorized := request(http.MethodPost, "/v1/chat/completions", map[string]any{"model": "mock-model"}, false)
	if unauthorized.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthorized status=%d", unauthorized.StatusCode)
	}
	_ = unauthorized.Body.Close()

	large := request(http.MethodPost, "/v1/chat/completions", map[string]any{
		"model": "mock-model", "messages": []any{map[string]any{"role": "user", "content": string(bytes.Repeat([]byte("x"), 3<<20))}},
	}, true)
	if large.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(large.Body)
		t.Fatalf("large request status=%d body=%s", large.StatusCode, body)
	}
	_ = large.Body.Close()

	// A client-supplied auth_id is ignored; only OMS policy's current account reaches the SDK pin.
	first := request(http.MethodPost, "/v1/chat/completions", map[string]any{"model": "mock-model", "auth_id": "auth-b", "messages": []any{}}, true)
	if first.StatusCode != http.StatusOK || first.Header.Get("X-OMS-Account") != "a" {
		t.Fatalf("first route status=%d account=%q", first.StatusCode, first.Header.Get("X-OMS-Account"))
	}
	firstBody, _ := io.ReadAll(first.Body)
	_ = first.Body.Close()
	if !bytes.Contains(firstBody, []byte("served by auth-a")) {
		t.Fatalf("first response=%s", firstBody)
	}

	switched := request(http.MethodPut, "/v1/oms/account", map[string]any{"account": "stable-b"}, true)
	if switched.StatusCode != http.StatusOK {
		t.Fatalf("switch status=%d", switched.StatusCode)
	}
	_ = switched.Body.Close()
	second := request(http.MethodPost, "/v1/chat/completions", map[string]any{"model": "mock-model", "messages": []any{}}, true)
	if second.StatusCode != http.StatusOK || second.Header.Get("X-OMS-Account") != "b" {
		t.Fatalf("second route status=%d account=%q", second.StatusCode, second.Header.Get("X-OMS-Account"))
	}
	secondBody, _ := io.ReadAll(second.Body)
	_ = second.Body.Close()
	if !bytes.Contains(secondBody, []byte("served by auth-b")) {
		t.Fatalf("second response=%s", secondBody)
	}
	streamed := request(http.MethodPost, "/v1/chat/completions", map[string]any{"model": "mock-model", "messages": []any{}, "stream": true}, true)
	if streamed.StatusCode != http.StatusOK || streamed.Header.Get("X-OMS-Account") != "b" {
		t.Fatalf("stream route status=%d account=%q", streamed.StatusCode, streamed.Header.Get("X-OMS-Account"))
	}
	streamBody, _ := io.ReadAll(streamed.Body)
	_ = streamed.Body.Close()
	if !bytes.Contains(streamBody, []byte(`"account":"auth-b"`)) || !bytes.Contains(streamBody, []byte("}\n\ndata: [DONE]")) {
		t.Fatalf("stream response=%s", streamBody)
	}

	selectedBlocked := request(http.MethodPut, "/v1/oms/account", map[string]any{"account": "blocked"}, true)
	if selectedBlocked.StatusCode != http.StatusOK {
		t.Fatalf("blocked selection status=%d", selectedBlocked.StatusCode)
	}
	_ = selectedBlocked.Body.Close()
	before := len(core.ExecutedIDs())
	blocked := request(http.MethodPost, "/v1/chat/completions", map[string]any{"model": "mock-model", "messages": []any{}}, true)
	if blocked.StatusCode != http.StatusConflict {
		t.Fatalf("blocked route status=%d", blocked.StatusCode)
	}
	_ = blocked.Body.Close()
	if len(core.ExecutedIDs()) != before {
		t.Fatal("disabled exact account fell back to another credential")
	}

	want := []string{"auth-a", "auth-a", "auth-b", "auth-b"}
	got := core.ExecutedIDs()
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("executed auth IDs=%v, want %v", got, want)
	}
}
