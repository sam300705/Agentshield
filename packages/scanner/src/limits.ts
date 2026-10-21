export function parsePositiveLimit(
  value: string,
  name: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > maximum)
    throw new Error(`Invalid positive integer limit: ${name}`);
  return limit;
}
