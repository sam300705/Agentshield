import { type Request, type Response } from "express";
import { z } from "zod";

import { prisma } from "../db/prisma.js";

const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  page: z.coerce.number().int().min(1).default(1),
});

function getPagination(query: Request["query"]) {
  const pagination = paginationQuerySchema.parse(query);

  return {
    ...pagination,
    skip: (pagination.page - 1) * pagination.limit,
  };
}

export async function listAuditEventsController(
  request: Request,
  response: Response,
): Promise<void> {
  const { limit, page, skip } = getPagination(request.query);
  const [total, auditEvents] = await Promise.all([
    prisma.auditEvent.count(),
    prisma.auditEvent.findMany({
      orderBy: {
        createdAt: "desc",
      },
      skip,
      take: limit,
    }),
  ]);

  response.json({
    page,
    limit,
    total,
    data: auditEvents,
  });
}
