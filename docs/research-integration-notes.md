# External integration research notes

These notes record facts verified from official documentation on 2026-08-23.

## GitHub webhooks

GitHub's validation guidance states that webhook signatures are sent in `X-Hub-Signature-256`, use an HMAC hex digest, begin with `sha256=`, and are computed from the webhook secret and the raw UTF-8 payload. Source: https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries

## OSV batch API

The official OSV querybatch endpoint is `POST https://api.osv.dev/v1/querybatch`. It accepts multiple package/version queries and returns results in input order, with vulnerability IDs and modification timestamps in the batch response. Full vulnerability records can be retrieved separately by ID. The API documents per-query pagination tokens and supports package name/ecosystem/version or package URL forms. Source: https://google.github.io/osv.dev/post-v1-querybatch/
