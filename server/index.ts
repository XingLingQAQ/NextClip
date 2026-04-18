import express, { type Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";

const app = express();
const httpServer = createServer(app);

const DEBUG_LOG_ENABLED = process.env.LOG_DEBUG === "true";

const MASKED_VALUE = "[REDACTED]";
const SENSITIVE_FIELD_RULES: RegExp[] = [
  /token/i,
  /password/i,
  /^clip(content)?$/i,
  /attachmentmetadata/i,
  /^attachment$/i,
  /^attachments$/i,
];

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
    requestId?: string;
  }
}

function shouldMaskField(fieldName: string): boolean {
  const normalizedFieldName = fieldName.replace(/[\s_.-]/g, "");
  return SENSITIVE_FIELD_RULES.some((rule) => rule.test(normalizedFieldName));
}

function sanitizeForLogging(value: unknown, keyPath = ""): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) =>
      sanitizeForLogging(item, keyPath ? `${keyPath}[${index}]` : `${index}`),
    );
  }

  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).reduce(
      (acc, [key, nestedValue]) => {
        const nextPath = keyPath ? `${keyPath}.${key}` : key;
        if (shouldMaskField(key) || shouldMaskField(nextPath)) {
          acc[key] = MASKED_VALUE;
          return acc;
        }

        acc[key] = sanitizeForLogging(nestedValue, nextPath);
        return acc;
      },
      {} as Record<string, unknown>,
    );
  }

  return value;
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  req.requestId = (req.headers["x-request-id"] as string | undefined) || randomUUID();
  res.setHeader("x-request-id", req.requestId);

  next();
});

app.use((req, res, next) => {
  const start = Date.now();
  const route = req.path;
  let errorCode: string | undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    if (bodyJson && typeof bodyJson === "object") {
      const responseBody = bodyJson as Record<string, unknown>;
      const code = responseBody["error-code"] ?? responseBody.errorCode ?? responseBody.code;
      if (typeof code === "string") {
        errorCode = code;
      }
    }

    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    if (!route.startsWith("/api")) {
      return;
    }

    const latency = Date.now() - start;
    const summary = {
      route,
      status: res.statusCode,
      latency: `${latency}ms`,
      "request-id": req.requestId,
      "error-code": errorCode ?? "-",
    };

    log(JSON.stringify(summary));

    if (DEBUG_LOG_ENABLED) {
      const debugPayload = {
        method: req.method,
        query: sanitizeForLogging(req.query),
        params: sanitizeForLogging(req.params),
        body: sanitizeForLogging(req.body),
      };
      log(JSON.stringify(debugPayload), "express-debug");
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
