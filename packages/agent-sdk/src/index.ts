import {
  agentAuthorizationRequestSchema,
  agentDecisionSchema,
  agentEventInputSchema,
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

  async getReceipt(scanId: string): Promise<AgentReceiptResponse> {
    if (!/^[A-Za-z0-9._:-]{1,256}$/.test(scanId)) throw new Error("Invalid scan ID.");
    return this.request<AgentReceiptResponse>(
      `/api/v1/receipts/${encodeURIComponent(scanId)}`,
      "GET",
    );
  }
}

export function assertAgentActionAllowed(
  action: AgentAuthorizationRequest["action"],
  decision: AgentDecision,
): void {
  agentDecisionSchema.parse(decision);
  if (!decision.allowed || decision.decision === "BLOCK") {
    throw new Error(`Agent action ${action} was denied by policy.`);
  }
  if (decision.decision === "REQUIRE_APPROVAL") {
    throw new Error(`Agent action ${action} requires human approval.`);
  }
}
