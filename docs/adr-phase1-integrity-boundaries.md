# ADR: repair Phase 1 integrity at the actual boundary

Date: 2026-10-15. Status: implementation candidate; independent acceptance pending.

## Decisions

1. Retain PostgreSQL transactions. Lock the selected job row and reread current
   failure state before clearing it; claim and attributed sanitized archival audit
   commit together. An attempt counter can decrease on shutdown, so it cannot
   establish freshness by itself. No remote operation occurs in this transaction.
2. Replace exported seed-client injection with a validated URL entry point. Construct
   and disconnect the writer internally using that exact URL. Checking ambient
   configuration cannot establish an arbitrary injected client's destination.
   Import safety and the before-commit rollback test hook remain.
3. Integrate upstream `packageurl-js` **2.0.1**, MIT, to parse PURLs before redaction.
   Preserve safe original component encodings; decode and sanitize components with
   bounded nesting, then re-encode changes. Refuse malformed raw URL structures.
   Preserve the standard's safe colon-bearing VCS qualifier. npm scope is a namespace;
   pnpm/yarn remain installation tools, not distinct ecosystems.
4. Trust only exact canonical redaction placeholders for idempotent sanitization.
   A marker substring surrounding or appended to private text conveys no authority.
   Inspect nested query values and decoded credential keys, including short values.
5. Add optional `incompleteChecks` to shared coverage JSON. YAML parse errors,
   warnings, conversion failures and unresolved template syntax make a scan PARTIAL.
   Count affected supported checks without publishing parser text/source. A file
   receiving secret checks does not prove its YAML checks completed. Keep old
   receipt payloads byte-compatible when the field is absent.

## Reuse and compatibility

The npm package's installed LICENSE, declaration and source were inspected; its
manifest has no runtime dependencies. Registry integrity remains in pnpm-lock.yaml;
do not disable package verification. Upstream v2.0.1 annotated tag resolves to
`cd1eb4b050ea66462a729f800166ee0b02fc4c5c`. No third-party source is copied.
License attribution ships in the installed dependency. Parser reuse does not
provide complete secret recognition; AgentShield retains responsibility for redaction.

No migration, queue replacement, new provider adapter or policy engine is justified
by these failures. Seed callers now supply a URL rather than PrismaClient, and tests
construct their fixture clients separately. The CLI uses its normal environment URL.
Older strict readers need a compatible release for the additive coverage diagnostic;
historical signed payloads are not rewritten. Reverting code cannot reverse leakage
already exported: operators must investigate historical evidence and rotate any actual
exposed credential through their authorized incident process.

## Alternatives rejected

- Adding another CAS predicate around stale failure values: more fragile than reading
  the actual row under its existing transaction lock, especially with shutdown ABA.
- Inspecting Prisma private internals for datasource identity: unstable and avoidable.
- Wholesale URL decoding or blanket colon rejection: destroys valid PURL structure.
- Swallowing YAML errors or failing every entire scan: hides coverage or discards
  useful successful checks. Explicit partial evidence preserves the distinction.

See [regression register](phase1-review-fix-register.md) for evidence and remaining gates.
