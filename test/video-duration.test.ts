import { expect, it } from 'vitest';
import { VIDEO_DURATIONS, normalizeVideoDuration } from '../src/shared/video-duration';

it('preserves every integer-second H3 duration, including non-preset values', () => {
  expect(VIDEO_DURATIONS).toHaveLength(15);
  for (let seconds = 1; seconds <= 15; seconds++) {
    expect(VIDEO_DURATIONS).toContain(seconds);
    expect(normalizeVideoDuration(seconds)).toBe(seconds);
  }
});

it('normalizes invalid data and retains the existing Seedance minimum', () => {
  expect(normalizeVideoDuration(undefined)).toBe(5);
  expect(normalizeVideoDuration(NaN)).toBe(5);
  expect(normalizeVideoDuration(0)).toBe(1);
  expect(normalizeVideoDuration(25)).toBe(15);
  expect(normalizeVideoDuration(7.3)).toBe(7);
  expect(normalizeVideoDuration(1, 'seedance-2.0')).toBe(4);
  expect(normalizeVideoDuration(7, 'seedance-2.0')).toBe(7);
});
