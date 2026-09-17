# Contributing to oh-my-subscriptions

Thanks for helping improve OMS. Contributions are welcome for provider compatibility,
quota reporting, safety guards, Pi and Claude Code integration, documentation, and tests.

## Before opening an issue

1. Search existing issues and releases.
2. Run `oms doctor` and include its non-sensitive output when reporting setup failures.
3. Remove tokens, OAuth files, email addresses, account IDs, and private paths from logs.
4. Use the bug or feature-request template so the report contains enough context to act on.

Security vulnerabilities belong in the private process described in [SECURITY.md](SECURITY.md).

## Development setup

Requirements:

- Python 3.11+
- Node.js 22+
- Bun
- Go 1.26+

```bash
git clone https://github.com/goosull/oh-my-subscriptions.git
cd oh-my-subscriptions
npm ci --ignore-scripts
(cd agent && bun install --frozen-lockfile)
git config core.hooksPath .githooks
```

## Make a focused change

- Keep provider login and token handling in the shared core; do not add host-specific OAuth copies.
- Preserve exact-account, fail-closed routing. Never introduce hidden credential fallback.
- Do not weaken billing, input-validation, or credential-file protections.
- Prefer the smallest change that solves the demonstrated problem.
- Add one regression check for non-trivial behavior.
- Update README examples and command documentation when behavior changes.

## Run the checks

```bash
./bin/oms --selftest
python3 .github/check-docs.py
python3 .github/check-wired.py
bun test tests
agent/node_modules/.bin/tsc --noEmit --skipLibCheck \
  --module nodenext --moduleResolution nodenext --target es2022 extensions/*.ts
(cd agent && bun run typecheck && bun test)
(cd core && go test ./...)
```

For concurrency- or credential-routing changes, also run:

```bash
(cd core && go test -race ./... && go vet ./...)
```

## Pull requests

A good pull request:

- explains the user-visible problem and root cause;
- keeps unrelated refactors out;
- lists the checks run;
- calls out security, billing, migration, or compatibility impact;
- includes screenshots for TUI changes when useful;
- never includes credentials or real auth fixtures.

Maintainers may ask to split broad changes. By contributing, you agree that your work is
licensed under the repository's [MIT License](LICENSE).
