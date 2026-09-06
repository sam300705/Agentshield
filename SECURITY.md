# Security Policy

AgentShield is a security-control-plane prototype. It is designed to support careful engineering review, but it is not a certification of security, clinical safety, legal compliance, or suitability for any particular environment.

## Supported versions

Until a formal release-support policy is published, security fixes are applied to the latest commit on `main` and the latest open hardening branch. Older commits and private forks are not guaranteed to receive fixes. Deployments should track a reviewed commit rather than an unpinned branch.

| Version or state                        | Support expectation                                                      |
| --------------------------------------- | ------------------------------------------------------------------------ |
| Latest reviewed commit on `main`        | Security issues are assessed and fixed when accepted by the maintainers. |
| Latest open release or hardening branch | Security issues may be fixed while the branch is under active review.    |
| Older commits, previews, and forks      | No guaranteed security support.                                          |

## Private vulnerability reporting

Please use GitHub's **Private vulnerability reporting** or a private GitHub Security Advisory in the repository's **Security** tab when that feature is enabled. If private reporting is unavailable, contact the repository maintainers through a private GitHub channel before opening an issue. Do not disclose the vulnerability publicly until the maintainers have had a reasonable opportunity to investigate.

Do not include passwords, API keys, access tokens, private keys, database connection strings, customer records, repository contents, medical information, or other sensitive data in a report. Use synthetic examples and redact logs. Never upload a secret merely to demonstrate a secret-handling issue; describe its type and location instead, then rotate it immediately if it was exposed.

A useful report should include the affected commit or deployment, the component and endpoint, a concise description of the security impact, reproducible steps or a minimal synthetic proof of concept, prerequisites and permissions, affected configurations, and any proposed mitigation. Include timestamps and correlation IDs only when they are privacy-safe. Do not use real customer or production data in testing.

## Response targets

These are engineering targets, not contractual guarantees. The maintainers aim to acknowledge a private report within **3 business days**, complete initial triage within **10 business days**, and provide a status update at least every **14 days** while a report remains open. Remediation and disclosure timing depend on severity, exploitability, affected deployments, available maintainers, and any coordinated-disclosure requests.

| Severity                       | Target handling                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| Critical or actively exploited | Immediate triage, containment guidance, and an expedited fix or mitigation when feasible. |
| High                           | Prioritized investigation and remediation in the next appropriate security release.       |
| Moderate or low                | Reviewed during normal maintenance and scheduled according to risk.                       |

## Responsible disclosure

Please allow the maintainers reasonable time to validate the report, prepare a fix, notify affected operators where appropriate, and publish a sanitized advisory. Coordinate public disclosure dates with the maintainers. Do not access, modify, retain, or exfiltrate data that is not yours; do not perform denial-of-service testing; do not target third-party services; and do not bypass authentication on systems you do not own or have explicit authorization to test.

## Limited safe harbor

Good-faith research that follows this policy, uses synthetic or authorized data, avoids privacy and availability harm, and stops promptly after confirming the issue will be considered favorably when the maintainers evaluate the report. This statement is a project policy, not a waiver of law, a promise of immunity, or legal advice. Researchers remain responsible for complying with applicable law, contracts, and authorization requirements.

## Security boundaries

AgentShield does not claim SOC 2, ISO 27001, HIPAA, GDPR, or any other certification or legal compliance status. Production operators remain responsible for identity-provider configuration, secrets management, network controls, data retention, backups, incident response, and the legal and regulatory requirements applicable to their deployment.
