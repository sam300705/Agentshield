# Rate Limiting

AgentShield retains a small in-memory limiter for the current single-instance demo/API process. A pluggable distributed abstraction is now available in `apps/api/src/security/distributedRateLimit.ts`. It accepts a `RateLimitStore`, supports a Redis-compatible `incr`/`pExpire`/`pTtl` contract, emits `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset`, supports custom keys for user or organization scopes, and returns a sanitized `503` when the backing store fails unless `fail-open` is deliberately selected.

## Production integration

A deployment with more than one API replica must supply a real shared store implementation and use a key strategy that includes the authenticated organization and user identifiers where appropriate. IP-only keys are insufficient as the sole control for authenticated multi-tenant operations. Authentication endpoints, webhook endpoints, and expensive scan requests should use separately tuned limits.

The current repository provides the contract and deterministic tests but does not select a Redis vendor, create a Redis connection, or silently promote the in-memory limiter to a distributed control. Production activation therefore requires an owner-approved Redis-compatible service and a reviewed adapter that manages connection lifecycle, TLS, credentials, and metrics. No Redis credentials are committed or requested by the test suite.

## Outage policy

The default distributed middleware behavior is fail-closed with a sanitized `503` because silently accepting unbounded traffic during a protection-store outage is unsafe for protected operations. A fail-open mode exists only for explicitly approved low-risk routes where availability is more important than the limiter. The choice must be route-specific and documented; it must not be a hidden global fallback.

## Verification

Synthetic tests cover shared-key isolation, standard headers, Redis command behavior, fail-closed outages, and explicitly configured fail-open behavior. The in-memory fallback remains labeled as per-instance and is not evidence of distributed protection.
