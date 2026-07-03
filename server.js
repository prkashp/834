/**
 * server.js — Express entry point
 *
 * Starts the HTTP server, configures CORS so the Vite dev server (port 5173)
 * and any production build can reach the API, then mounts the conversion router.
 */

'use strict';

const express = require('express');
const cors    = require('cors');
const path    = require('path');

const conversionRouter = require('./routes/conversion');

const app  = express();
const PORT = process.env.PORT || 4000;

// ── CORS ──────────────────────────────────────────────────────────────────────
// Allow the React dev server and production deploys.
const ALLOWED_ORIGINS = [
  'http://localhost:5173', // Vite default
  'http://localhost:3000', // CRA default
  'http://localhost:4000', // Same-origin (Express)
  process.env.CLIENT_ORIGIN, // Custom domain via env var
  process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null, // Vercel auto-domain
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, Postman, same-origin requests)
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);

    // Log the rejected origin for debugging
    console.warn(`[CORS] Rejecting origin: ${origin}`);
    console.warn(`[CORS] Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);

    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true,
}));

// ── Body parsers ──────────────────────────────────────────────────────────────
// JSON bodies for health-check; file bodies handled by multer inside the router.
app.use(express.json({ limit: '10mb' }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/convert', conversionRouter);

// Health check
app.get('/api/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// Serve React production build when NODE_ENV=production
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, 'client', 'dist');
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// ── Global error handler ──────────────────────────────────────────────────────
// Catches anything routes didn't handle (including CORS rejections).
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[server] unhandled error:', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () =>
  console.log(`[server] X12 834 Converter listening on http://localhost:${PORT}`)
);
