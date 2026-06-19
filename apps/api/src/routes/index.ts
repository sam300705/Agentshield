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
) => Promise<void>;

function asyncHandler(handler: AsyncRouteHandler) {
  return (request: Request, response: Response, next: NextFunction) => {
    void handler(request, response, next).catch(next);
  };
}

export const router: ExpressRouter = Router();

router.get("/health", (_request, response) => {
  response.status(200).json({
    service: "agentshield-api",
    status: "ok",
  });
});

router.post("/api/scans/run-demo", asyncHandler(runDemoScanController));
router.get("/api/scans", asyncHandler(listScansController));
router.get("/api/scans/:scanId", asyncHandler(getScanController));
router.get("/api/scans/:scanId/findings", asyncHandler(getScanFindingsController));
router.get("/api/scans/:scanId/sbom", asyncHandler(getScanSbomController));
router.get("/api/approvals", asyncHandler(listPendingApprovalsController));
router.post("/api/approvals/:approvalId/approve", asyncHandler(approveApprovalController));
router.post("/api/approvals/:approvalId/reject", asyncHandler(rejectApprovalController));
router.get("/api/audit-events", asyncHandler(listAuditEventsController));
router.get("/api/dashboard/summary", asyncHandler(getDashboardSummaryController));
