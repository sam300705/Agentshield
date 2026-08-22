import type {
  Approval,
  AuditEvent,
  Dependency,
  Finding,
  PolicyDecision,
  Remediation,
  Scan,
} from "@agentshield/schemas";

import { getApiAccessToken, notifyApiAuthFailure } from "./auth";

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ||
  "http://localhost:3001";

export interface PaginatedResponse<T> {
  page: number;
  limit: number;
  total: number;
  data: T[];
}

export interface ScanListItem extends Scan {
  _count: {
    findings: number;
    dependencies: number;
  };
}

export interface ScanDetail extends Scan {
  _count: {
    findings: number;
    dependencies: number;
    auditEvents: number;
  };
}

export interface FindingWithRelations extends Finding {
  policyDecision: PolicyDecision | null;
  remediation: Remediation | null;
  approval: Approval | null;
}

export interface ApprovalWithFinding extends Approval {
  finding: FindingWithRelations;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export interface DashboardSummary {
  totalScans: number;
  totalFindings: number;
  pendingApprovalsCount: number;
  latestScan: null | {
    id: string;
    status: Scan["status"];
    repositoryName: string;
    branch: string;
    createdAt: string;
    completedAt: string | null;
    findingsCount: number;
    dependenciesCount: number;
    severityCounts: {
      critical: number;
      high: number;
      medium: number;
      low: number;
    };
    decisionCounts: {
      allow: number;
      warn: number;
      requireApproval: number;
      block: number;
    };
    platformRiskScore: "A" | "B" | "C" | "F";
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  const accessToken = await getApiAccessToken();
  if (accessToken != null) headers.set("Authorization", `Bearer ${accessToken}`);

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    credentials: "omit",
  });

  if (!response.ok) {
    notifyApiAuthFailure(response.status);
    let code: string | null = null;
    let message = `API request failed with status ${response.status}.`;
    try {
      const body = (await response.json()) as {
        error?: { code?: unknown; message?: unknown };
      };
      if (typeof body.error?.code === "string") code = body.error.code;
      if (typeof body.error?.message === "string") message = body.error.message;
    } catch {
      // Keep a stable sanitized error when the server did not return JSON.
    }
    throw new ApiError(response.status, code, message);
  }

  return (await response.json()) as T;
}

export const api = {
  getDashboardSummary() {
    return request<DashboardSummary>("/api/dashboard/summary");
  },
  runDemoScan() {
    return request<{ scanId: string }>("/api/scans/run-demo", {
      method: "POST",
    });
  },
  listScans(limit = 20, page = 1) {
    return request<PaginatedResponse<ScanListItem>>(`/api/scans?limit=${limit}&page=${page}`);
  },
  getScan(scanId: string) {
    return request<{ data: ScanDetail }>(`/api/scans/${scanId}`);
  },
  getFindings(scanId: string, limit = 100, page = 1) {
    return request<PaginatedResponse<FindingWithRelations>>(
      `/api/scans/${scanId}/findings?limit=${limit}&page=${page}`,
    );
  },
  getSbom(scanId: string, limit = 100, page = 1) {
    return request<PaginatedResponse<Dependency>>(
      `/api/scans/${scanId}/sbom?limit=${limit}&page=${page}`,
    );
  },
  listApprovals(limit = 50, page = 1) {
    return request<PaginatedResponse<ApprovalWithFinding>>(
      `/api/approvals?limit=${limit}&page=${page}`,
    );
  },
  approve(approvalId: string, reason: string) {
    return request<{ data: ApprovalWithFinding }>(`/api/approvals/${approvalId}/approve`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  },
  reject(approvalId: string, reason: string) {
    return request<{ data: ApprovalWithFinding }>(`/api/approvals/${approvalId}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  },
  listAuditEvents(limit = 100, page = 1) {
    return request<PaginatedResponse<AuditEvent>>(`/api/audit-events?limit=${limit}&page=${page}`);
  },
};
