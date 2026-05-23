import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();
const MODEL = 'claude-sonnet-4-6';

// ============================================================
// Types
// ============================================================

export interface ResearchOutput {
  product: string;
  factsKnownToYou: string[];
  angles: { angle: string; hook: string }[];
}

export interface ScriptScene {
  time: string;
  text: string;
  emotion: string;
  visual: string;
}

export interface ScriptOutput {
  script: string;
  scenes: ScriptScene[];
  caption: string;
  hashtags: string[];
}

export interface ScenePrompt {
  sceneIndex: number;
  duration: number;
  prompt: string;
  voiceoverText: string;
}

export interface VisualsOutput {
  scenePrompts: ScenePrompt[];
}

// ============================================================
// JSON parsing helper (handles Claude's markdown wrapping)
// ============================================================

function parseJsonOutput(text: any) {
  if (typeof text !== 'string') {
    console.error('parseJsonOutput received non-string:', typeof text, text);
    throw new Error(`parseJsonOutput expected string, got ${typeof text}`);
  }

  let cleaned = text.trim();

  // Strip markdown code fences if Claude wrapped the JSON
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '');
  cleaned = cleaned.replace(/\s*```\s*$/, '');

  // Extract just the JSON object even if there's preamble text
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');

  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  console.log('parseJsonOutput cleaned JSON:', cleaned);
  return JSON.parse(cleaned);
}

// ============================================================
// Agent 1: Story Researcher
// ============================================================

async function researchProduct(productName: string, productUrl?: string): Promise<ResearchOutput> {
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `You research products and find the gossip-worthy angle that makes great TikTok storytime content.

Product: ${productName}
${productUrl ? `URL: ${productUrl}` : ''}

Find 3 potential gossip angles for this product. Think drama, controversy, "I can't believe this works," before/after shock, or a hidden detail.

CRITICAL: Return ONLY the raw JSON object. Do NOT wrap it in markdown code fences. Start your response with { and end with }.

{
  "product": "${productName}",
  "factsKnownToYou": ["fact 1", "fact 2", "fact 3"],
  "angles": [
    { "angle": "short description", "hook": "the opening line for this angle" },
    { "angle": "...", "hook": "..." },
    { "angle": "...", "hook": "..." }
  ]
}`,
    }],
  });

  const text = res.content[0].type === 'text' ? res.content[0].text : '';
  return parseJsonOutput(text);
}

// ============================================================
// Agent 2: Story Writer
// ============================================================

async function writeScript(research: ResearchOutput, chosenAngleIndex = 0): Promise<ScriptOutput> {
  const angle = research.angles[chosenAngleIndex];
  if (!angle) {
    throw new Error(`Invalid angle index: ${chosenAngleIndex}.`);
  }

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: `You write TikTok storytime scripts in first-person gossip voice. The script should sound like a real person texting their best friend, not an ad.

Product: ${research.product}
Angle: ${angle.angle}
Opening hook idea: ${angle.hook}

Rules:
- 45 to 60 seconds total
- Hook in the first 3 seconds
- Structure: hook -> escalation with specific (real or plausible) detail -> the reveal -> soft product mention -> CTA that doesn't feel like a CTA
- Use casual phrases like "literally," "I'm not even kidding," "wait wait wait"
- Include an #ad disclosure naturally
- The product should be the punchline, not the pitch

CRITICAL: Return ONLY the raw JSON object. Do NOT wrap it in markdown code fences. Start your response with { and end with }.

{
  "script": "full script as one string with line breaks",
  "scenes": [
    { "time": "0:00-0:05", "text": "what's said in this beat", "emotion": "incredulous", "visual": "what's on screen" },
    { "time": "0:05-0:15", "text": "...", "emotion": "...", "visual": "..." }
  ],
  "caption": "TikTok caption with disclosure and hashtags",
  "hashtags": ["#storytime", "#ad", "..."]
}`,
    }],
  });

  const text = res.content[0].type === 'text' ? res.content[0].text : '';
  return parseJsonOutput(text);
}

// ============================================================
// Agent 3: Visual Director
// ============================================================

async function directVisuals(scriptOutput: ScriptOutput): Promise<VisualsOutput> {
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: `You turn TikTok storytime scripts into scene-by-scene video prompts for AI video generation (Seedance model). Each scene is 5-8 seconds.

Script scenes:
${JSON.stringify(scriptOutput.scenes, null, 2)}

Rules:
- Vertical 9:16 format
- UGC aesthetic, NOT cinematic. Think iPhone footage, natural light, real bedrooms or cafés.
- Match the emotional beat
- Keep visual continuity where possible
- Avoid prompts that could trigger model safety filters (no real celebrities, no controversial imagery)

CRITICAL: Return ONLY the raw JSON object. Do NOT wrap it in markdown code fences. Start your response with { and end with }.

{
  "scenePrompts": [
    { "sceneIndex": 0, "duration": 6, "prompt": "vertical 9:16 UGC video of...", "voiceoverText": "exact words spoken over this clip" }
  ]
}`,
    }],
  });

  const text = res.content[0].type === 'text' ? res.content[0].text : '';
  return parseJsonOutput(text);
}

// ============================================================
// Exports
// ============================================================
// Exports
// ============================================================

export { researchProduct, writeScript, directVisuals };