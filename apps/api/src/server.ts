import "dotenv/config";

import cors from "cors";
import express, {
  type ErrorRequestHandler,
  type Express,
  type Request,
  type Response,
} from "express";
import helmet from "helmet";
import { ZodError } from "zod";

import { router } from "./routes/index.js";
import { getCorrelationId, requestContext } from "./security/auth.js";

const DEFAULT_PORT = 3001;

export function createServer(): Express {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(requestContext);

  app.use("/", router);

  app.use((_request: Request, response: Response) => {
    response.status(404).json({
      error: "NOT_FOUND",
      message: "Route not found.",
    });
  });

  app.use(((error: unknown, _request: Request, response: Response, next) => {
    void next;

    if (error instanceof ZodError) {
      response.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed.",
          issues: error.issues,
          correlationId: getCorrelationId(response),
        },
      });
      return;
    }

    console.error(
      JSON.stringify({
        level: "error",
        correlationId: getCorrelationId(response),
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    response.status(500).json({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred.",
        correlationId: getCorrelationId(response),
      },
    });
  }) satisfies ErrorRequestHandler);

  return app;
}

export function startServer(port = Number(process.env.API_PORT ?? DEFAULT_PORT)) {
  const app = createServer();

  return app.listen(port, () => {
    console.warn(`AgentShield API listening on port ${port}`);
  });
}
