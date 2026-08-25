import {
  type NextFunction,
  type Request,
  type Response,
  Router,
  type Router as ExpressRouter,
} from "express";

import {
  approveApprovalController,
  listPendingApprovalsController,
  rejectApprovalController,
} from "../controllers/approvalController.js";
import { listAuditEventsController } from "../controllers/auditController.js";
import { getDashboardSummaryController } from "../controllers/dashboardController.js";
import { getDemoControlPlaneController } from "../controllers/controlPlaneController.js";
import { metricsController, readinessController } from "../controllers/systemController.js";
import { requirePermission } from "../security/auth.js";
import {
  getScanController,
  getScanFindingsController,
  getScanSbomController,
  listScansController,
  runDemoScanController,
} from "../controllers/scanController.js";

type AsyncRouteHandler = (
  request: Request,
  response: Response,
  next: NextFunction,
) => Promise<void> | void;

function asyncHandler(handler: AsyncRouteHandler) {
  return (request: Request, response: Response, next: NextFunction) => {
    void Promise.resolve(handler(request, response, next)).catch(next);
  };
}

export const router: ExpressRouter = Router();

router.get("/health", (_request, response) => {
  response.status(200).json({
    service: "agentshield-api",
    status: "ok",
  });
});
router.get("/health/live", (_request, response) =>
  response.json({ service: "agentshield-api", status: "alive" }),
);
router.get("/health/ready", asyncHandler(readinessController));
router.get("/metrics", requirePermission("organization:manage"), asyncHandler(metricsController));

router.get(
  "/api/v1/demo/control-plane",
  requirePermission("scan:read"),
  asyncHandler(getDemoControlPlaneController),
);
router.post(
  "/api/scans/run-demo",
  requirePermission("scan:run"),
  asyncHandler(runDemoScanController),
);
router.get("/api/scans", requirePermission("scan:read"), asyncHandler(listScansController));
router.get("/api/scans/:scanId", requirePermission("scan:read"), asyncHandler(getScanController));
router.get(
  "/api/scans/:scanId/findings",
  requirePermission("scan:read"),
  asyncHandler(getScanFindingsController),
);
router.get(
  "/api/scans/:scanId/sbom",
  requirePermission("scan:read"),
  asyncHandler(getScanSbomController),
);
router.get(
  "/api/approvals",
  requirePermission("approval:review"),
  asyncHandler(listPendingApprovalsController),
);
router.post(
  "/api/approvals/:approvalId/approve",
  requirePermission("approval:review"),
  asyncHandler(approveApprovalController),
);
router.post(
  "/api/approvals/:approvalId/reject",
  requirePermission("approval:review"),
  asyncHandler(rejectApprovalController),
);
router.get(
  "/api/audit-events",
  requirePermission("scan:read"),
  asyncHandler(listAuditEventsController),
);
router.get(
  "/api/dashboard/summary",
  requirePermission("scan:read"),
  asyncHandler(getDashboardSummaryController),
);
