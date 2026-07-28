/**
 * Blobbi Dance — the track contract.
 *
 * ## Why a track is not a filename
 *
 * A final licensed or original production track does not exist yet, and waiting
 * for one would mean building the timing, the chart and the judgement against an
 * asset that might never ship. So a track is IDENTITY plus METADATA, and the
 * chart references the identity. Swapping the audio source later is a change to
 * one field of one record; it is not a chart migration, and it cannot invalidate
 * a note timing, because every note time is expressed in milliseconds from the
 * track's own zero rather than as an offset into a file.
 *
 * ## The source kinds
 *
 * | kind | meaning |
 * | --- | --- |
 * | `synth` | generated in the browser from `AudioContext`. No asset, no licence, ships safely. |
 * | `asset` | a real audio file the repository owns and may ship. |
 *
 * **The only track that exists today is `synth`.** The repository contains
 * exactly one audio asset (`public/assets/audio/sfx/bush-rustle.mp3`, a one-shot
 * UI effect) and no music of any kind, so option 1 of the phase brief (reuse an
 * existing repository-owned asset) has nothing to reuse and option 2 (add an
 * original recorded asset) is not something a code change can honestly produce.
 * Option 3 — a synthesised development track scheduled against the audio clock —
 * is what ships, and `readiness: 'development'` says so in data rather than only
 * in a document.
 *
 * ## What is deliberately absent
 *
 * Song selection, multiple difficulties, unlock state, and any per-user track
 * data. One track, one chart, one difficulty. A second track is additive: a new
 * record here plus a new chart that names it.
 */

/** Stable track identity. Never a filename, never a URL. */
export type DanceTrackId = string;

/**
 * How the audio for a track is produced.
 *
 * `synth` tracks carry no asset and therefore no licence question at all — the
 * waveform is computed in the browser from the parameters below.
 */
export type DanceTrackSource =
  | { readonly kind: 'synth' }
  | { readonly kind: 'asset'; readonly url: string };

/**
 * Whether a track may ship to players as final content.
 *
 * `development` is not a soft warning: the preview renders it, and it exists so
 * a placeholder can never quietly become the shipped experience by being
 * forgotten about.
 */
export type DanceTrackReadiness = 'development' | 'production';

export interface DanceTrack {
  readonly id: DanceTrackId;
  readonly title: string;
  /** Who authored the audio. For a synth track this is the code itself. */
  readonly credit: string;
  /**
   * Licence statement. For a synth track there is no third-party material at
   * all, which is the point: nothing here can become a licensing problem.
   */
  readonly licence: string;
  readonly readiness: DanceTrackReadiness;
  readonly source: DanceTrackSource;
  /** Beats per minute. The chart's grid derives from this. */
  readonly bpm: number;
  /** Beats per bar. 4 for everything this game will plausibly ship. */
  readonly beatsPerBar: number;
  /**
   * Silence before beat zero, in milliseconds.
   *
   * The countdown runs over this, so the first note is never the first sound a
   * player hears. It is part of the TRACK rather than the chart because it is a
   * property of the audio, and a chart written against a different lead-in would
   * be a different chart.
   */
  readonly leadInMs: number;
  /**
   * Audio that continues after the last note, in milliseconds. The run does not
   * end on the last note — it ends when the music does, so a missed final note
   * does not end the song a beat early.
   */
  readonly tailMs: number;
  /** Total playable length, lead-in and tail included. Derived, not authored. */
  readonly durationMs: number;
}

/** Milliseconds per beat at a given tempo. */
export function msPerBeat(bpm: number): number {
  return 60_000 / bpm;
}

// ── The one track ───────────────────────────────────────────────────────────

const NEON_HOP_BPM = 120;
const NEON_HOP_BEATS_PER_BAR = 4;
const NEON_HOP_LEAD_IN_MS = 4 * msPerBeat(NEON_HOP_BPM); // one bar of count-in
/** 32 bars of chart at 4 beats each — 64 seconds of playable music. */
export const NEON_HOP_BARS = 32;
const NEON_HOP_BODY_MS = NEON_HOP_BARS * NEON_HOP_BEATS_PER_BAR * msPerBeat(NEON_HOP_BPM);
const NEON_HOP_TAIL_MS = 4 * msPerBeat(NEON_HOP_BPM); // one bar to land the ending

/**
 * `blobbi-dance-neon-hop-v1` — 120 BPM, 32 bars, 68 seconds end to end.
 *
 * Synthesised in the browser (see `dance-audio.ts`): a four-on-the-floor kick, an
 * offbeat hat, a backbeat clap and a two-bar bass/lead motif, all scheduled
 * against `AudioContext.currentTime`. It is deliberately simple and deliberately
 * ours — there is nothing here to licence and nothing to take down.
 *
 * The `-v1` suffix is part of the identity. A retuned or re-recorded track is
 * `-v2` and a new record, because a chart written against these timings must not
 * silently start playing over different music.
 */
export const NEON_HOP_TRACK: DanceTrack = {
  id: 'blobbi-dance-neon-hop-v1',
  title: 'Neon Hop',
  credit: 'Generated by Blobbi Island (Web Audio synthesis)',
  licence:
    'No third-party material. The waveform is computed in the browser from code in this repository, so there is no sample, no recording and no licence to clear.',
  readiness: 'development',
  source: { kind: 'synth' },
  bpm: NEON_HOP_BPM,
  beatsPerBar: NEON_HOP_BEATS_PER_BAR,
  leadInMs: NEON_HOP_LEAD_IN_MS,
  tailMs: NEON_HOP_TAIL_MS,
  durationMs: NEON_HOP_LEAD_IN_MS + NEON_HOP_BODY_MS + NEON_HOP_TAIL_MS,
};

const TRACKS: readonly DanceTrack[] = [NEON_HOP_TRACK];

export function getDanceTrack(id: DanceTrackId): DanceTrack | undefined {
  return TRACKS.find((t) => t.id === id);
}

export const danceTracks = TRACKS;
