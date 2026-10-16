// Runtime validators for the JSON each agent returns.
// The model is asked for structured output, but nothing downstream should
// trust it blindly. These fail loudly with a path to the bad field.

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

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown, path: string): string {
  if (typeof v !== 'string' || v.trim() === '') {
    throw new ValidationError(`${path} must be a non-empty string`);
  }
  return v;
}

function num(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new ValidationError(`${path} must be a finite number`);
  }
  return v;
}

function arr(v: unknown, path: string, min = 1): unknown[] {
  if (!Array.isArray(v) || v.length < min) {
    throw new ValidationError(`${path} must be an array with at least ${min} item(s)`);
  }
  return v;
}

function obj(v: unknown, path: string): Record<string, unknown> {
  if (!isRecord(v)) {
    throw new ValidationError(`${path} must be an object`);
  }
  return v;
}

export function validateResearch(input: unknown): ResearchOutput {
  const o = obj(input, 'research');
  return {
    product: str(o.product, 'research.product'),
    factsKnownToYou: arr(o.factsKnownToYou, 'research.factsKnownToYou', 0).map((f, i) =>
      str(f, `research.factsKnownToYou[${i}]`)
    ),
    angles: arr(o.angles, 'research.angles').map((a, i) => {
      const item = obj(a, `research.angles[${i}]`);
      return {
        angle: str(item.angle, `research.angles[${i}].angle`),
        hook: str(item.hook, `research.angles[${i}].hook`),
      };
    }),
  };
}

// FTC-style disclosure guardrail: the prompt asks for #ad, but we do not rely on it.
export function ensureDisclosure(caption: string, hashtags: string[]): { caption: string; hashtags: string[] } {
  const hasAd = (s: string) => /(^|\s)#ad\b/i.test(s);
  const tags = hashtags.some((h) => h.trim().toLowerCase() === '#ad') ? hashtags : [...hashtags, '#ad'];
  const fixedCaption = hasAd(caption) ? caption : `${caption.trimEnd()} #ad`;
  return { caption: fixedCaption, hashtags: tags };
}

export function validateScript(input: unknown): ScriptOutput {
  const o = obj(input, 'script');
  const scenes = arr(o.scenes, 'script.scenes').map((s, i) => {
    const item = obj(s, `script.scenes[${i}]`);
    return {
      time: str(item.time, `script.scenes[${i}].time`),
      text: str(item.text, `script.scenes[${i}].text`),
      emotion: str(item.emotion, `script.scenes[${i}].emotion`),
      visual: str(item.visual, `script.scenes[${i}].visual`),
    };
  });
  const hashtags = arr(o.hashtags, 'script.hashtags', 0).map((h, i) => str(h, `script.hashtags[${i}]`));
  const disclosed = ensureDisclosure(str(o.caption, 'script.caption'), hashtags);
  return {
    script: str(o.script, 'script.script'),
    scenes,
    caption: disclosed.caption,
    hashtags: disclosed.hashtags,
  };
}

export function validateVisuals(input: unknown): VisualsOutput {
  const o = obj(input, 'visuals');
  return {
    scenePrompts: arr(o.scenePrompts, 'visuals.scenePrompts').map((s, i) => {
      const item = obj(s, `visuals.scenePrompts[${i}]`);
      return {
        sceneIndex: num(item.sceneIndex, `visuals.scenePrompts[${i}].sceneIndex`),
        duration: num(item.duration, `visuals.scenePrompts[${i}].duration`),
        prompt: str(item.prompt, `visuals.scenePrompts[${i}].prompt`),
        voiceoverText: str(item.voiceoverText, `visuals.scenePrompts[${i}].voiceoverText`),
      };
    }),
  };
}
