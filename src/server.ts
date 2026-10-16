import 'dotenv/config';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { runPipeline } from './index.js';

const MAX_PRODUCT_LENGTH = 300;

const app = express();

// CORS_ORIGIN can be a comma-separated list. Unset means open, which is fine for local dev only.
const corsOrigins = process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()).filter(Boolean);
app.use(cors(corsOrigins && corsOrigins.length > 0 ? { origin: corsOrigins } : {}));
app.use(express.json({ limit: '10kb' }));
app.use('/output', express.static('output'));

// This endpoint spends real API money. If API_AUTH_TOKEN is set, require it.
function requireToken(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.API_AUTH_TOKEN;
  if (!expected) return next();

  const header = req.header('authorization') ?? '';
  const given = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  const a = Buffer.from(given);
  const b = Buffer.from(expected);

  if (a.length === b.length && timingSafeEqual(a, b)) return next();
  res.status(401).json({ error: 'Missing or invalid bearer token' });
}

// The pipeline writes to a shared output/ folder, so two runs at once would overwrite each other.
let busy = false;

app.get('/health', (_req, res) => {
  res.json({ ok: true, busy });
});

app.post('/api/generate', requireToken, async (req, res) => {
  const product: unknown = req.body?.product;

  if (typeof product !== 'string' || product.trim() === '') {
    return res.status(400).json({ error: 'Missing product name or URL' });
  }
  if (product.length > MAX_PRODUCT_LENGTH) {
    return res.status(400).json({ error: `Product must be ${MAX_PRODUCT_LENGTH} characters or fewer` });
  }
  if (busy) {
    return res.status(429).json({ error: 'A pipeline run is already in progress. Try again shortly.' });
  }

  busy = true;
  try {
    const result = await runPipeline(product.trim());

    // Turn file paths into web paths like /output/clip-01.mp4
    const clipUrls = result.clips.map((clipPath) => `/output/${path.basename(clipPath)}`);
    const voiceoverUrls = result.voiceovers.map((voPath) => `/output/${path.basename(voPath)}`);

    res.json({ ...result, clips: clipUrls, voiceovers: voiceoverUrls });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Pipeline failed. Check server logs.' });
  } finally {
    busy = false;
  }
});

const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  if (!process.env.API_AUTH_TOKEN) {
    console.warn('API_AUTH_TOKEN is not set. /api/generate is open to anyone who can reach this server.');
  }
});
