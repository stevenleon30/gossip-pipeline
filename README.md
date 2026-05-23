# Gossip Pipeline

Three Claude agents that turn any product into a ready-to-shoot TikTok storytime video. One prompt in, full script + visual direction + (optionally) generated video clips out.

Built as a curiosity project to see how far AI agent orchestration can go for content creation. Not a developer, just stubborn enough to keep going when the errors stacked up.

## How it works

The pipeline runs three Claude agents in sequence, each handing structured JSON output to the next:

**Agent 1 — Researcher**
Researches the product and surfaces three gossip-worthy angles. Looks for drama, surprise, hidden details, or "I can't believe this works" hooks. Not generic facts. The angle other creators are actually leaning into.

**Agent 2 — Story Writer**
Writes the actual TikTok script in first-person gossip voice. Hook in 3 seconds, escalation, soft product reveal, CTA that doesn't feel like a CTA. Natural tone with phrases like "literally," "I'm not even kidding," "wait wait wait." Includes #ad disclosure automatically.

**Agent 3 — Visual Director**
Turns the script into scene-by-scene video prompts ready for Seedance. Each scene includes duration, emotional beat, visual description, and exact voiceover text. UGC aesthetic, not cinematic. Natural light, real bedrooms, no over-production.

Optional fourth step generates the actual video clips by calling Replicate's Seedance 1.0 Lite model.

## Sample output

For Sol de Janeiro Bum Bum Cream, the pipeline produced:

- Gossip angle: "The scent is so powerful strangers confront you about it in public"
- Script lines: *"caramel? vanilla? the tears of angels?"* and *"you WILL be perceived"*
- 5 scene prompts targeting natural-light UGC aesthetic with emotional beats specified

All under 60 seconds of pipeline runtime. The script reads like a real creator, not an ad.

## Stack

- Claude Sonnet 4.6 (Anthropic API) for all three agents
- Seedance 1.0 Lite (via Replicate) for video generation
- TypeScript on Node 20
- Run with `tsx`

## Setup

```bash
git clone https://github.com/stevenleon30/gossip-pipeline.git
cd gossip-pipeline
npm install
cp .env.example .env
```

Then add your API keys to `.env`:
