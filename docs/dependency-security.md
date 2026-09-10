# Dependency Security Policy

AgentShield treats dependencies as supply-chain attack surface. This document
records the enforced policy, the pinned transitive overrides, and every
remaining accepted finding with its exposure analysis.

## Gates

CI enforces both gates on every pull request:

```bash
pnpm audit --audit-level high
pnpm --prod audit --audit-level high
```

Reproducible local equivalents (same thresholds):

```bash
pnpm audit:high
pnpm audit:prod
```

The threshold is `high`: any `high` or `critical` advisory fails the gate.
`moderate` and `low` findings do not fail the gate but must be reduced to the
narrowest safe compatible change and recorded below when they cannot be fixed
without a major upgrade.

## Install-time script allowlist

`pnpm-workspace.yaml` uses `onlyBuiltDependencies` (pnpm 9) so dependency
lifecycle scripts are deny-by-default. Exactly four trusted toolchain packages
may run install scripts:

| Package           | Script      | Why it is allowed                                                                            |
| ----------------- | ----------- | -------------------------------------------------------------------------------------------- |
| `esbuild`         | postinstall | Installs/verifies the platform-specific binary; Vite, Vitest, and tsx cannot run without it. |
| `prisma`          | preinstall  | Toolchain compatibility check for the Prisma CLI.                                            |
| `@prisma/client`  | postinstall | Prisma client install-time generation hook.                                                  |
| `@prisma/engines` | postinstall | Prisma engine-cache handling for the CLI toolchain.                                          |

No other dependency in the tree declares install scripts (verified by scanning
`node_modules/.pnpm` for `preinstall`/`install`/`postinstall`). Any newly
introduced dependency with install scripts is blocked by default until it is
reviewed and added here explicitly.

## Transitive overrides (`pnpm.overrides`)

The root `package.json` pins these transitives to patched versions because
their direct parents constrain a vulnerable range. Each override is a
patch-level (or minor, API-stable) bump, verified by the full CI pipeline:

| Override              | Patched to | Advisory fixed                         | Parent constraint               |
| --------------------- | ---------- | -------------------------------------- | ------------------------------- |
| `brace-expansion@<2`  | `1.1.18`   | GHSA-3jxr, GHSA-mh99, GHSA-rgw5 (high) | minimatch/eslint legacy chain   |
| `brace-expansion@>=4` | `5.0.9`    | GHSA-3jxr, GHSA-mh99, GHSA-rgw5 (high) | glob/jackspeak chain            |
| `browserslist`        | `4.28.7`   | GHSA browserslist (high, memory/crash) | caniuse-lite/autoprefixer chain |
| `js-yaml`             | `4.3.2`    | GHSA-2883, GHSA-2rlx, GHSA-mh29 (high) | @eslint/eslintrc (frozen)       |
| `nanoid@<4`           | `3.3.18`   | GHSA nanoid (high, generator loops)    | postcss 8.x                     |
| `qs`                  | `6.16.0`   | GHSA qs (moderate, DoS/bypass)         | express 4.22 (`~6.15.1` pin)    |
| `body-parser`         | `1.20.6`   | GHSA body-parser (low, DoS)            | express 4.22 (`~1.20.5` pin)    |
| `deepmerge-ts`        | `8.0.1`    | GHSA-ggr8 (high, stack exhaustion)     | @prisma/config (see note)       |

Note on `deepmerge-ts`: the only major-line override. `@prisma/config` calls
only `deepmerge(a, b)` on plain config records; v8 keeps the CJS entrypoint
and the v7→v8 breaking changes are limited to type renames, `deepmergeInto`
aliasing semantics, and Map edge cases, none of which this call path uses.
Any incompatibility fails loudly in CI (`db:generate`, `prisma validate`,
`db:deploy`) rather than silently. Revisit on the next Prisma major upgrade.

## Direct upgrades performed

- `vitest` `^2.1.8` → `^4.1.11` in all 7 test workspaces. Required: fixes the
  critical Vitest UI arbitrary file read/execution advisory (GHSA-5xrq,
  patched only in `>=3.2.6`) and the `@vitest/mocker` traversal advisory
  (patched only in `>=4.1.11`), and drops the vulnerable transitive `vite 5`
  and `esbuild 0.21` instances. Test scripts are scoped with
  `vitest run --dir src` because Vitest 4 no longer excludes `dist/` build
  output by default.
- `postcss` `^8.4.49` → `^8.5.28` (dashboard): fixes the high source-map path
  traversal (GHSA-6g55) and its incomplete-fix follow-up.
- `react-router-dom` `^6.28.1` → `^6.30.6` (dashboard): fixes the moderate
  `react-router-dom` open-redirect-to-XSS advisory (GHSA-jjmj).

## Accepted residual findings (moderate, non-gating)

Two `moderate` advisories remain; both require a `react-router` v6→v7 major
with no 6.x backport, which is out of scope for stabilization:

- Package: `react-router@6.30.6` (via `react-router-dom@6.30.6`, dashboard only).
- Advisories: GHSA-wrjc (open redirect via backslash in `Link`/`useNavigate`),
  GHSA-337j (constructor injection via `deserializeErrors()`).
- Reason: patched only in `>=7.18.0`; no compatible fix exists on the 6.x line.
- Actual exposure: negligible. The dashboard calls `navigate()` only with
  internal paths built from API identifiers (for example `/scans/${scanId}`),
  never with user-controlled URLs, and it does not use data-router
  loaders/actions (`deserializeErrors` is unreachable; the app uses
  `BrowserRouter` with static routes). The dashboard is an internal/demo UI,
  not a public multi-tenant surface.
- Mitigation: Dependabot is enabled (`.github/dependabot.yml`); `npm audit`
  output is reviewed on every PR via the CI gates above.
- Expiry/review date: 2026-12-10, or earlier if the dashboard becomes
  customer-facing or a 6.x backport is published.

## Adding an exception

Do not add broad ignores. A new exception requires all of: package, advisory
ID/URL, reason a compatible fix is unavailable, actual exposure analysis,
mitigation, and an expiry/review date — recorded in this file and reviewed on
that date.
