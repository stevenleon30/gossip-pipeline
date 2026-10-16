import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import {
  validateResearch,
  validateScript,
  validateVisuals,
  type ResearchOutput,
  type ScriptOutput,
  type VisualsOutput,
} from './validate.js';

export type {
  ResearchOutput,
  ScriptOutput,
  ScriptScene,
  ScenePrompt,
  VisualsOutput,
} from './validate.js';

// Override with ANTHROPIC_MODEL to try another model without touching code.
export const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

// Created lazily so importing this file never crashes when the key is missing.
// The error shows up when an agent actually runs.
let client: Anthropic | undefined;
function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

// ============================================================
// Structured output via forced tool use
// ============================================================
// Each agent must "call" one tool whose input schema is the output shape.
// That replaces regex JSON cleanup and quote repair. The result is still
// validated at runtime, because a schema is a request, not a guarantee.

type InputSchema = Anthropic.Tool['input_schema'];

interface StructuredCall<T> {
  name: string;
  description: string;
  schema: InputSchema;
  prompt: string;
  maxTokens: number;
  validate: (input: unknown) => T;
}

async function callStructured<T>(opts: StructuredCall<T>): Promise<T> {
  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens,
    tools: [{ name: opts.name, description: opts.description, input_schema: opts.schema }],
    // Forced tool_choice ('tool'/'any') is rejected by some models, so use auto and instruct in the prompt.
    tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content: `${opts.prompt}\n\nRespond only by calling the \`${opts.name}\` tool.` }],
  });

  if (res.stop_reason === 'max_tokens') {
    throw new Error(`${opts.name}: output was truncated (max_tokens=${opts.maxTokens}). Raise the limit.`);
  }

  const block = res.content.find((b) => b.type === 'tool_use');
  if (!block || block.type !== 'tool_use') {
    throw new Error(`${opts.name}: model did not return the expected tool call.`);
  }

  return opts.validate(block.input);
}

// ============================================================
// Agent 1: Story Researcher
// ============================================================

const researchSchema: InputSchema = {
  type: 'object',
  properties: {
    product: { type: 'string' },
    factsKnownToYou: {
      type: 'array',
      items: { type: 'string' },
      description: 'Facts you are confident are true about the product.',
    },
    angles: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'object',
        properties: {
          angle: { type: 'string', description: 'Short description of the gossip angle' },
          hook: { type: 'string', description: 'Opening line for this angle' },
        },
        required: ['angle', 'hook'],
      },
    },
  },
  required: ['product', 'factsKnownToYou', 'angles'],
};

async function researchProduct(productName: string, productUrl?: string): Promise<ResearchOutput> {
  return callStructured({
    name: 'submit_research',
    description: 'Submit the researched facts and three gossip angles for the product.',
    schema: researchSchema,
    maxTokens: 1500,
    validate: validateResearch,
    prompt: `You find the gossip-worthy angle that makes great TikTok storytime content for a product.

Product: ${productName}
${productUrl ? `URL: ${productUrl}` : ''}

Find 3 potential gossip angles. Think drama, "I can't believe this works," before/after shock, or a hidden detail.

Ground rules:
- You have no web access. Work only from what you actually know.
- Only list facts you are confident are true. If you know little about this product, say so in the facts instead of guessing.
- Do not invent statistics, lawsuits, recalls, studies, or health claims.
- Angles can be about the experience of using the product, not just trivia.`,
  });
}

// ============================================================
// Agent 2: Story Writer
// ============================================================

const scriptSchema: InputSchema = {
  type: 'object',
  properties: {
    script: { type: 'string', description: 'Full script as one string with line breaks' },
    scenes: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          time: { type: 'string', description: 'For example 0:00-0:05' },
          text: { type: 'string', description: 'What is said in this beat' },
          emotion: { type: 'string' },
          visual: { type: 'string', description: 'What is on screen' },
        },
        required: ['time', 'text', 'emotion', 'visual'],
      },
    },
    caption: { type: 'string', description: 'TikTok caption that includes the #ad disclosure' },
    hashtags: { type: 'array', items: { type: 'string' } },
  },
  required: ['script', 'scenes', 'caption', 'hashtags'],
};

async function writeScript(research: ResearchOutput, chosenAngleIndex = 0): Promise<ScriptOutput> {
  const angle = research.angles[chosenAngleIndex];
  if (!angle) {
    throw new Error(`Invalid angle index: ${chosenAngleIndex}.`);
  }

  return callStructured({
    name: 'submit_script',
    description: 'Submit the finished TikTok storytime script, scene beats, caption, and hashtags.',
    schema: scriptSchema,
    maxTokens: 3000,
    validate: validateScript,
    prompt: `You write TikTok storytime scripts in first-person gossip voice. The script should sound like a real person texting their best friend, not an ad.

Product: ${research.product}
Known facts: ${JSON.stringify(research.factsKnownToYou)}
Angle: ${angle.angle}
Opening hook idea: ${angle.hook}

Rules:
- 45 to 60 seconds total
- Hook in the first 3 seconds
- Structure: hook -> escalation -> the reveal -> soft product mention -> CTA that doesn't feel like a CTA
- Escalate with relatable, everyday detail. Do not invent statistics, studies, medical claims, or specific events involving real people or brands.
- Use casual phrases like "literally," "I'm not even kidding," "wait wait wait"
- Include an #ad disclosure naturally, in the script and the caption
- The product should be the punchline, not the pitch`,
  });
}

// ============================================================
// Agent 3: Visual Director
// ============================================================

const visualsSchema: InputSchema = {
  type: 'object',
  properties: {
    scenePrompts: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          sceneIndex: { type: 'integer' },
          duration: { type: 'number', description: 'Seconds, 5 to 8' },
          prompt: { type: 'string', description: 'Vertical 9:16 UGC video prompt for the video model' },
          voiceoverText: { type: 'string', description: 'Exact words spoken over this clip' },
        },
        required: ['sceneIndex', 'duration', 'prompt', 'voiceoverText'],
      },
    },
  },
  required: ['scenePrompts'],
};

async function directVisuals(scriptOutput: ScriptOutput): Promise<VisualsOutput> {
  return callStructured({
    name: 'submit_scene_prompts',
    description: 'Submit scene-by-scene video prompts and voiceover text.',
    schema: visualsSchema,
    maxTokens: 4000,
    validate: validateVisuals,
    prompt: `You turn TikTok storytime scripts into scene-by-scene video prompts for AI video generation (Seedance model). Each scene is 5-8 seconds.

Script scenes:
${JSON.stringify(scriptOutput.scenes, null, 2)}

Rules:
- Vertical 9:16 format
- UGC aesthetic, NOT cinematic. Think iPhone footage, natural light, real bedrooms or cafes.
- Match the emotional beat
- Keep visual continuity where possible
- Avoid prompts that could trigger model safety filters (no real celebrities, no controversial imagery)`,
  });
}

// ============================================================
// Exports and helper wrappers
// ============================================================

export async function runResearcher(product: string): Promise<ResearchOutput> {
  const isUrl = product.startsWith('http://') || product.startsWith('https://');
  return researchProduct(product, isUrl ? product : undefined);
}

export async function runStoryWriter(research: ResearchOutput, chosenAngleIndex = 0): Promise<ScriptOutput> {
  return writeScript(research, chosenAngleIndex);
}

export async function runVisualDirector(scriptOutput: ScriptOutput): Promise<VisualsOutput> {
  return directVisuals(scriptOutput);
}

export { researchProduct, writeScript, directVisuals };
