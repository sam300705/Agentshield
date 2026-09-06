import {
  agentApprovalSchema,
  agentAuthorizationRequestSchema,
  agentDecisionSchema,
  agentEventInputSchema,
  type AgentApproval,
  type AgentAuthorizationRequest,
  type AgentDecision,
  type AgentEventInput,
} from "@agentshield/schemas";

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
    const baseUrl = options.baseUrl.replace(/\/$/, "");
    if (!/^https?:\/\//.test(baseUrl))
      throw new Error("AgentShield baseUrl must be HTTPS or HTTP.");
    this.baseUrl = baseUrl;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.accessToken = options.accessToken;
  }

  private async request<T>(path: string, method: "GET" | "POST", body?: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
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

  async getApproval(approvalId: string): Promise<AgentApprovalResponse> {
    if (!/^[A-Za-z0-9._:-]{1,256}$/.test(approvalId)) {
      throw new Error("Invalid approval ID.");
    }
    const response = await this.request<AgentApprovalResponse>(
      `/api/v1/agent/approvals/${encodeURIComponent(approvalId)}`,
      "GET",
    );
    return { data: agentApprovalSchema.parse(response.data) };
  }

  async waitForApproval(
    approvalId: string,
    options: { intervalMs?: number; timeoutMs?: number } = {},
  ): Promise<AgentApprovalResponse> {
    const intervalMs = Math.min(Math.max(options.intervalMs ?? 1_000, 100), 30_000);
    const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 300_000, intervalMs), 900_000);
    const startedAt = Date.now();
    while (true) {
      const approval = await this.getApproval(approvalId);
      if (approval.data.status !== "PENDING") return approval;
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error("Timed out waiting for AgentShield approval.");
      }
      await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
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
    (approval.resource ?? "") !== input.resource.trim()
  ) {
    throw new Error("Agent approval is not bound to this protected action.");
  }
  if (approval.status !== "APPROVED") {
    throw new Error(`Agent approval is ${approval.status.toLowerCase()}.`);
  }
}

export function assertAgentActionAllowed(
  action: AgentAuthorizationRequest["action"],
  decision: AgentDecision,
  approval?: AgentApproval,
): void {
  agentDecisionSchema.parse(decision);
  if (!decision.allowed || decision.decision === "BLOCK") {
    throw new Error(`Agent action ${action} was denied by policy.`);
  }
  if (decision.decision === "REQUIRE_APPROVAL") {
    if (approval?.status !== "APPROVED") {
      throw new Error(`Agent action ${action} requires human approval.`);
    }
    if (approval.actionType !== action) {
      throw new Error("Agent approval is not bound to this action.");
    }
    if (decision.approvalId != null && approval.id !== decision.approvalId) {
      throw new Error("Agent approval does not match the authorization decision.");
    }
  }
}
