# GitHub App Integration

AgentShield includes a provider-neutral webhook security boundary in `apps/api/src/integrations/githubApp.ts`. It verifies the raw request body with the `X-Hub-Signature-256` HMAC header, requires installation context, normalizes organization and repository identifiers, rejects replayed delivery IDs within a bounded TTL, and checks that an installation belongs to the expected organization. The current implementation is covered by synthetic tests; it does not claim that a live GitHub App is connected.

## Owner configuration

A repository administrator must register a GitHub App in GitHub Developer Settings and configure a callback or installation URL that is reachable by the deployed API. The administrator must create a webhook secret, store the App private key and secret using the deployment platform's secret manager, and choose only the repository permissions required for the approved workflow. A personal access token must not be used as an application substitute.

The current adapter expects the following conceptual values. These are names only; never place real values in Git, chat, issue comments, screenshots, or browser-visible configuration.

| Value                    | Purpose                                                            | Handling                                                                      |
| ------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `GITHUB_APP_ID`          | Identifies the registered App                                      | Non-secret identifier; validate against the deployed App.                     |
| `GITHUB_CLIENT_ID`       | Supports an installation or user authorization flow where selected | Non-secret identifier; do not treat it as a token.                            |
| `GITHUB_WEBHOOK_SECRET`  | Verifies the raw webhook body                                      | Secret-manager only.                                                          |
| `GITHUB_PRIVATE_KEY`     | Creates short-lived installation tokens                            | Secret-manager only; rotate and never log.                                    |
| `GITHUB_INSTALLATION_ID` | Optional test or single-installation configuration                 | Prefer a persisted, tenant-checked installation mapping for multi-tenant use. |

## Webhook behavior

GitHub's official guidance states that the signature uses an HMAC hex digest, starts with `sha256=`, and is computed from the webhook secret and raw UTF-8 payload.[^1] The API must capture the raw body before JSON parsing, verify the signature in constant time, require a bounded delivery ID and event name, reject duplicate deliveries, and only then parse and dispatch the event.

Supported event handling should be added behind the adapter for `installation`, repository-selection, `push`, and pull-request events. Every dispatch must resolve the installation to an organization-owned binding and reject mismatches. Installation deletion and revoked-token errors must disable the binding rather than silently retry forever. Event persistence and scan enqueueing require a reviewed Prisma migration and organization-scoped idempotency key.

## Permissions and verification

Start with read-only repository metadata and contents or pull-request access only when the approved scan workflow needs it. Do not request write permissions until a separately reviewed action requires them. Before live installation, run the synthetic tests for valid and invalid HMAC values, modified raw payloads, missing installation context, replayed delivery IDs, malformed identifiers, and cross-organization bindings. After installation, verify repository discovery and token expiry without printing the token.

## Current status

The signature, replay, and ownership primitives are **implemented and tested using safe mocks**. Live App registration, installation persistence, repository discovery against GitHub, and webhook delivery into a public API remain **owner-configured and not deployed**. No GitHub App credentials have been created or committed by this repository work.

## References

[^1]: [GitHub Docs — Validating webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)

[^2]: [GitHub Docs — Using webhooks with GitHub Apps](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/using-webhooks-with-github-apps)

[^3]: [GitHub Docs — Webhook events and payloads](https://docs.github.com/webhooks/webhook-events-and-payloads)
