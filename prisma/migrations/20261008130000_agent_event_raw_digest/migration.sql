-- Add a versioned raw-input identity commitment. Historical records stay unchanged.
-- NULL means a legacy event cannot be safely deduplicated against redacted evidence.
ALTER TABLE "AgentEvent" ADD COLUMN "rawPayloadHash" TEXT;
ALTER TABLE "AgentEvent"
  ADD CONSTRAINT "AgentEvent_rawPayloadHash_format"
  CHECK ("rawPayloadHash" IS NULL OR "rawPayloadHash" ~ '^[a-f0-9]{64}$');
