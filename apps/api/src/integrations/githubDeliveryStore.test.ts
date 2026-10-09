import { Prisma, type PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { PrismaGitHubDeliveryStore, type GitHubDeliveryClaim } from "./githubDeliveryStore.js";
const claim: GitHubDeliveryClaim = {
  organizationId: "org",
  webhook: {
    installationId: 42,
    deliveryId: "delivery",
    eventName: "push",
    action: null,
    repositoryFullName: "org/repo",
    organizationLogin: "org",
    payload: {},
  },
  rawPayload: Buffer.from("{}"),
  correlationId: "corr",
};
const uniqueError = () =>
  new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "6" });
function fixture() {
  const delivery = {
    create: vi.fn().mockResolvedValue({}),
    findUnique: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  return {
    delivery,
    store: new PrismaGitHubDeliveryStore({
      gitHubWebhookDelivery: delivery,
    } as unknown as PrismaClient),
  };
}
describe("webhook delivery retry claims", () => {
  it("claims first delivery with a bounded processing lease", async () => {
    const { store, delivery } = fixture();
    expect(await store.claim(claim)).toBe(true);
    expect(delivery.create).toHaveBeenCalledWith(
      contains({
        data: contains({ attempts: 1, nextAttemptAt: dateMatcher }),
      }),
    );
  });
  it("reclaims failed identical payloads atomically and fences subsequent updates", async () => {
    const { store, delivery } = fixture();
    delivery.create.mockRejectedValue(uniqueError());
    delivery.findUnique.mockResolvedValue({
      id: "row",
      attempts: 2,
      payloadHash: createHash("sha256").update(claim.rawPayload).digest("hex"),
    });
    expect(await store.claim(claim)).toBe(true);
    expect(
      (delivery.updateMany.mock.calls[0]?.[0] as { where: { OR: { status: unknown }[] } }).where,
    ).toMatchObject({
      attempts: 2,
      OR: includes([{ status: "FAILED" }]),
    });
    await store.markQueued("org", "delivery", "scan");
    expect(delivery.updateMany).toHaveBeenLastCalledWith(
      contains({
        where: contains({ attempts: 3 }),
        data: contains({ scanId: "scan" }),
      }),
    );
  });
  it("rejects completed, concurrent or active duplicate claims", async () => {
    const { store, delivery } = fixture();
    delivery.create.mockRejectedValue(uniqueError());
    delivery.findUnique.mockResolvedValue({
      id: "row",
      attempts: 1,
      payloadHash: createHash("sha256").update(claim.rawPayload).digest("hex"),
    });
    delivery.updateMany.mockResolvedValue({ count: 0 });
    expect(await store.claim(claim)).toBe(false);
    const predicates = (
      delivery.updateMany.mock.calls[0]?.[0] as { where: { OR: { status: unknown }[] } }
    ).where.OR;
    expect(
      predicates.every(
        (p: { status: unknown }) => p.status !== "QUEUED" && p.status !== "PROCESSED",
      ),
    ).toBe(true);
  });
  it("rejects a changed payload using the same delivery ID", async () => {
    const { store, delivery } = fixture();
    delivery.create.mockRejectedValue(uniqueError());
    delivery.findUnique.mockResolvedValue({ payloadHash: "different" });
    expect(await store.claim(claim)).toBe(false);
    expect(delivery.updateMany).not.toHaveBeenCalled();
  });
});

function contains(value: Record<string, unknown>): unknown {
  return expect.objectContaining(value) as unknown;
}
function includes(value: unknown[]): unknown {
  return expect.arrayContaining(value) as unknown;
}
const dateMatcher: unknown = expect.any(Date);
