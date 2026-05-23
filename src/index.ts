require('dotenv/config');
import fs = require('fs');
import path = require('path');

import agents = require('./agents');
import video = require('./video');

interface PipelineConfig {
	productName: string;
	productUrl?: string;
	angleIndex: number;
	generateAssets: boolean;
}

function ensureOutputDir(): string {
	const dir = path.resolve(process.cwd(), 'output');
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}

	return dir;
}

async function runPipeline(config: PipelineConfig): Promise<void> {
	const outputDir = ensureOutputDir();

	console.log('1) Researching product angles...');
	const research = await agents.researchProduct(config.productName, config.productUrl);
	fs.writeFileSync(
		path.join(outputDir, 'research.json'),
		JSON.stringify(research, null, 2),
		'utf8'
	);

	console.log(`2) Writing script with angle #${config.angleIndex}...`);
	const script = await agents.writeScript(research, config.angleIndex);
	fs.writeFileSync(
		path.join(outputDir, 'script.json'),
		JSON.stringify(script, null, 2),
		'utf8'
	);

	console.log('3) Creating visual direction prompts...');
	const visuals = await agents.directVisuals(script);
	fs.writeFileSync(
		path.join(outputDir, 'visuals.json'),
		JSON.stringify(visuals, null, 2),
		'utf8'
	);

	if (!config.generateAssets) {
		console.log('Done. JSON outputs saved to output/.');
		console.log('Set GENERATE_ASSETS=true to also render one video clip + voiceover.');
		return;
	}

	const firstScene = visuals.scenePrompts[0];
	if (!firstScene) {
		throw new Error('No scene prompts returned; cannot generate media assets.');
	}

	console.log('4) Generating one sample video clip...');
	const clipPath = path.join(outputDir, 'clip-01.mp4');
	await video.generateClip(firstScene.prompt, firstScene.duration, clipPath);

	console.log('5) Generating voiceover for that scene...');
	const voiceoverPath = path.join(outputDir, 'voiceover-01.mp3');
	await video.generateVoiceover(firstScene.voiceoverText, voiceoverPath);

	console.log('Pipeline complete. Files saved in output/.');
}

async function main(): Promise<void> {
	const productUrl = process.env.PRODUCT_URL;

	const config: PipelineConfig = {
		productName: process.env.PRODUCT_NAME ?? 'Sol de Janeiro Brazilian Bum Bum Cream',
		angleIndex: Number.parseInt(process.env.ANGLE_INDEX ?? '0', 10),
		generateAssets: process.env.GENERATE_ASSETS === 'true',
	};

	if (productUrl) {
		config.productUrl = productUrl;
	}

	await runPipeline(config);
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.stack ?? error.message : String(error);
	console.error(message);
	process.exitCode = 1;
});
