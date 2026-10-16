import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runResearcher, runStoryWriter, runVisualDirector, MODEL } from './agents.js';
import { generateClips } from './video.js';

const DEFAULT_PRODUCT = 'Sol de Janeiro Brazilian Bum Bum Cream';

function ensureOutputDir(): string {
  const dir = path.resolve(process.cwd(), 'output');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJson(dir: string, name: string, data: unknown): void {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2), 'utf8');
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  console.log(`${label}...`);
  const result = await fn();
  console.log(`  done in ${((Date.now() - start) / 1000).toFixed(1)}s`);
  return result;
}

export async function runPipeline(product: string) {
  const outputDir = ensureOutputDir();
  console.log(`Model: ${MODEL}`);

  const research = await timed('1) Researching product angles', () => runResearcher(product));
  writeJson(outputDir, 'research.json', research);

  const script = await timed('2) Writing script', () => runStoryWriter(research));
  writeJson(outputDir, 'script.json', script);

  const visuals = await timed('3) Creating visual direction prompts', () => runVisualDirector(script));
  writeJson(outputDir, 'visuals.json', visuals);

  const { clips, voiceovers, warnings } = await timed('4) Generating clips and voiceovers', () =>
    generateClips(visuals)
  );

  return {
    caption: script.caption,
    script: script.scenes,
    clips: clips.map((c) => c.path), // mp4 paths
    voiceovers: voiceovers.map((v) => v.path), // mp3 paths
    warnings,
  };
}

async function main(): Promise<void> {
  // Usage: npm run pipeline -- "Product name or URL"
  const product = process.argv[2] || process.env.PRODUCT_NAME || process.env.PRODUCT_URL || DEFAULT_PRODUCT;

  const result = await runPipeline(product);
  console.log('Pipeline complete:', JSON.stringify(result, null, 2));
  if (result.warnings.length > 0) {
    console.warn(`\n${result.warnings.length} warning(s). See the "warnings" field above.`);
  }
}

const nodePath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const thisPath = fileURLToPath(import.meta.url);

if (nodePath === thisPath) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
