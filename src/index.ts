import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	runResearcher,
	runStoryWriter,
	runVisualDirector,
} from './agents.js';
import { generateClips } from './video.js';

function ensureOutputDir(): string {
	const dir = path.resolve(process.cwd(), 'output');
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}

	return dir;
}

export async function runPipeline(product: string) {
	const outputDir = ensureOutputDir();

	console.log('1) Researching product angles...');
	const researchResult = await runResearcher(product);
	fs.writeFileSync(
		path.join(outputDir, 'research.json'),
		JSON.stringify(researchResult, null, 2),
		'utf8'
	);

	console.log('2) Writing script...');
	const scriptResult = await runStoryWriter(researchResult);
	fs.writeFileSync(
		path.join(outputDir, 'script.json'),
		JSON.stringify(scriptResult, null, 2),
		'utf8'
	);

	console.log('3) Creating visual direction prompts...');
	const visualsResult = await runVisualDirector(scriptResult);
	fs.writeFileSync(
		path.join(outputDir, 'visuals.json'),
		JSON.stringify(visualsResult, null, 2),
		'utf8'
	);

	console.log('4) Generating clips & voiceovers...');
	const { clips, voiceovers } = await generateClips(visualsResult);

	return {
		caption: scriptResult.caption,
		script: scriptResult.scenes,
		clips: clips.map((c) => c.path), // paths to your generated mp4 files
		voiceovers: voiceovers.map((v) => v.path), // paths to your generated mp3 files
	};
}

async function main(): Promise<void> {
	const product =
		process.env.PRODUCT_NAME ||
		process.env.PRODUCT_URL ||
		'Sol de Janeiro Brazilian Bum Bum Cream';

	const result = await runPipeline(product);
	console.log('Pipeline complete:', JSON.stringify(result, null, 2));
}

const nodePath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const thisPath = fileURLToPath(import.meta.url);

if (nodePath === thisPath) {
	main().catch((error: unknown) => {
		const message = error instanceof Error ? error.stack ?? error.message : String(error);
		console.error(message);
		process.exitCode = 1;
	});
}