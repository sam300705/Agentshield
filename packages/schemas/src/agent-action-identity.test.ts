import { expect, it } from "vitest";
import { canonicalAgentActionIdentity } from "./agent-action-identity.js";

it("orders nested evidence by code point and sanitizes before binding", () => {
  const secret = ["token=", "12345678"].join("");
  const identity = canonicalAgentActionIdentity({
    organizationId: "org",
    sessionId: "session",
    actor: "actor",
    action: "RUN_COMMAND",
    resource: "workspace",
    correlationId: "transport",
    idempotencyKey: "key",
    evidence: { nested: { ä: 3, z: 2, a: 1 }, note: secret },
  });
  expect(identity).toContain('"nested":{"a":1,"z":2,"ä":3}');
  expect(identity).not.toContain(secret);
  expect(identity).toContain("[REDACTED:SECRET]");
});
