# Security Penetration Test Report

**Generated:** 2026-09-22 14:32:21 UTC

# Executive Summary

# Executive Summary

An external, unauthenticated security assessment of **Kervia-vault** (`https://vault.kervia.ch`), a self-hosted secrets vault for AI agents, was conducted across its four exposed surfaces: the REST API (`/v1/*`), the MCP endpoint (`/mcp`), the admin web UI (`/ui/*` + `/admin/*`), and the first-boot setup flow (`/setup/*`).

**Overall risk posture:** Low. The application enforces a consistent, well-implemented authentication and authorization gate at every surface. Unauthenticated requests are uniformly rejected before any handler logic or input parsing runs, and no authentication-bypass, injection, or logic flaw was reproduced without a credential.

**Key findings**
- One confirmed low-impact information-disclosure issue: the public `GET /setup/info` endpoint leaks the internal mesh listen address (`100.100.108.242:8321`) and the product version (`v1.0.10`), aiding reconnaissance of internal infrastructure.
- No unauthenticated authentication bypass, injection, XSS, or logic-flaw exploitation was achieved on any surface.

**Business impact**
- Minimal for the confirmed finding. The disclosed internal IP is a Tailscale/mesh address (not directly internet-routable) and the version is non-sensitive; the impact is limited to reconnaissance value.
- The remaining attack surface that could carry material impact — object-level authorization (IDOR) on secrets/vaults/grants — could not be exercised because no valid `av_` API key or admin session was in scope, leaving those as proof gaps rather than confirmed issues.

**Overarching theme:** The deployment demonstrates sound security hygiene — strong security headers (CSP, HSTS, frame-ancestors), correct session-cookie attributes, constant-time response handling with no validity oracles, and active rate limiting. The single remediable item is removing the publicly exposed setup-state endpoint.

# Methodology

# Methodology

The assessment was conducted as a **black-box external test** following the **OWASP Web Security Testing Guide (WSTG)** and **PTES** reconnaissance/testing phases.

**Engagement type:** Black-box, unauthenticated (no credentials provided). Testing was confined to the single in-scope host `https://vault.kervia.ch`; no other domain, IP, service, or port was touched.

**Scope surfaces tested:**
- REST API `/v1/*` (Bearer `av_` key authentication).
- MCP endpoint `/mcp` (MCP-over-HTTP, Bearer authentication).
- Admin web UI `/ui/*` (public SPA) and `/admin/*` (session-cookie authentication).
- First-boot setup `/setup/*` (including `/setup/info` and `/setup/init`).

**Activities performed:**
- Attack-surface mapping: endpoint/route enumeration, technology and version fingerprinting, JavaScript bundle static analysis, and authentication-model mapping.
- Authentication testing: Bearer-key parsing/confusion, session-cookie attributes and fixation, login response oracles and timing, recovery-code flow analysis.
- Access-control testing: HTTP method tampering, header spoofing (`X-Forwarded-*`), path/case/verb variation, and auth-gate uniformity checks.
- Injection testing: SQLi/SSTI/XSS payloads against pre-authentication inputs on REST/MCP/admin surfaces.
- Client-side review: DOM-based XSS sinks, prototype pollution, postMessage handling, localStorage usage, and reflected-content checks on the SPA.
- Rate-limiting and control verification.

**Constraints:** No valid `av_` API keys or admin session were provided, so object-level authorization (IDOR/BOLA) on `/v1/secrets` and `/admin/secrets|vaults|grants` could not be dynamically exercised. Brute-forcing was intentionally not performed (rate limits are by design). These constraints are reflected as open proof gaps, not as negative findings.

# Technical Analysis

# Technical Analysis

**Severity model** reflects exploitability × demonstrated impact, calibrated against the requirement that every non-trivial impact metric map to PoC evidence.

**Confirmed finding**
1. **Unauthenticated information disclosure via `/setup/info`** (Medium / CVSS 5.3, CWE-200) — `GET /setup/info` is publicly reachable and returns the internal mesh listen address (`100.100.108.242:8321`) and product version (`v1.0.10`) with no authentication. Impact is reconnaissance-only (C:L); no restricted data, modification, or denial of service is demonstrated.

**Surfaces tested and cleared (no unauthenticated vulnerability reproduced):**
- **Authentication gates** on `/v1/*`, `/mcp`, and `/admin/*` are uniform: every unauthenticated request returns `401 {"error":"unauthorized"}` before handler dispatch or input parsing, regardless of HTTP method, header spoofing (`X-Forwarded-For`/`Host`/`X-Real-IP`), path/case/verb variation, or forged/empty session cookies. No differential, reflection, or parse-error leakage was observed.
- **Recovery flow** (`POST /recovery/recover`): all string code values (empty, null, missing, any length/case/format) produce an identical `{"error":"invalid_code"}` in constant ~30ms time; non-string code types fail JSON type assertion (400) before comparison. There is no validity oracle, no code-format leak, and no state in which `new_password` is applied without a valid code.
- **Login** (`POST /admin/login`): uniform `401 invalid_credentials` with constant timing; no account-state oracle; no session cookie issued on failure (no fixation vector).
- **Session handling**: `av_session` cookie is HttpOnly + Secure + SameSite=Strict, cleared on logout.
- **Injection**: pre-auth inputs on `/v1/secrets?vault=` and `/mcp` JSON-RPC body are not parsed before the auth gate; no reflection or error-based injection.
- **Client-side (SPA)**: React 19.3.0 app with no app-level `dangerouslySetInnerHTML`, `eval`, `new Function`, `document.write`, or prototype-pollution merge of user input; `location.hash` used only for strict-equality routing; no reachable DOM-XSS sink.
- **Rate limiting** confirmed active (429 `rate_limited`, ~20s reset).

**Systemic themes:** Defense-in-depth is consistently applied — auth middleware precedes handler dispatch on every route, responses are constant-time and uniform (no oracles), session cookies are correctly scoped, and rate limiting is in place. The single gap is an unnecessary public setup-state endpoint.

**Open proof gaps (not ruled out — require credentials):**
- Object-level authorization (IDOR/BOLA) on `/v1/secrets?vault=` and `/admin/secrets|vaults|grants` (id/vault parameters). These are confirmed 401-gated, but cross-vault/cross-secret authorization could not be verified without a valid `av_` key or admin session. This is the highest-value remaining surface and should be the focus of any credentialed follow-up.

# Recommendations

# Recommendations

**Immediate**
1. Restrict `GET /setup/info` to the pre-provisioning state, or authenticate it. The endpoint currently discloses the internal mesh listen address and version to any unauthenticated client; once provisioning is complete (`setup_done:true`), the setup-status surface should no longer be publicly reachable.

**Short-term**
2. Conduct a credentialed follow-up of object-level authorization on `/v1/secrets?vault=` and `/admin/secrets|vaults|grants`, using a low-privilege `av_` key and a separate admin session, to confirm that object references (`vault`, `id`) are bound to the caller's grants. This is the highest-value untested surface.

**Medium-term**
3. Add a `Retry-After` header to `429` rate-limit responses to improve client backoff behavior (minor hygiene; not a security defect).
4. If source becomes available, review recovery-code generation entropy and session-token entropy — the two remaining static-only gaps that black-box testing could not inspect.

**Retest & validation:** Re-verify that `GET /setup/info` returns `401` (or is removed) after remediation, and confirm no regression in the uniform auth-gate behavior across `/v1/*`, `/mcp`, and `/admin/*`. Any credentialed testing should re-run the IDOR proof gap above before concluding the assessment.

