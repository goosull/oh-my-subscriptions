# OMS core validation

Candidate: [`router-for-me/CLIProxyAPI`](https://github.com/router-for-me/CLIProxyAPI) **v7.3.4** (MIT).
This directory contains an offline contract test and a mock-only local HTTP sidecar.
It is not included in the published Pi package.

## Verified offline

```bash
cd core && go test ./...
```

- `sdk/auth.Manager` centralizes provider login and persists the returned credential through one store.
- Management auth records expose identity/status/quota metadata without returning token bytes.
- Auth files support persisted `priority`, `disabled`, and `weight` policy fields.
- `ModelExecutionRequest.AuthID` pins one exact credential.
- Missing or disabled pinned credentials fail closed without trying a higher-priority sibling.
- Streaming and non-streaming pin propagation, login metadata preservation, and Management API status/priority behavior also pass CLIProxyAPI's own selected upstream tests at v7.3.4.

## Mock HTTP PoC

```bash
cd core
OMS_CORE_TOKEN='replace-with-32+-random-characters' \
  go run ./cmd/oms-core --mock --listen 127.0.0.1:8319
```

The mock sidecar binds only to loopback, requires a bearer token, accepts non-streaming
`POST /v1/chat/completions`, and owns account selection through authenticated
`PUT /v1/oms/account`. Client-supplied `auth_id` fields are ignored. End-to-end tests prove
`mock-a → mock-b` switching and that a selected disabled credential returns non-retryable 409 without
calling or falling back to another executor. Real credentials are explicitly disabled.

## Integration boundary found

Exact `AuthID` pinning exists in the Go SDK's internal model-execution API, but ordinary
OpenAI/Anthropic-compatible HTTP routes do not expose a caller-controlled account pin.
OMS must therefore either:

1. embed the CLIProxyAPI SDK in a thin local sidecar and expose an OMS-authenticated,
   policy-owned endpoint, or
2. contribute an upstream fail-closed account-pin interface.

Temporarily disabling sibling credentials through the Management API is not acceptable:
concurrent sessions would race and could use the wrong account.

## Ownership split

- **Core:** OAuth, refresh, encrypted/persistent credential storage, provider protocol,
  quota/cooldown state, exact account execution.
- **OMS:** names, priority, billing guard, active/next selection, session affinity, audit/UI.
- **Host adapters:** Pi, Claude Code, Codex, and future agents connect to the same core.
  They never implement provider login.

## Production lifecycle scaffold

`ProductionCore` loads a CLIProxyAPI config, shares its credential store/auth manager with
the exact-account facade, starts/stops the full provider service, discovers sanitized
account identities and models, and forwards non-streaming or streaming OpenAI Chat,
OpenAI Responses, and Anthropic Messages requests with an exact `AuthID`.

The Pi extension can discover and auto-start a private local core installation from
`~/.oms/core`, register its models as provider `oms-core`, and select an account/model
before a turn. `oms core start|stop|status` manages the same shared process for other
host adapters. Root package direct Claude/Codex bridges remain migration compatibility,
not the target architecture.

## Live-provider status

Local core OAuth succeeded for a company Google account through Antigravity and for the
same account's Claude subscription. No token bytes passed through OMS. Quota was fetched
through the core's authenticated Management API. Exact-account non-streaming and streaming
Google requests succeeded through the facade, as did Pi and Codex host adapters.

A later Claude Code host smoke triggered repeated model-specific 429 responses even though
the weekly quota summary reported nearly all quota remaining. OMS now treats core runtime
`unavailable`/`error`/cooldown as stronger evidence than passive quota summaries, caches the
reason, and disables the credential. No further provider calls are allowed until a later
policy sync observes recovery. The Claude credential remains disabled independently because
its existing OMS reading is blocked.

Codex core OAuth still requires user-presence completion in the OpenAI browser flow. The
attempted direct Gemini CLI organization login was rejected by Google's client policy and
was removed; Google uses core-owned Antigravity OAuth instead.
