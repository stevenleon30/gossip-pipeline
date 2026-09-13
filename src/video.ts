import 'dotenv/config';
import Replicate from 'replicate';
import fs from 'fs';
import path from 'path';
import https from 'https';
import ffmpegPath from 'ffmpeg-static';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { VisualsOutput } from './agents.js';

const execFileAsync = promisify(execFile);

const replicate = new Replicate({
  ...(process.env.REPLICATE_API_TOKEN ? { auth: process.env.REPLICATE_API_TOKEN } : {}),
});

// ============================================================
// Generate one video clip via Seedance on Replicate
// ============================================================

async function generateClip(prompt: string, duration: number, outputPath: string): Promise<string> {
  console.log(`Generating clip: ${prompt.slice(0, 80)}...`);

  // Seedance Lite supports 5-10 second clips
  const safeDuration = Math.min(Math.max(duration, 5), 10);

  const output: any = await replicate.run(
    'bytedance/seedance-1-lite',
    {
      input: {
        prompt,
        duration: safeDuration,
        aspect_ratio: '9:16',
        resolution: '720p',
        fps: 24,
      },
    }
  );

  // Debug logging — see exactly what Seedance returned
  console.log('\n=== SEEDANCE RAW OUTPUT ===');
  console.log('Type:', typeof output);
  console.log('Is array:', Array.isArray(output));
  console.log('Constructor:', output?.constructor?.name);
  console.log('Has url method:', typeof output?.url === 'function');
  console.log('Keys:', output && typeof output === 'object' ? Object.keys(output) : 'n/a');
  console.log('=== END ===\n');

  // Extract the video URL from whatever shape Replicate returned
  let videoUrl: string | undefined;

  // Case 1: Newer Replicate SDK returns a FileOutput object with .url() method
  if (output && typeof output.url === 'function') {
    const urlResult = output.url();
    videoUrl = urlResult instanceof URL ? urlResult.href : String(urlResult);
  }
  // Case 2: Direct string URL
  else if (typeof output === 'string') {
    videoUrl = output;
  }
  // Case 3: Array of FileOutputs or strings
  else if (Array.isArray(output) && output.length > 0) {
    const first = output[0];
    if (first && typeof first.url === 'function') {
      const urlResult = first.url();
      videoUrl = urlResult instanceof URL ? urlResult.href : String(urlResult);
    } else if (typeof first === 'string') {
      videoUrl = first;
    }
  }
  // Case 4: Object with URL nested in a property
  else if (output && typeof output === 'object') {
    videoUrl = output.url || output.output || output.video || output.video_url;
  }

  if (!videoUrl) {
    console.error('Could not extract URL. Output was:', output);
    throw new Error('No video URL returned from Seedance');
  }

  console.log('Extracted video URL:', videoUrl);
  await downloadFile(videoUrl, outputPath);
  console.log(`Saved to ${outputPath}`);
  return outputPath;
}

// ============================================================
// Helper: download a file from a URL to disk
// ============================================================

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);

    https
      .get(url, (response) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          if (response.headers.location) {
            file.close();
            return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
          }
        }

        if (response.statusCode && response.statusCode >= 400) {
          file.close();
          if (fs.existsSync(dest)) fs.unlinkSync(dest);
          return reject(new Error(`Download failed with status ${response.statusCode}`));
        }

        response.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
      })
      .on('error', (err) => {
        file.close();
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        reject(err);
      });
  });
}

// ============================================================
// Generate voiceover audio
// ============================================================

