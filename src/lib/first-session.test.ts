import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearFirstSessionPreferences,
  hasCelebratedCoinGrant,
  hasSeenArrivalThisSession,
  hasSeenWelcome,
  markArrivalSeen,
  markCoinGrantCelebrated,
  markWelcomeSeen,
  readDockCollapsed,
  writeDockCollapsed,
} from './first-session';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

beforeEach(() => clearFirstSessionPreferences());

describe('first-session preferences', () => {
  it('start unseen, per player', () => {
    expect(hasSeenWelcome(A)).toBe(false);
    markWelcomeSeen(A);
    expect(hasSeenWelcome(A)).toBe(true);
    expect(hasSeenWelcome(B)).toBe(false);
  });

  it('remember the coin celebration per player, on this device', () => {
    markCoinGrantCelebrated(A);
    expect(hasCelebratedCoinGrant(A)).toBe(true);
    expect(hasCelebratedCoinGrant(B)).toBe(false);
    expect(localStorage.getItem(`blobbi:first-session:coin-grant-celebrated:v1:${A}`)).toBe('1');
  });

  it('scope the arrival to this visit (session storage), not the device', () => {
    markArrivalSeen(A);
    expect(hasSeenArrivalThisSession(A)).toBe(true);
    expect(sessionStorage.getItem(`blobbi:first-session:arrival-seen:${A}`)).toBe('1');
    expect(localStorage.getItem(`blobbi:first-session:arrival-seen:${A}`)).toBeNull();
  });

  it('the dock is visible by default and only an explicit collapse is remembered', () => {
    expect(readDockCollapsed()).toBe(false);
    writeDockCollapsed(true);
    expect(readDockCollapsed()).toBe(true);
    writeDockCollapsed(false);
    expect(readDockCollapsed()).toBe(false);
  });

  it('never publishes anything: every key is a local storage key', () => {
    markWelcomeSeen(A);
    markCoinGrantCelebrated(A);
    markArrivalSeen(A);
    const keys = [...Array(localStorage.length).keys()].map((i) => localStorage.key(i));
    expect(keys.every((k) => k?.startsWith('blobbi:'))).toBe(true);
  });
});
