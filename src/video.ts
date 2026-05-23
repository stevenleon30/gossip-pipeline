import 'dotenv/config';
import Replicate from 'replicate';
import fs from 'fs';
import https from 'https';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
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
// Exports
// ============================================================

export { generateClip };