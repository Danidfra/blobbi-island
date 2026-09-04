/**
 * Shared Playback Session, the pure protocol library.
 *
 * Framework-free by rule (protocol §14.3): nothing in this directory may import
 * React, the DOM, the seat system, presence, chat or rendering. That is what
 * lets the correctness-critical parts of a watch session be proven in
 * milliseconds by `vitest` instead of by two humans watching a video, and what
 * keeps sessions usable outside the theater.
 *
 * The dependency direction it protects:
 *
 * ```
 *   src/lib/shared-playback/**        pure protocol   ← this directory
 *          ▲
 *   src/hooks/useSharedPlayback.ts    React, relay I/O
 *          ▲
 *   src/components/blobbi/theater/**  UI, player, seats
 * ```
 */

export * from './constants';
export * from './types';
export * from './address';
export * from './invite-code';
export * from './parse';
export * from './builders';
export * from './ordering';
export * from './timing';
export * from './session-state';
export * from './session-client';
export * from './errors';
export * from './publish';
