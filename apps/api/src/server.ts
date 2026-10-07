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
import { ServiceError } from "./security/serviceError.js";

import { getRuntimeConfig } from "./config.js";
import { readinessController } from "./controllers/systemController.js";
import { observeRequest } from "./observability.js";
import { router } from "./routes/index.js";
import {
  createDistributedRateLimiter,
  InMemoryRateLimitStore,
} from "./security/distributedRateLimit.js";
import { RedisRestRateLimitStore } from "./security/redisRest.js";
import { getCorrelationId, requestContext } from "./security/auth.js";

const DEFAULT_PORT = 3001;

export function createServer(): Express {
  const config = getRuntimeConfig();
  const app = express();

  app.set("trust proxy", config.TRUST_PROXY_HOPS);
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      origin: config.corsOrigin,
    }),
  );
  app.get("/health/live", (_request, response) => response.json({ status: "alive" }));
  app.get("/health/ready", (request, response, next) => {
    void readinessController(request, response).catch(next);
  });
  app.use(observeRequest);
  app.use(requestContext);
  app.use(
    createDistributedRateLimiter({
      store:
        config.REDIS_REST_URL != null && config.REDIS_REST_TOKEN != null
          ? new RedisRestRateLimitStore(config.REDIS_REST_URL, config.REDIS_REST_TOKEN)
          : new InMemoryRateLimitStore(),
      enabled: config.rateLimitEnabled,
      max: config.RATE_LIMIT_MAX,
      windowMs: config.RATE_LIMIT_WINDOW_MS,
    }),
  );
  app.use(
    "/api/v1/integrations/github/webhooks",
    express.raw({ type: "application/json", limit: "25mb" }),
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

    if (error instanceof ServiceError) {
      response.status(error.status).json({
        error: {
          code: error.code,
          message: error.message,
          correlationId: getCorrelationId(response),
        },
      });
      return;
    }
    if (typeof error === "object" && error != null && "status" in error && error.status === 413) {
      response.status(400).json({
        error: {
          code: "REQUEST_TOO_LARGE",
          message: "Request body exceeds the allowed size.",
          correlationId: getCorrelationId(response),
        },
      });
      return;
    }
    if (error instanceof SyntaxError && "status" in error && error.status === 400) {
      response.status(400).json({
        error: {
          code: "INVALID_JSON",
          message: "Request JSON is invalid.",
          correlationId: getCorrelationId(response),
        },
      });
      return;
    }
    if (error instanceof ZodError) {
      response.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed.",
          issues: error.issues.slice(0, 100).map(({ code, path }) => ({
            code,
            path: path
              .slice(0, 32)
              .map((segment) =>
                typeof segment === "string" ? sanitizeText(segment).slice(0, 128) : segment,
              ),
            message: "Invalid value.",
          })),
          correlationId: getCorrelationId(response),
        },
      });
      return;
    }

    console.error(
      JSON.stringify({
        level: "error",
        correlationId: getCorrelationId(response),
        message: "Request failed.",
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
