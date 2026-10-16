import 'dotenv/config';
import Replicate from 'replicate';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeWebStream } from 'node:stream/web';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpegStatic from 'ffmpeg-static';
import type { VisualsOutput } from './validate.js';

const execFileAsync = promisify(execFile);

// ffmpeg-static ships CommonJS typings that clash with NodeNext default imports.
const ffmpegPath = ffmpegStatic as unknown as string | null;

const replicate = new Replicate({
  ...(process.env.REPLICATE_API_TOKEN ? { auth: process.env.REPLICATE_API_TOKEN } : {}),
});

// Seedance Lite on Replicate. Confirm the slug and input options on the model page
// if this ever starts failing, since hosted models get renamed and retired.
const VIDEO_MODEL = process.env.VIDEO_MODEL || 'bytedance/seedance-1-lite';

// ============================================================
// Pull a video URL out of whatever shape Replicate returns
// ============================================================

function urlFromFileLike(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (v && typeof (v as { url?: unknown }).url === 'function') {
    const result = (v as { url: () => unknown }).url();
    return result instanceof URL ? result.href : String(result);
  }
  return undefined;
}

export function extractVideoUrl(output: unknown): string | undefined {
  // FileOutput object, plain string, or an array of either
  const direct = urlFromFileLike(output);
  if (direct) return direct;

  if (Array.isArray(output)) {
    return output.length > 0 ? urlFromFileLike(output[0]) : undefined;
  }

  // Older shape: object with the URL under a property
  if (output && typeof output === 'object') {
    const o = output as Record<string, unknown>;
    for (const key of ['url', 'output', 'video', 'video_url']) {
      const candidate = o[key];
      if (typeof candidate === 'string') return candidate;
    }
  }

  return undefined;
}

// ============================================================
// Generate one video clip via Seedance on Replicate
// ============================================================

async function generateClip(prompt: string, duration: number, outputPath: string): Promise<string> {
  console.log(`Generating clip: ${prompt.slice(0, 80)}...`);

  // Seedance Lite supports 5-10 second clips
  const safeDuration = Math.min(Math.max(duration, 5), 10);

  const output = await replicate.run(VIDEO_MODEL as `${string}/${string}`, {
    input: {
      prompt,
      duration: safeDuration,
      aspect_ratio: '9:16',
      resolution: '720p',
      fps: 24,
    },
  });

  const videoUrl = extractVideoUrl(output);
  if (!videoUrl) {
    console.error('Could not extract a video URL. Output was:', output);
    throw new Error('No video URL returned from the video model');
  }

  await downloadFile(videoUrl, outputPath);
  console.log(`Saved ${outputPath}`);
  return outputPath;
}

// ============================================================
// Helper: download a file from a URL to disk (fetch follows redirects)
// ============================================================

