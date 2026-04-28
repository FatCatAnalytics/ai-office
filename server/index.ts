import "dotenv/config";
import express, { Response, NextFunction } from 'express';
import type { Request } from 'express';
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { scheduleDailyModelRefresh } from "./modelsRefresh";
import { assertAuthConfigured, requireAuth } from "./auth";
import { createServer } from "node:http";

// Stage 4.18: refuse to boot if the password gate is misconfigured.
// Layered behind Cloudflare (which already filters bots and AI scrapers),
// this gives us application-level access control with zero external deps.
assertAuthConfigured();

const app = express();
const httpServer = createServer(app);

// Trust the proxy in front of us (Cloudflare → our reverse proxy → Node)
// so req.ip / Secure-cookie logic and CF-Connecting-IP work correctly.
app.set("trust proxy", true);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

// Stage 4.18: tell well-behaved crawlers (and AI bots that respect headers)
// to skip the entire site. Cloudflare blocks the rude ones at the edge;
// this is the polite-bots backstop.
app.use((_req, res, next) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
  next();
});

// Static robots.txt at the root — belt-and-braces with the X-Robots-Tag header.
app.get("/robots.txt", (_req, res) => {
  res.type("text/plain").send("User-agent: *\nDisallow: /\n");
});

// Lightweight liveness probe so monitors / Cloudflare uptime checks don't
// trip on the auth redirect.
app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

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
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Stage 4.18: gate every request before it reaches the SPA / API layer.
  // The middleware whitelists /api/auth/*, /healthz, /robots.txt, /login.html
  // (and its assets); everything else returns 401 (API) or redirects to
  // /login.html (HTML).
  app.use(requireAuth);

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
      // Kick off daily model registry refresh (runs ~30s after boot, then every 24h).
      scheduleDailyModelRefresh((msg) => log(msg, "models"));
    },
  );
})();
