import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { downloadFile, extractVideoUrl } from './video.js';

// ---------- extractVideoUrl: Replicate has returned several shapes over time ----------

test('extractVideoUrl handles a plain string', () => {
  assert.equal(extractVideoUrl('https://example.com/a.mp4'), 'https://example.com/a.mp4');
});

test('extractVideoUrl handles a FileOutput-like object with url() returning a URL', () => {
  const fileOutput = { url: () => new URL('https://example.com/b.mp4') };
  assert.equal(extractVideoUrl(fileOutput), 'https://example.com/b.mp4');
});

test('extractVideoUrl handles an array of strings and an array of FileOutputs', () => {
  assert.equal(extractVideoUrl(['https://example.com/c.mp4']), 'https://example.com/c.mp4');
  assert.equal(extractVideoUrl([{ url: () => 'https://example.com/d.mp4' }]), 'https://example.com/d.mp4');
});

test('extractVideoUrl handles an object with a nested property', () => {
  assert.equal(extractVideoUrl({ video_url: 'https://example.com/e.mp4' }), 'https://example.com/e.mp4');
});

test('extractVideoUrl returns undefined for empty or unusable output', () => {
  assert.equal(extractVideoUrl(undefined), undefined);
  assert.equal(extractVideoUrl(null), undefined);
  assert.equal(extractVideoUrl([]), undefined);
  assert.equal(extractVideoUrl({}), undefined);
  assert.equal(extractVideoUrl(42), undefined);
});

// ---------- downloadFile against a real local server ----------

function startServer(): Promise<{ base: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    if (req.url === '/ok') {
      res.writeHead(200, { 'Content-Type': 'video/mp4' });
      res.end('hello-video');
    } else if (req.url === '/redirect-302') {
      res.writeHead(302, { Location: '/ok' });
      res.end();
    } else if (req.url === '/redirect-307') {
      res.writeHead(307, { Location: '/ok' });
      res.end();
    } else {
      res.writeHead(404);
      res.end('nope');
    }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

test('downloadFile saves the body, and follows 302 and 307 redirects', async () => {
  const srv = await startServer();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gossip-dl-'));
  try {
    for (const route of ['/ok', '/redirect-302', '/redirect-307']) {
      const dest = path.join(dir, `file${route.replace(/\W/g, '-')}.mp4`);
      await downloadFile(`${srv.base}${route}`, dest);
      assert.equal(fs.readFileSync(dest, 'utf8'), 'hello-video', route);
    }
  } finally {
    await srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('downloadFile rejects on 404 and leaves no file behind', async () => {
  const srv = await startServer();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gossip-dl-'));
  try {
    const dest = path.join(dir, 'missing.mp4');
    await assert.rejects(downloadFile(`${srv.base}/nope`, dest), /status 404/);
    assert.equal(fs.existsSync(dest), false);
  } finally {
    await srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
