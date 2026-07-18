import { parseSync } from 'subtitle';
import type { Cue } from '../../../src/shared/ipc.types';

export function parseSrt(content: string): Cue[] {
  const nodes = parseSync(content);
  const cues: Cue[] = [];

  for (const node of nodes) {
    if (node.type !== 'cue') continue;
    const start = Math.round(node.data.start);
    const end = Math.round(node.data.end);
    const text = node.data.text.trim();
    if (!text || start >= end) continue;
    cues.push({
      id: cues.length + 1,
      start,
      end,
      text,
    });
  }

  for (let i = 1; i < cues.length; i++) {
    if (cues[i].start < cues[i - 1].start) {
      throw new Error(`SRT cue ${cues[i].id} starts before previous cue`);
    }
  }

  return cues;
}
