// Authoritative AgentShield scanner/product version shared by the CLI, SARIF
// output, security receipts, and API-constructed scan metadata.
// packages/scanner/package.json must carry the same version; version.test.ts
// fails loudly on drift instead of letting receipts disagree with packaging.
export const SCANNER_VERSION = "0.2.0";

export const SCANNER_RELEASE = `agentshield-scanner@${SCANNER_VERSION}`;
