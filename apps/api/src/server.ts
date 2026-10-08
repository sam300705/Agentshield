import "./env.js";

import cors from "cors";
import express, {
  type ErrorRequestHandler,
  type Express,
  type Request,
  type Response,
} from "express";
import helmet from "helmet";
import { ZodError } from "zod";

import { sanitizeText } from "@agentshield/schemas";

import { getRuntimeConfig } from "./config.js";
import { router } from "./routes/index.js";
import { createRateLimiter } from "./security/rateLimit.js";
import { getCorrelationId, requestContext } from "./security/auth.js";

const DEFAULT_PORT = 3001;

export function createServer(): Express {
  const config = getRuntimeConfig();
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", config.TRUSTED_PROXY_CIDRS);
  app.use(helmet());
  app.use(
    cors({
      origin: config.corsOrigin,
    }),
  );
  // Reject exhausted IP budgets before signature verification or remote JWKS work.
  app.use(
    createRateLimiter({
      enabled: config.rateLimitEnabled,
      max: config.RATE_LIMIT_MAX,
      windowMs: config.RATE_LIMIT_WINDOW_MS,
      keyForRequest: (request) => `preauth:${request.ip || "unknown"}`,
    }),
  );
  app.use(requestContext);
  app.use(
    createRateLimiter({
      enabled: config.rateLimitEnabled,
      max: config.RATE_LIMIT_MAX,
      windowMs: config.RATE_LIMIT_WINDOW_MS,
    }),
  );
  app.use(
    "/api/v1/integrations/github/webhooks",
    express.raw({ type: "application/json", limit: "1mb" }),
  );
  app.use(express.json({ limit: "1mb" }));

  app.use("/", router);

  app.use((_request: Request, response: Response) => {
    response.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "Route not found.",
        correlationId: getCorrelationId(response),
      },
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

    const parserType =
      error != null && typeof error === "object" && "type" in error ? error.type : undefined;
    if (
      [
        "entity.parse.failed",
        "entity.too.large",
        "request.aborted",
        "request.size.invalid",
        "encoding.unsupported",
        "charset.unsupported",
      ].includes(String(parserType))
    ) {
      const tooLarge = parserType === "entity.too.large";
      const unsupported =
        parserType === "encoding.unsupported" || parserType === "charset.unsupported";
      response.status(tooLarge ? 413 : unsupported ? 415 : 400).json({
        error: {
          code: tooLarge
            ? "PAYLOAD_TOO_LARGE"
            : unsupported
              ? "UNSUPPORTED_ENCODING"
              : "VALIDATION_ERROR",
          message: tooLarge
            ? "Request payload exceeds the permitted size."
            : "Request body is invalid or unsupported.",
          correlationId: getCorrelationId(response),
        },
      });
      return;
    }

    console.error(
      JSON.stringify({
        level: "error",
        correlationId: getCorrelationId(response),
        message: sanitizeText(error instanceof Error ? error.message : "Unknown error"),
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

export function startServer(
  port = Number(process.env.PORT ?? process.env.API_PORT ?? DEFAULT_PORT),
) {
  const app = createServer();

  return app.listen(port, () => {
    console.warn(`AgentShield API listening on port ${port}`);
  });
}
