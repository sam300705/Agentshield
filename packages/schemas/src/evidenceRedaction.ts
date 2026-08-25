import type { JsonValue } from "./json.schema.js";

const REDACTION_PREFIX = "[REDACTED:";
const REDACTION_SUFFIX = "]";

const PRIVATE_KEY_PATTERN =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;
const GITHUB_TOKEN_PATTERN = /\bgh[pousr]_[A-Za-z0-9_]{20,255}\b/g;
const AWS_ACCESS_KEY_PATTERN = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g;
const CONNECTION_STRING_PATTERN = /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"'<>]+/gi;
const CREDENTIAL_URL_PATTERN =
  /([?&](?:access_token|api_key|apikey|client_secret|password|secret|token)=)[^&\s"'<>]+/gi;
const SECRET_ASSIGNMENT_PATTERN =
  /\b((?:api[_-]?key|authorization|client[_-]?secret|github[_-]?token|password|private[_-]?key|secret|token)\s*[:=]\s*["']?)[^\s,;"']{8,}/gi;
const AWS_SECRET_ASSIGNMENT_PATTERN =
  /\b(AWS_SECRET_ACCESS_KEY\s*[:=]\s*["']?)[A-Za-z0-9/+=]{20,}["']?/gi;

function redact(label: string): string {
  return `${REDACTION_PREFIX}${label}${REDACTION_SUFFIX}`;
}

function sanitizeString(value: string): string {
  let sanitized = value;
  sanitized = sanitized.replace(PRIVATE_KEY_PATTERN, redact("PRIVATE_KEY"));
  sanitized = sanitized.replace(CONNECTION_STRING_PATTERN, redact("CONNECTION_STRING"));
  sanitized = sanitized.replace(CREDENTIAL_URL_PATTERN, `$1${redact("URL_CREDENTIAL")}`);
  sanitized = sanitized.replace(AWS_SECRET_ASSIGNMENT_PATTERN, `$1${redact("AWS_SECRET")}`);
  sanitized = sanitized.replace(SECRET_ASSIGNMENT_PATTERN, `$1${redact("SECRET")}`);
  sanitized = sanitized.replace(BEARER_PATTERN, redact("BEARER_TOKEN"));
  sanitized = sanitized.replace(JWT_PATTERN, redact("JWT"));
  sanitized = sanitized.replace(GITHUB_TOKEN_PATTERN, redact("GITHUB_TOKEN"));
  sanitized = sanitized.replace(AWS_ACCESS_KEY_PATTERN, redact("AWS_ACCESS_KEY_ID"));
  return sanitized;
}

function sanitizeUnknown(value: unknown): JsonValue {
  if (value === null) return null;
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (Array.isArray(value)) return value.map(sanitizeUnknown);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [sanitizeString(key), sanitizeUnknown(nested)]),
    );
  }
  return redact("UNSUPPORTED_VALUE");
}

export function sanitizeEvidence(value: unknown): JsonValue {
  return sanitizeUnknown(value);
}

export function sanitizeText(value: string): string {
  return sanitizeString(value);
}
