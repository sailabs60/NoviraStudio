import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import type { NextFunction, Request, Response } from 'express';
import { env } from './lib/env.js';
import { prisma } from './lib/prisma.js';
import { errorHandler, notFoundHandler, ApiError } from './lib/errors.js';
import { ERROR_CODES } from '@novira/shared';
import { authRouter } from './routes/auth.js';
import { projectsRouter } from './routes/projects.js';
import { plansRouter } from './routes/plans.js';
import { catalogRouter } from './routes/catalog.js';
import { shareRouter } from './routes/share.js';
import { uploadsRouter } from './routes/uploads.js';
import { templatesRouter, collectionsRouter } from './routes/library.js';
import { aiRouter } from './routes/ai.js';
import { billingRouter } from './routes/billing.js';
import { stripeWebhookRouter } from './routes/stripeWebhook.js';
import { companyRouter, inviteRouter } from './routes/company.js';
import { adminRouter } from './routes/admin.js';
import { venuesRouter } from './routes/venues.js';
import { brandingRouter } from './routes/branding.js';
import { guestsRouter } from './routes/guests.js';
import { vendorsRouter } from './routes/vendors.js';
import { proposalsRouter, proposalPublicRouter } from './routes/proposals.js';
import { estimateRouter } from './routes/estimate.js';
import { reviewRouter, reviewPublicRouter } from './routes/review.js';
import { venueLibraryRouter } from './routes/venueLibrary.js';
import { marketplaceRouter } from './routes/marketplace.js';
import { insightsRouter } from './routes/insights.js';
import { exportsRouter } from './routes/exports.js';
import { aiSpatialRouter } from './routes/aiSpatialRoutes.js';
import { assetsRouter } from './routes/assets.js';
import { aiStudioRouter } from './routes/aiStudio.js';
import { startAssetWarmer } from './services/assetRegistry.js';
import { attachCollaboration } from './services/collaboration.js';

const app = express();

/**
 * Credentialed API access is limited to the configured origins, plus any
 * localhost port in development — Vite silently moves to 5175 when 5174 is
 * taken, and a mismatch there fails as an opaque CORS error rather than
 * anything that points at the port.
 */
const allowedOrigins = env.corsOrigin.split(',').map((o) => o.trim()).filter(Boolean);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (env.nodeEnv !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
  })
);
// Stripe first, and deliberately so — the webhook verifies a signature over the
// raw request body, which express.json() would consume and reshape.
app.use('/api/billing/webhook', stripeWebhookRouter);

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true }));

/**
 * Static host for uploads and downloaded catalogue assets.
 *
 * These are public files fetched by WebGL, which requires a permissive
 * cross-origin header — a glTF and the .bin and textures it references are
 * separate requests, and a texture blocked by CORS taints the whole model.
 * They carry no credentials, so `*` is the correct policy rather than a
 * loosening of the API's own rules above.
 */
const publicAsset = cors({ origin: '*', credentials: false });
app.use('/static/uploads', publicAsset, express.static(env.uploadDir, { maxAge: '1h' }));
app.use(
  '/static/assets',
  publicAsset,
  express.static(env.assetDir, {
    maxAge: '7d',
    immutable: true,
    setHeaders: (res) => res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'),
  })
);

app.get('/api/health', async (_req, res) => {
  const started = Date.now();
  let database = 'down';
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = 'up';
  } catch {
    database = 'down';
  }
  res.json({
    ok: database === 'up',
    service: 'novira-api',
    database,
    latencyMs: Date.now() - started,
    time: new Date().toISOString(),
  });
});

app.use('/api/auth', authRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/plans', plansRouter);
app.use('/api/catalog', catalogRouter);
app.use('/api/assets', assetsRouter);
// Share routes span /plans and /share, so they mount at the API root.
app.use('/api', shareRouter);
app.use('/api/uploads', uploadsRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/collections', collectionsRouter);
app.use('/api/ai', aiRouter);
app.use('/api/billing', billingRouter);
app.use('/api/company', companyRouter);
app.use('/api/invitations', inviteRouter);
app.use('/api/admin', adminRouter);
app.use('/api/venues', venuesRouter);
app.use('/api/branding', brandingRouter);
app.use('/api/ai', aiSpatialRouter);
app.use('/api/ai/studio', aiStudioRouter);

// The public proposal view goes first and on its own path. The routers
// below mount at /api and each calls `.use(requireAuth)` internally, which
// guards everything reaching them — so anything unauthenticated has to be
// matched before they are.
app.use('/api/proposal', proposalPublicRouter);
// Client commenting through a share link. Unauthenticated by design — a client
// with the link is the point of the feature — so it is matched before the
// routers below, each of which guards everything reaching it.
app.use('/api', reviewPublicRouter);

// These mount at /api because their paths nest under projects and plans
// rather than under a noun of their own.
app.use('/api', guestsRouter);
app.use('/api', vendorsRouter);
app.use('/api', proposalsRouter);
app.use('/api', estimateRouter);
app.use('/api', reviewRouter);
app.use('/api', venueLibraryRouter);
app.use('/api', marketplaceRouter);
app.use('/api', exportsRouter);
app.use('/api', insightsRouter);

/** Turn Zod failures into the standard validation envelope. */
app.use((err: unknown, _req: Request, _res: Response, next: NextFunction) => {
  if (err instanceof ZodError) {
    const first = err.errors[0];
    return next(
      new ApiError(400, ERROR_CODES.VALIDATION_FAILED, first?.message ?? 'Invalid input.', {
        fields: err.errors.map((e) => ({ path: e.path.join('.'), message: e.message })),
      })
    );
  }
  return next(err);
});

/**
 * The built frontend, served from this same process.
 *
 * Novira deploys as one process rather than two: the web app already calls
 * its API at the relative path `/api` (see `apps/web/src/lib/api.ts`), so
 * there is nothing to reconfigure to put both behind one origin — it is
 * already written that way. This block is the other half of that: once
 * `apps/web` has been built, its `dist` sits two directories up from this
 * compiled file (`apps/api/dist/index.js` → `apps/web/dist`), and is served
 * for anything that is not `/api` or `/static`.
 *
 * The `index.html` fallback is what makes client-side routes work on a
 * hard refresh or a shared link — `/editor/42` has to resolve to the same
 * document as `/`, because react-router, not Express, is what understands
 * that path. It only ever answers a GET; a POST to an unmatched route still
 * reaches `notFoundHandler` below, which is what keeps a typo in an API path
 * from silently succeeding with a page instead of a 404.
 *
 * Guarded on the folder actually existing so a plain `tsx watch` dev run —
 * which never builds the web app — is completely unaffected.
 */
const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api|\/static).*/, (_req, res) => {
    res.sendFile(path.join(webDist, 'index.html'));
  });
  console.log(`[novira-api] serving the built web app from ${path.relative(process.cwd(), webDist)}`);
}

app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(env.port, () => {
  console.log(`[novira-api] listening on http://localhost:${env.port}`);
});

/*
 * Collaboration shares the HTTP server rather than opening its own port, so
 * one origin covers both and no extra CORS or firewall rule is needed.
 */
attachCollaboration(server);

/*
 * Warm the online asset shelves.
 *
 * The brief asks that a designer never sit watching a drawer fill. The only
 * honest way to deliver that is to have paid for the first screen before it is
 * asked for, so the registry searches its opening shelves in the background
 * from here — slowly, one at a time, and never in front of a real request.
 */
startAssetWarmer();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      void prisma.$disconnect().then(() => process.exit(0));
    });
  });
}

export { app };
