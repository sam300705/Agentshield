import { Response, NextFunction } from "express";
import { Role, SafaEventType, Severity } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { AuthenticatedRequest } from "./auth.js";

export const requireRole = (allowedRoles: Role[]) => {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user;

      if (!user) {
        res.status(401).json({ error: "Unauthorized: User not authenticated" });
        return;
      }

      if (!allowedRoles.includes(user.role)) {
        // If the path includes playbook approval routes, create an audit log
        if (req.originalUrl.includes("/playbooks") && (req.originalUrl.includes("/approve") || req.originalUrl.includes("/reject"))) {
          await prisma.safaAuditLog.create({
            data: {
              eventType: SafaEventType.UNAUTHORIZED_APPROVAL_ATTEMPT,
              severity: Severity.HIGH,
              description: `User ${user.id} with role ${user.role} attempted unauthorized action on playbook route ${req.originalUrl}`,
              metadata: {
                route: req.originalUrl,
                method: req.method,
                timestamp: new Date().toISOString(),
                // Fill dummy values for the strict SafaIncidentMetadataSchema Zod requirement if it gets parsed later
                modelVersion: "N/A",
                latencyMs: 0,
                tokenCount: 0,
                rawInput: "N/A",
                blockedCommand: "N/A"
              },
              userId: user.id,
            },
          });
        }

        res.status(403).json({ error: "Forbidden: Insufficient privileges" });
        return;
      }

      next();
    } catch (error) {
      console.error("RBAC middleware error:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  };
};
