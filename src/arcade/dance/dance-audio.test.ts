/**
 * Audio-engine tests.
 *
 * `jsdom` has no `AudioContext`, so what is testable here is the part that
 * matters most anyway: the SCHEDULE. It is pure, it is derived from the track's
 * tempo, and it must be byte-identical between runs — a rhythm game whose music
 * differs from run to run is a rhythm game whose chart is wrong.
 *
 * The engine itself is exercised through a fake in the component tests; its real
 * behaviour needs a browser and is covered in the manual verification notes.
 */
import { describe, it, expect } from 'vitest';

import { buildDanceTrackSchedule, createDanceAudioEngine } from './dance-audio';
import { NEON_HOP_TRACK, msPerBeat } from './track';

const schedule = buildDanceTrackSchedule(NEON_HOP_TRACK);

describe('the generated schedule', () => {
  it('is deterministic', () => {
    expect(buildDanceTrackSchedule(NEON_HOP_TRACK)).toEqual(schedule);
  });

  it('is sorted and never negative', () => {
    let previous = -1;
    for (const event of schedule) {
      expect(event.at).toBeGreaterThanOrEqual(0);
      expect(event.at).toBeGreaterThanOrEqual(previous);
      previous = event.at;
    }
  });

  it('counts the player in over the lead-in, in tempo', () => {
    const counts = schedule.filter((e) => e.voice === 'count');
    expect(counts).toHaveLength(NEON_HOP_TRACK.beatsPerBar);
    const beatS = msPerBeat(NEON_HOP_TRACK.bpm) / 1000;
    for (let i = 1; i < counts.length; i += 1) {
      expect(counts[i].at - counts[i - 1].at).toBeCloseTo(beatS, 6);
    }
    // Every count-in click lands before the first musical beat.
    for (const count of counts) {
      expect(count.at).toBeLessThan(NEON_HOP_TRACK.leadInMs / 1000);
    }
  });

  it('puts a kick on every beat of the body', () => {
    const beatS = msPerBeat(NEON_HOP_TRACK.bpm) / 1000;
    const bodyS =
      (NEON_HOP_TRACK.durationMs - NEON_HOP_TRACK.leadInMs - NEON_HOP_TRACK.tailMs) / 1000;
    const kicks = schedule.filter((e) => e.voice === 'kick');
    // One per beat, plus the one that lands the ending.
    expect(kicks).toHaveLength(Math.round(bodyS / beatS) + 1);
  });

  it('ends within the track, not past it', () => {
    const last = schedule[schedule.length - 1];
    expect(last.at * 1000).toBeLessThanOrEqual(NEON_HOP_TRACK.durationMs);
  });

  it('uses a fixed bass progression rather than a random one', () => {
    const bassNotes = schedule.filter((e) => e.voice === 'bass').map((e) => e.frequency);
    expect(new Set(bassNotes).size).toBeLessThanOrEqual(4);
    expect(bassNotes.every((f) => typeof f === 'number' && Number.isFinite(f))).toBe(true);
  });
});

describe('creating the engine without Web Audio', () => {
  it('reports the failure instead of throwing or pretending', () => {
    // jsdom exposes neither `AudioContext` nor `webkitAudioContext`.
    const created = createDanceAudioEngine(NEON_HOP_TRACK);
    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.failure).toBe('no-web-audio');
  });
});
