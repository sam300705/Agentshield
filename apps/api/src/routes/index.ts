import {
  type NextFunction,
  type Request,
  type Response,
  type RequestHandler,
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
import {
  getScanController,
  getScanFindingsController,
  getScanSbomController,
  listScansController,
  runDemoScanController,
} from "../controllers/scanController.js";
import { devLoginController, logoutController, meController } from "../controllers/authController.js";
import scanEventsRouter from "./scanEvents.js";
import { authenticate, type AuthenticatedRequest } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";

type AsyncRouteHandler = (
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
) => Promise<void>;

function asyncHandler(handler: AsyncRouteHandler): RequestHandler {
  return (request: Request, response: Response, next: NextFunction) => {
    void handler(request as AuthenticatedRequest, response, next).catch(next);
  };
}

export const router: ExpressRouter = Router();

router.get("/health", (_request, response) => {
  response.status(200).json({
    service: "agentshield-api",
    status: "ok",
  });
});

// Authentication
router.post("/api/auth/dev-login", asyncHandler(devLoginController));
router.post("/api/auth/logout", logoutController);
router.get("/api/auth/me", authenticate as RequestHandler, meController as RequestHandler);

// Scans (VIEWER and above for reads, ADMIN for trigger)
router.post("/api/scans/run-demo", authenticate as RequestHandler, requireRole(["ADMIN"]) as RequestHandler, asyncHandler(runDemoScanController));
router.get("/api/scans", authenticate as RequestHandler, requireRole(["VIEWER", "REVIEWER", "ADMIN"]) as RequestHandler, asyncHandler(listScansController));
router.get("/api/scans/:scanId", authenticate as RequestHandler, requireRole(["VIEWER", "REVIEWER", "ADMIN"]) as RequestHandler, asyncHandler(getScanController));
router.get("/api/scans/:scanId/findings", authenticate as RequestHandler, requireRole(["VIEWER", "REVIEWER", "ADMIN"]) as RequestHandler, asyncHandler(getScanFindingsController));
router.get("/api/scans/:scanId/sbom", authenticate as RequestHandler, requireRole(["VIEWER", "REVIEWER", "ADMIN"]) as RequestHandler, asyncHandler(getScanSbomController));

// Approvals (VIEWER for list, REVIEWER+ for actions)
router.get("/api/approvals", authenticate as RequestHandler, requireRole(["VIEWER", "REVIEWER", "ADMIN"]) as RequestHandler, asyncHandler(listPendingApprovalsController));
router.post("/api/approvals/:approvalId/approve", authenticate as RequestHandler, requireRole(["REVIEWER", "ADMIN"]) as RequestHandler, asyncHandler(approveApprovalController));
router.post("/api/approvals/:approvalId/reject", authenticate as RequestHandler, requireRole(["REVIEWER", "ADMIN"]) as RequestHandler, asyncHandler(rejectApprovalController));

// Audit Events (VIEWER+)
router.get("/api/audit-events", authenticate as RequestHandler, requireRole(["VIEWER", "REVIEWER", "ADMIN"]) as RequestHandler, asyncHandler(listAuditEventsController));

// Dashboard Summary (VIEWER+)
router.get("/api/dashboard/summary", authenticate as RequestHandler, requireRole(["VIEWER", "REVIEWER", "ADMIN"]) as RequestHandler, asyncHandler(getDashboardSummaryController));

// Scan Events Stream
router.use("/api/scans", scanEventsRouter);
