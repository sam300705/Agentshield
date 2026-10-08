import { expect, it } from "vitest";
import { canonicalAgentActionIdentity } from "./agent-action-identity.js";

it("orders raw JSON evidence by code point without conflating secrets", () => {
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
  expect(identity).toContain(secret);
  expect(identity).toContain("agent-action@3");
});

it.each([Infinity, () => "value", new Date()])("rejects non-JSON action evidence", (value) => {
  expect(() =>
    canonicalAgentActionIdentity({
      organizationId: "org",
      sessionId: "session",
      actor: "actor",
      action: "RUN_COMMAND",
      resource: "workspace",
      correlationId: "transport",
      idempotencyKey: "key",
      evidence: { value },
    }),
  ).toThrow();
});

it("preserves reserved property names in the raw JSON action identity", () => {
  const input = {
    organizationId: "org",
    sessionId: "session",
    actor: "actor",
    action: "RUN_COMMAND" as const,
    resource: "workspace",
    correlationId: "transport",
    idempotencyKey: "key",
  };
  const first = canonicalAgentActionIdentity({
    ...input,
    evidence: JSON.parse('{"command":"safe","__proto__":{"value":"one"}}') as unknown,
  });
  const second = canonicalAgentActionIdentity({
    ...input,
    evidence: JSON.parse('{"command":"safe","__proto__":{"value":"two"}}') as unknown,
  });
  expect(first).toContain('"__proto__":{"value":"one"}');
  expect(first).not.toBe(second);
  expect(Object.prototype).not.toHaveProperty("value");
});
