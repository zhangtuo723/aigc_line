import Anthropic from '@anthropic-ai/sdk';
import type { Cue, ImageStyle } from '../../../src/shared/ipc.types';

const STYLE_PROMPTS: Record<ImageStyle, string> = {
  pencil: 'rough graphite pencil sketch, monochrome line art on white paper, expressive strokes, slight paper texture, minimal shading, not photorealistic',
  ink: 'bold ink line drawing, monochrome line art on white paper, expressive strokes, minimal shading, not photorealistic',
  marker: 'marker sketch, loose strokes, monochrome line art on white paper, minimal shading, not photorealistic',
};

const SYSTEM_PROMPT = `You are a storyboard artist. For each subtitle cue, write a concise, vivid image-generation prompt for a hand-drawn storyboard panel. Emphasize composition, action, and mood. Output only the prompt text, no commentary.`;

export async function generateScenePrompt(
  client: Anthropic,
  cue: Cue,
  style: ImageStyle = 'pencil',
  previousContext?: string,
): Promise<string> {
  const duration = Math.round((cue.end - cue.start) / 1000);
  const styleText = STYLE_PROMPTS[style];
  const contextText = previousContext
    ? `\nPrevious scene context: ${previousContext}`
    : '';

  const response = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 1024,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Style: ${styleText}.\nSubtitle cue: "${cue.text}"\nDuration: ${duration}s${contextText}`,
      },
    ],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();

  if (!text) {
    throw new Error('Claude returned empty prompt');
  }

  return text;
}