async function generateVoiceover(text: string, outputPath: string): Promise<string> {
  console.log(`Generating voiceover: ${text.slice(0, 50)}...`);

  const elevenLabsKey = process.env.ELEVENLABS_API_KEY;
  if (elevenLabsKey) {
    try {
      const voiceId = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
      const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

      const postData = JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
      });

      await new Promise<void>((resolve, reject) => {
        const req = https.request(
          url,
          {
            method: 'POST',
            headers: {
              'Accept': 'audio/mpeg',
              'Content-Type': 'application/json',
              'xi-api-key': elevenLabsKey,
            },
          },
          (res) => {
            if (res.statusCode !== 200) {
              let errData = '';
              res.on('data', (chunk) => (errData += chunk));
              res.on('end', () =>
                reject(new Error(`ElevenLabs API returned status ${res.statusCode}: ${errData}`))
              );
              return;
            }

            const file = fs.createWriteStream(outputPath);
            res.pipe(file);
            file.on('finish', () => file.close(() => resolve()));
          }
        );

        req.on('error', reject);
        req.write(postData);
        req.end();
      });

      console.log(`Saved voiceover to ${outputPath}`);
      return outputPath;
    } catch (err) {
      console.warn('ElevenLabs voiceover generation failed:', err);
    }
  }

  // Fallback placeholder
  if (!fs.existsSync(outputPath)) {
    fs.writeFileSync(outputPath, Buffer.from([]));
  }
  return outputPath;
}

// ============================================================
// Sync voiceover audio track into video clip MP4
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
    console.log(`Syncing voiceover audio into video clip: ${path.basename(videoPath)}...`);
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
    console.log(`Successfully synced voiceover into ${outputPath}`);
    return outputPath;
  } catch (err) {
    console.warn(`Failed to merge audio into ${videoPath}:`, err);
    if (fs.existsSync(tempOutput)) {
      fs.unlinkSync(tempOutput);
    }
    return videoPath;
  }
}

// ============================================================
// Batch generate video clips & voiceovers
// ============================================================

async function generateClips(visuals: VisualsOutput): Promise<{ clips: { path: string }[]; voiceovers: { path: string }[] }> {
  const outputDir = path.resolve(process.cwd(), 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const generateAssets = process.env.GENERATE_ASSETS === 'true';
  const clips: { path: string }[] = [];
  const voiceovers: { path: string }[] = [];

  const scenesToProcess = generateAssets ? visuals.scenePrompts : visuals.scenePrompts.slice(0, 1);

  for (let i = 0; i < scenesToProcess.length; i++) {
    const scene = scenesToProcess[i];
    if (!scene) continue;

    const clipPath = path.join(outputDir, `clip-${String(i + 1).padStart(2, '0')}.mp4`);
    const voiceoverPath = path.join(outputDir, `voiceover-${String(i + 1).padStart(2, '0')}.mp3`);

    if (generateAssets) {
      try {
        await generateClip(scene.prompt, scene.duration, clipPath);
      } catch (err) {
        console.warn(`Clip generation failed for scene ${i + 1}:`, err);
        if (!fs.existsSync(clipPath)) {
          fs.writeFileSync(clipPath, Buffer.from([]));
        }
      }

      try {
        await generateVoiceover(scene.voiceoverText, voiceoverPath);
      } catch (err) {
        console.warn(`Voiceover generation failed for scene ${i + 1}:`, err);
        if (!fs.existsSync(voiceoverPath)) {
          fs.writeFileSync(voiceoverPath, Buffer.from([]));
        }
      }

      // Sync voiceover audio track into clip MP4 video
      await mergeAudioAndVideo(clipPath, voiceoverPath, clipPath);
    } else {
      console.log(`Asset generation not enabled for scene ${i + 1}. Creating placeholder clip and voiceover paths.`);
      if (!fs.existsSync(clipPath)) {
        fs.writeFileSync(clipPath, Buffer.from([]));
      }
      if (!fs.existsSync(voiceoverPath)) {
        fs.writeFileSync(voiceoverPath, Buffer.from([]));
      }
    }

    clips.push({ path: clipPath });
    voiceovers.push({ path: voiceoverPath });
  }

  return { clips, voiceovers };
}

// ============================================================
// Exports
// ============================================================

export { generateClip, generateVoiceover, generateClips, mergeAudioAndVideo };