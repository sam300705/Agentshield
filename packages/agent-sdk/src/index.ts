import {
  canonicalAgentActionIdentity,
  agentApprovalSchema,
  agentAuthorizationRequestSchema,
  agentDecisionSchema,
  agentEventInputSchema,
  type AgentApproval,
  type AgentAuthorizationRequest,
  type AgentDecision,
  type AgentEventInput,
} from "@agentshield/schemas";
import { createHash } from "node:crypto";

export interface AgentShieldClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  accessToken?: string;
}

export interface AgentDecisionResponse {
  data: AgentDecision;
}

export interface AgentEventResponse {
  accepted: boolean;
  eventId?: string;
  correlationId: string;
}

export interface AgentReceiptResponse {
  data: unknown;
}

export interface AgentApprovalResponse {
  data: AgentApproval;
}

export class AgentShieldClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly accessToken: string | undefined;

  constructor(options: AgentShieldClientOptions) {
    const baseUrl = new URL(options.baseUrl);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(baseUrl.hostname);
    if (
      baseUrl.username ||
      baseUrl.password ||
      baseUrl.search ||
      baseUrl.hash ||
      (baseUrl.protocol !== "https:" && !(baseUrl.protocol === "http:" && loopback))
    )
      throw new Error("AgentShield baseUrl requires HTTPS except for loopback development.");
    this.baseUrl = baseUrl.href.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.accessToken = options.accessToken;
  }

  private async request<T>(
    path: string,
    method: "GET" | "POST",
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      redirect: "error",
      ...(signal == null ? {} : { signal }),
      headers: {
        Accept: "application/json",
        ...(body == null ? {} : { "Content-Type": "application/json" }),
        ...(this.accessToken == null ? {} : { Authorization: `Bearer ${this.accessToken}` }),
      },
      ...(body == null ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`AgentShield request failed with status ${response.status}.`);
    return (await response.json()) as T;
  }

  async authorize(input: AgentAuthorizationRequest): Promise<AgentDecisionResponse> {
    const validated = agentAuthorizationRequestSchema.parse(input);
    const response = await this.request<AgentDecisionResponse>(
      "/api/v1/agent/authorize",
      "POST",
      validated,
    );
    return { data: agentDecisionSchema.parse(response.data) };
  }

  async decide(input: AgentAuthorizationRequest): Promise<AgentDecisionResponse> {
    const validated = agentAuthorizationRequestSchema.parse(input);
    const response = await this.request<AgentDecisionResponse>(
      "/api/v1/agent/decision",
      "POST",
      validated,
    );
    return { data: agentDecisionSchema.parse(response.data) };
  }

  async recordEvent(input: AgentEventInput): Promise<AgentEventResponse> {
    const validated = agentEventInputSchema.parse(input);
    return this.request<AgentEventResponse>("/api/v1/agent/events", "POST", validated);
  }

  async requestApproval(input: AgentAuthorizationRequest): Promise<AgentApprovalResponse> {
    const validated = agentAuthorizationRequestSchema.parse(input);
    const response = await this.request<AgentApprovalResponse>(
      "/api/v1/agent/approvals",
      "POST",
      validated,
    );
    return { data: agentApprovalSchema.parse(response.data) };
  }

  async getApproval(approvalId: string, signal?: AbortSignal): Promise<AgentApprovalResponse> {
    if (!/^[A-Za-z0-9._:-]{1,256}$/.test(approvalId)) {
      throw new Error("Invalid approval ID.");
    }
    const response = await this.request<AgentApprovalResponse>(
      `/api/v1/agent/approvals/${encodeURIComponent(approvalId)}`,
      "GET",
      undefined,
      signal,
    );
    return { data: agentApprovalSchema.parse(response.data) };
  }

  async waitForApproval(
    approvalId: string,
    options: { intervalMs?: number; timeoutMs?: number } = {},
  ): Promise<AgentApprovalResponse> {
    const intervalMs = Math.min(Math.max(options.intervalMs ?? 1_000, 100), 30_000);
    const timeoutMs = Math.min(options.timeoutMs ?? 300_000, 900_000);
    if (!Number.isFinite(intervalMs) || !Number.isFinite(timeoutMs) || timeoutMs <= 0)
      throw new Error("Invalid approval polling timeout or interval.");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pause: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const error = new Error("Timed out waiting for AgentShield approval.");
        reject(error);
        controller.abort(error);
      }, timeoutMs);
    });
    try {
      while (true) {
        const approval = await Promise.race([
          this.getApproval(approvalId, controller.signal),
          deadline,
        ]);
        if (approval.data.status !== "PENDING") return approval;
        await Promise.race([
          new Promise<void>((resolve) => {
            pause = setTimeout(resolve, intervalMs);
          }),
          deadline,
        ]);
      }
    } finally {
      clearTimeout(timer);
      clearTimeout(pause);
      controller.abort();
    }
  }

  async getReceipt(scanId: string): Promise<AgentReceiptResponse> {
    if (!/^[A-Za-z0-9._:-]{1,256}$/.test(scanId)) throw new Error("Invalid scan ID.");
    return this.request<AgentReceiptResponse>(
      `/api/v1/receipts/${encodeURIComponent(scanId)}`,
      "GET",
    );
  }
}

export function assertAgentApprovalMatches(
  input: AgentAuthorizationRequest,
  approval: AgentApproval,
): void {
  agentAuthorizationRequestSchema.parse(input);
  agentApprovalSchema.parse(approval);
  if (
    approval.organizationId !== input.organizationId ||
    approval.sessionId !== input.sessionId ||
    approval.actor !== input.actor ||
    approval.requestedBy !== input.actor ||
    approval.actionType !== input.action ||
    approval.idempotencyKey !== input.idempotencyKey ||
    (approval.resource ?? "") !== input.resource.trim() ||
    approval.actionDigest !==
      createHash("sha256").update(canonicalAgentActionIdentity(input)).digest("hex")
  ) {
    throw new Error("Agent approval is not bound to this protected action.");
  }
  if (approval.status !== "APPROVED") {
    throw new Error(`Agent approval is ${approval.status.toLowerCase()}.`);
  }
}

export function assertAgentActionAllowed(
  input: AgentAuthorizationRequest,
  decision: AgentDecision,
  approval?: AgentApproval,
): void {
  const { action } = agentAuthorizationRequestSchema.parse(input);
  agentDecisionSchema.parse(decision);
  if (!decision.allowed || decision.decision === "BLOCK") {
    throw new Error(`Agent action ${action} was denied by policy.`);
  }
  if (decision.decision === "REQUIRE_APPROVAL") {
    if (approval?.status !== "APPROVED") {
      throw new Error(`Agent action ${action} requires human approval.`);
    }
    assertAgentApprovalMatches(input, approval);
    if (decision.approvalId != null && approval.id !== decision.approvalId) {
      throw new Error("Agent approval does not match the authorization decision.");
    }
  }
}
