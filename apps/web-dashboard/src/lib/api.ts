import type {
  Approval,
  AuditEvent,
  Dependency,
  Finding,
  PolicyDecision,
  Remediation,
  Scan,
} from "@agentshield/schemas";

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
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
    ...init,
  });

  if (!response.ok) {
    throw new Error(`API request failed with ${response.status}`);
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
