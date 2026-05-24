# Security Policy

## Supported versions

Arc is pre-1.0. Only the latest minor version receives security updates.

| Version | Supported |
| --- | :---: |
| 0.1.x | ✅ |
| < 0.1 | ❌ |

Once Arc reaches 1.0, this table will list the last two minor versions as supported.

## Reporting a vulnerability

**Please do not file public GitHub issues for vulnerabilities.**

Report privately via one of:

1. **GitHub Security Advisories** (preferred): https://github.com/arc-language/arc/security/advisories/new
2. **Email:** `security@arc-language.dev` (replace with actual maintainer contact)

Include in your report:
- A description of the issue and its impact
- Steps to reproduce (a minimal `.arc` source file is ideal)
- Affected version(s) of Arc
- Your assessment of severity
- Any suggested mitigation

## What to expect

| Timeline | Action |
| --- | --- |
| Within 48 hours | Acknowledgement of receipt |
| Within 7 days | Initial assessment + severity classification |
| Within 30 days | Fix released, or a status update with an ETA |
| At disclosure | Public advisory + credit to the reporter (unless anonymity requested) |

## Scope

Vulnerabilities Arc cares about:

- **Compiler input handling**: malicious `.arc` source that triggers arbitrary code execution, infinite loops, or memory exhaustion during `arc build` / `arc check`
- **`@build` sandbox escapes**: `fetch()` or `readFile()` calls that bypass the SSRF or path-traversal guards
- **Emitted output**: XSS / injection vulnerabilities in generated HTML / CSS / JS
- **Edge function runtime**: vulnerabilities in the generated `@live` / `@server` edge code
- **ADP protocol**: parser bugs that allow prototype pollution, memory exhaustion, or other corruption
- **Stdlib widgets**: any module under `stdlib/`

Out of scope (please don't report):
- Issues in optional dependency `sharp` (report to [sharp upstream](https://github.com/lovell/sharp/security))
- Vulnerabilities in user code written in Arc (Arc compiles what you write)
- Hardening suggestions that don't have a concrete attack vector
- Best-practice issues without a working PoC

## Hardening features Arc already ships

Reviewers may find it useful to know what's already in place:

- **CSP meta tag** auto-emitted on every page; switched to `_headers` for multi-page builds
- **`@build fetch`** restricted to `http://` and `https://`, blocks `127.0.0.1` / `[::1]` / `0.0.0.0` / private ranges; no redirect following; 10 MB cap; 10 s timeout
- **`@build readFile`** restricted to project root; blocks `.env`, `.git/...`, `id_rsa`, `secrets.*` patterns
- **ADP decoder** drops `__proto__`, `constructor`, `prototype` keys silently
- **Edge function** sets `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` on every response
- **Session** validated at the edge boundary; unauthenticated `@server` calls return 401 before user code runs

## Acknowledgement

Reporters are credited in the security advisory and the CHANGELOG (unless they request anonymity). Arc does not currently offer a bug bounty.

## PGP

If you need to encrypt your report:
- Public key: (to be added when maintainer contact is finalized)
- Fingerprint: TBD

## Out-of-band contact

If neither of the above channels works (e.g. GitHub Advisories down + email bounces), open a GitHub issue titled `Security: need contact channel` — do NOT include the vulnerability details, just request a fresh contact channel.
