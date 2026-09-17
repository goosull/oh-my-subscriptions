## Problem

<!-- What user-visible problem or maintenance need does this solve? -->

## Change

<!-- Summarize the smallest implemented solution. -->

## Verification

- [ ] `./bin/oms --selftest`
- [ ] `python3 .github/check-docs.py`
- [ ] `python3 .github/check-wired.py`
- [ ] `bun test tests`
- [ ] Extension TypeScript check
- [ ] `cd core && go test ./...` when core code changes

## Safety and compatibility

- [ ] Exact-account routing still fails closed.
- [ ] Paid-overage guards are not weakened.
- [ ] No credentials, tokens, real auth files, account IDs, or private paths are included.
- [ ] Config, migration, provider, and host compatibility impact is documented.

## UI evidence

<!-- Add a screenshot or terminal capture for TUI/status-line changes, if applicable. -->
