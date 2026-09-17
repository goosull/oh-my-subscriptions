# Security policy

## Supported versions

Security fixes are made on the latest released version and the `main` branch. Upgrade to
the newest release before reporting a problem that may already be fixed.

## Reporting a vulnerability

Please report vulnerabilities privately using GitHub's **Report a vulnerability** feature
on the repository Security tab. If private vulnerability reporting is unavailable, contact
the maintainer through the repository owner's GitHub profile and ask for a private channel.

Do **not** open a public issue for vulnerabilities involving:

- OAuth or refresh tokens;
- account selection or cross-account fallback;
- local core authentication or loopback exposure;
- credential-file permissions;
- paid-overage guard bypass;
- command injection or unsafe profile paths;
- accidental disclosure of account identity or usage data.

Include:

1. affected version and operating system;
2. a minimal reproduction without real credentials;
3. expected and observed behavior;
4. impact and required attacker access;
5. any proposed mitigation.

You should receive an acknowledgement within 7 days. Please allow time to reproduce,
prepare a fix, and coordinate disclosure before publishing details.

## Security design

- The shared core binds to loopback and requires bearer authentication.
- Facade and management tokens are stored as private files.
- Exact-account routing fails closed; a disabled credential must not fall back to a sibling.
- The Python CLI does not read provider token bytes.
- OMS blocks configured paid-overflow accounts at the safety threshold unless explicitly forced.

These properties are security boundaries. Changes that weaken them require explicit review
and regression tests.
