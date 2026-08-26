# External integration research notes

These notes record facts verified from official documentation on 2026-08-23.

## GitHub webhooks

GitHub's validation guidance states that webhook signatures are sent in `X-Hub-Signature-256`, use an HMAC hex digest, begin with `sha256=`, and are computed from the webhook secret and the raw UTF-8 payload. Source: https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries

## OSV batch API

The official OSV querybatch endpoint is `POST https://api.osv.dev/v1/querybatch`. It accepts multiple package/version queries and returns results in input order, with vulnerability IDs and modification timestamps in the batch response. Full vulnerability records can be retrieved separately by ID. The API documents per-query pagination tokens and supports package name/ecosystem/version or package URL forms. Source: https://google.github.io/osv.dev/post-v1-querybatch/

## GitHub Actions runtime and CodeQL Action v4

GitHub's official CodeQL migration notice states that CodeQL Action v4 runs on Node.js 24 and instructs advanced workflows to replace `github/codeql-action/init@v3`, `autobuild@v3`, `analyze@v3`, and `upload-sarif@v3` with their v4 equivalents. AgentShield's workflow used `upload-sarif@v4` after this verification. Source: https://github.blog/changelog/2025-10-28-upcoming-deprecation-of-codeql-action-v3/

GitHub's official runner notice documents the Node.js 20 action-runtime migration, the Node.js 24 transition, and the need for action users to update workflows to current action versions. Source: https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/