export async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed with status ${res.status}`);
  }

  try {
    await pipeline(Readable.fromWeb(res.body as unknown as NodeWebStream), fs.createWriteStream(dest));
  } catch (err) {
    fs.rmSync(dest, { force: true });
    throw err;
  }
}

// ============================================================
// Generate voiceover audio (ElevenLabs). Returns generated=false on fallback.
// ============================================================

async function generateVoiceover(
  text: string,
  outputPath: string
): Promise<{ path: string; generated: boolean; warning?: string }> {
  const elevenLabsKey = process.env.ELEVENLABS_API_KEY;

  if (!elevenLabsKey) {
    fs.writeFileSync(outputPath, Buffer.from([]));
    return { path: outputPath, generated: false, warning: 'ELEVENLABS_API_KEY not set, wrote an empty voiceover file.' };
  }

  console.log(`Generating voiceover: ${text.slice(0, 50)}...`);

  try {
    const voiceId = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        Accept: 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': elevenLabsKey,
      },
      body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' }),
    });

    if (!res.ok || !res.body) {
      throw new Error(`ElevenLabs returned status ${res.status}: ${await res.text()}`);
    }

    await pipeline(Readable.fromWeb(res.body as unknown as NodeWebStream), fs.createWriteStream(outputPath));
    console.log(`Saved ${outputPath}`);
    return { path: outputPath, generated: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    fs.writeFileSync(outputPath, Buffer.from([]));
    return { path: outputPath, generated: false, warning: `Voiceover failed: ${message}` };
  }
}

// ============================================================
// Mux the voiceover audio into the video clip
// ============================================================

async function mergeAudioAndVideo(videoPath: string, audioPath: string, outputPath: string): Promise<string> {
  if (!ffmpegPath) {
    console.warn('ffmpeg-static path not found, skipping audio merge.');
    return videoPath;
  }

  if (!fs.existsSync(videoPath) || fs.statSync(videoPath).size === 0) {
    console.warn('Video file missing or empty, skipping audio merge.');
    return videoPath;
  }

  if (!fs.existsSync(audioPath) || fs.statSync(audioPath).size === 0) {
    console.warn('Audio file missing or empty, skipping audio merge.');
    return videoPath;
  }

  const tempOutput = `${outputPath}.tmp.mp4`;

  try {
    console.log(`Merging voiceover into ${path.basename(videoPath)}...`);
    await execFileAsync(ffmpegPath, [
      '-y',
      '-i', videoPath,
      '-i', audioPath,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-ac', '2',
      '-ar', '44100',
      '-b:a', '128k',
      '-map', '0:v:0',
      '-map', '1:a:0',
      tempOutput,
    ]);

    fs.renameSync(tempOutput, outputPath);
    return outputPath;
  } catch (err) {
    console.warn(`Failed to merge audio into ${videoPath}:`, err);
    fs.rmSync(tempOutput, { force: true });
    return videoPath;
  }
}

// ============================================================
// Batch generate clips and voiceovers
// ============================================================

export interface GenerateClipsResult {
  clips: { path: string }[];
  voiceovers: { path: string }[];
  // Anything that did not go to plan. Empty means everything worked.
  warnings: string[];
}

async function generateClips(visuals: VisualsOutput): Promise<GenerateClipsResult> {
  const outputDir = path.resolve(process.cwd(), 'output');
  fs.mkdirSync(outputDir, { recursive: true });

  const generateAssets = process.env.GENERATE_ASSETS === 'true';
  const clips: { path: string }[] = [];
  const voiceovers: { path: string }[] = [];
  const warnings: string[] = [];

  // Dry run (the default) only touches the first scene so nothing costs money by accident.
  const scenesToProcess = generateAssets ? visuals.scenePrompts : visuals.scenePrompts.slice(0, 1);

  if (!generateAssets) {
    warnings.push('GENERATE_ASSETS is not "true", so clips and voiceovers are empty placeholders (first scene only).');
  }

  for (let i = 0; i < scenesToProcess.length; i++) {
    const scene = scenesToProcess[i];
    if (!scene) continue;

    const n = String(i + 1).padStart(2, '0');
    const clipPath = path.join(outputDir, `clip-${n}.mp4`);
    const voiceoverPath = path.join(outputDir, `voiceover-${n}.mp3`);

    if (generateAssets) {
      try {
        await generateClip(scene.prompt, scene.duration, clipPath);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        warnings.push(`Scene ${i + 1}: clip generation failed (${message}). Wrote an empty placeholder.`);
        fs.writeFileSync(clipPath, Buffer.from([]));
      }

      const voice = await generateVoiceover(scene.voiceoverText, voiceoverPath);
      if (voice.warning) warnings.push(`Scene ${i + 1}: ${voice.warning}`);

      await mergeAudioAndVideo(clipPath, voiceoverPath, clipPath);
    } else {
      // Never clobber real files from an earlier run with empty ones.
      if (!fs.existsSync(clipPath)) fs.writeFileSync(clipPath, Buffer.from([]));
      if (!fs.existsSync(voiceoverPath)) fs.writeFileSync(voiceoverPath, Buffer.from([]));
    }

    clips.push({ path: clipPath });
    voiceovers.push({ path: voiceoverPath });
  }

  return { clips, voiceovers, warnings };
}

// ============================================================
// Exports
// ============================================================

export { generateClip, generateVoiceover, generateClips, mergeAudioAndVideo };
