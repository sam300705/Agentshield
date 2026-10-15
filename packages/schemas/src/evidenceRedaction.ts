import { PackageURL } from "packageurl-js";
import type { JsonValue } from "./json.schema.js";

const REDACTION_PREFIX = "[REDACTED:";
const REDACTION_SUFFIX = "]";

const PRIVATE_KEY_PATTERN =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;
const GITHUB_TOKEN_PATTERN = /\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,255}\b/g;
const STRIPE_KEY_PATTERN = /\bsk_live_[A-Za-z0-9]{20,255}\b/g;
const AWS_ACCESS_KEY_PATTERN = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g;
const CONNECTION_STRING_PATTERN = /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"'<>]+/gi;
const URL_USERINFO_PATTERN = /([a-z][a-z0-9+.-]*:\/\/)[^\s/?#"'<>]+@/gi;
const URL_QUERY_PATTERN = /([?&])([^=&#\s"'<>]+)=([^&#\s"'<>]*)/g;
const SECRET_ASSIGNMENT_PATTERN =
  /\b((?:api[_-]?key|authorization|client[_-]?secret|github[_-]?token|password|private[_-]?key|secret|token)\s*[:=]\s*["']?)[^\s,;"']{8,}/gi;
const AWS_SECRET_ASSIGNMENT_PATTERN =
  /\b(AWS_SECRET_ACCESS_KEY\s*[:=]\s*["']?)[A-Za-z0-9/+=]{20,}["']?/gi;

function redact(label: string): string {
  return `${REDACTION_PREFIX}${label}${REDACTION_SUFFIX}`;
}

function sanitizeString(value: string): string {
  // Decode components, never the PURL structure. Preserve namespace and version
  // delimiters and their original encoding when no credential was removed.
  if (value.startsWith("pkg:")) {
    try {
      // PURL components must encode reserved URL characters. Reject malformed
      // raw URLs rather than splitting their authority into apparently safe tokens.
      PackageURL.fromString(value);
      const identity = value.split(/[?#]/, 1)[0] ?? "";
      const at = identity.indexOf("@");
      if (
        !/^pkg:[a-z][a-z0-9.+-]*\/[^\s]+$/i.test(value) ||
        /[:\s"'<>]/.test(identity.slice(4)) ||
        value.includes("://") ||
        value.includes("[") ||
        value.includes("]") ||
        (at !== -1 &&
          (identity.indexOf("@", at + 1) !== -1 || identity.slice(at + 1).includes("/")))
      )
        return redact("INVALID_PACKAGE_URL");

      return value
        .split(/([/@?#&=])/)
        .map((component, index, parts) => {
          if (/^[/@?#&=]$/.test(component)) return component;
          if (index > 1 && parts[index - 1] === "=" && credentialQueryKey(parts[index - 2] ?? ""))
            return encodeURIComponent(redact("URL_CREDENTIAL"));
          return sanitizeEncodedComponent(component);
        })
        .join("");
    } catch {
      return redact("INVALID_PACKAGE_URL");
    }
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    try {
      return sanitizePlainText(value)
        .split(/([/?#&=])/)
        .map((part) => (/%[a-f0-9]{2}/i.test(part) ? sanitizeEncodedComponent(part) : part))
        .join("");
    } catch {
      return redact("INVALID_URL");
    }
  }
  // Nested encodings occur in dependency URLs. Re-encode only changed content.
  if (/%[a-f0-9]{2}/i.test(value)) {
    try {
      const decoded = decodeURIComponent(value);
      if (decoded !== value) {
        const safe = sanitizeDecodedLayers(decoded, 1);
        if (safe !== decoded) return encodeURIComponent(safe);
      }
    } catch {
      return redact("INVALID_ENCODING");
    }
  }
  return sanitizePlainText(value);
}

function sanitizePlainText(value: string, depth = 0): string {
  if (depth > 8) return redact("NESTING_LIMIT");
  let sanitized = value;
  sanitized = sanitized.replace(PRIVATE_KEY_PATTERN, redact("PRIVATE_KEY"));
  sanitized = sanitized.replace(CONNECTION_STRING_PATTERN, redact("CONNECTION_STRING"));
  sanitized = sanitized.replace(URL_USERINFO_PATTERN, `$1${redact("URL_USERINFO")}@`);
  sanitized = sanitized.replace(
    URL_QUERY_PATTERN,
    (_match: string, separator: string, key: string, nested: string) => {
      if (credentialQueryKey(key)) return `${separator}${key}=${redact("URL_CREDENTIAL")}`;
      // An outer query value may itself be a URL; do not let it consume inner keys.
      return `${separator}${key}=${sanitizePlainText(nested, depth + 1)}`;
    },
  );

  sanitized = sanitized.replace(AWS_SECRET_ASSIGNMENT_PATTERN, `$1${redact("AWS_SECRET")}`);
  sanitized = sanitized.replace(SECRET_ASSIGNMENT_PATTERN, (match: string, prefix: string) =>
    /^\[REDACTED:(?:SECRET|URL_CREDENTIAL|AWS_SECRET|PRIVATE_KEY|CONNECTION_STRING|URL_USERINFO|BEARER_TOKEN|JWT|GITHUB_TOKEN|STRIPE_KEY|AWS_ACCESS_KEY_ID)\]$/.test(
      match.slice(prefix.length),
    )
      ? match
      : `${prefix}${redact("SECRET")}`,
  );

  sanitized = sanitized.replace(BEARER_PATTERN, redact("BEARER_TOKEN"));
  sanitized = sanitized.replace(JWT_PATTERN, redact("JWT"));
  sanitized = sanitized.replace(GITHUB_TOKEN_PATTERN, redact("GITHUB_TOKEN"));
  sanitized = sanitized.replace(STRIPE_KEY_PATTERN, redact("STRIPE_KEY"));
  sanitized = sanitized.replace(AWS_ACCESS_KEY_PATTERN, redact("AWS_ACCESS_KEY_ID"));
  return sanitized;
}

function sanitizeDecodedLayers(value: string, depth: number): string {
  if (depth > 8) return redact("ENCODING_LIMIT");
  if (/%[a-f0-9]{2}/i.test(value)) {
    const decoded = decodeURIComponent(value);
    const safe = sanitizeDecodedLayers(decoded, depth + 1);
    if (safe !== decoded) return encodeURIComponent(safe);
  }
  // No recursive decoding in this call: the remaining layer is plain text.
  return sanitizePlainText(value);
}

function sanitizeEncodedComponent(value: string): string {
  const decoded = decodeURIComponent(value);
  const safe = sanitizeDecodedLayers(decoded, 1);
  return safe === decoded ? value : encodeURIComponent(safe);
}

function credentialQueryKey(key: string): boolean {
  try {
    for (let depth = 0; depth < 8; depth++) {
      const decoded = decodeURIComponent(key);
      if (decoded === key) return sensitiveFieldName(key) || /^(?:apikey|access_token)$/i.test(key);
      key = decoded;
    }
    return true;
  } catch {
    return true;
  }
}

function sensitiveFieldName(key: string): boolean {
  const normalized = key.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
  return /(?:^|[_\\.-])(?:password|passphrase|secret|token|api_key|access_key|private_key|client_secret|authorization|credential|credentials)(?:$|[_\\.-])/.test(
    normalized,
  );
}

function sanitizeUnknown(value: unknown): JsonValue {
  if (value === null) return null;
  if (value instanceof Date)
    return Number.isFinite(value.getTime()) ? value.toISOString() : redact("INVALID_DATE");
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (Array.isArray(value)) return value.map(sanitizeUnknown);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        sanitizeString(key),
        sensitiveFieldName(key) ? redact("SENSITIVE_FIELD") : sanitizeUnknown(nested),
      ]),
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
