/**
 * Authority wire format v1 accepts JSON.stringify-compatible literal spellings,
 * with optional insignificant whitespace. Native parsing handles JSON grammar;
 * comparison rejects duplicate keys, ambiguous key/value escapes and numbers.
 * This deliberately narrows ingress, rather than implementing another JSON parser.
 */
export function verifyAuthorityJson(buffer: Buffer): void {
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer);
  const parsed: unknown = JSON.parse(text);
  let compact = "",
    inString = false,
    escaped = false;
  for (const character of text) {
    if (inString) {
      compact += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
    } else if (character === '"') {
      inString = true;
      compact += character;
    } else if (!/[\t\n\r ]/.test(character)) compact += character;
  }
  if (compact !== JSON.stringify(parsed)) throw new Error("Ambiguous authority JSON encoding.");
}
