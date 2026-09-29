import { describe, expect, it } from "vitest";
import { evaluateFindings } from "./evaluator.js";
import { findingSchema } from "@agentshield/schemas";

describe("evaluator - OPA-style policy evaluation", () => {
  it("flags a Kubernetes Pod manifest missing securityContext.runAsNonRoot: true", () => {
    const scanId = "test-scan-123";

    // Synthetic finding representing a Kubernetes container with privileged execution/missing securityContext controls
    const finding = findingSchema.parse({
      id: "f-123",
      scanId,
      category: "KUBERNETES",
      severity: "CRITICAL",
      title: "Kubernetes container runs privileged or lacks runAsNonRoot",
      description: "The pod manifest securityContext is missing runAsNonRoot: true or runs privileged",
      filePath: "deploy/pod.yaml",
      lineStart: 12,
      lineEnd: 12,
      evidence: {
        ruleId: "kubernetes.privileged_container",
        field: "securityContext.privileged",
        value: true,
      },
      fingerprint: "kubernetes:kubernetes.privileged_container:abcdef123456",
      createdAt: new Date(),
    });

    const decisions = evaluateFindings([finding], scanId);

    expect(decisions).toHaveLength(1);
    const decision = decisions[0];
    expect(decision).toBeDefined();
    if (decision) {
      expect(decision.decision).toBe("BLOCK");
      expect(decision.ruleId).toBe("kubernetes.privileged_container.block");
      expect(decision.reason).toContain("Blocked because Privileged containers can bypass workload isolation");
    }
  });
});
