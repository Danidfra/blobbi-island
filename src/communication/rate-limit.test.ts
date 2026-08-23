/**
 * Cooldowns, in both directions.
 *
 * The property that matters most is the last one: a sender cannot bank silence
 * and spend it as a burst. That is the difference between a minimum-interval
 * gate and a token bucket, and it is the shape of "say nothing for a minute,
 * then put twenty emotes over someone's head".
 */
import { describe, expect, it } from 'vitest';

import { INBOUND_MIN_INTERVAL_MS, SEND_COOLDOWN_MS, createInboundThrottle } from './rate-limit';

describe('send cooldowns', () => {
  it('leaves free text exactly where the deployed client had it', () => {
    // Standard chat must feel identical after this phase.
    expect(SEND_COOLDOWN_MS.text).toBe(500);
  });

  it('charges more for the one-tap classes than for typing', () => {
    // Typing is its own rate limit; tapping is not, so the cheaper input gets
    // the higher floor.
    for (const type of ['quick', 'template', 'emote'] as const) {
      expect(SEND_COOLDOWN_MS[type]).toBeGreaterThan(SEND_COOLDOWN_MS.text);
    }
  });

  it('stays responsive enough to hold a conversation', () => {
    for (const cooldown of Object.values(SEND_COOLDOWN_MS)) {
      expect(cooldown).toBeLessThanOrEqual(1000);
    }
  });
});

describe('inbound throttle', () => {
  it('admits the first message from a sender', () => {
    const throttle = createInboundThrottle();
    expect(throttle.admit('alice', 1000)).toBe(true);
  });

  it('refuses a second message inside the interval', () => {
    const throttle = createInboundThrottle();
    throttle.admit('alice', 1000);
    expect(throttle.admit('alice', 1000 + INBOUND_MIN_INTERVAL_MS - 1)).toBe(false);
  });

  it('admits again once the interval has passed', () => {
    const throttle = createInboundThrottle();
    throttle.admit('alice', 1000);
    expect(throttle.admit('alice', 1000 + INBOUND_MIN_INTERVAL_MS)).toBe(true);
  });

  it('throttles each sender independently', () => {
    // One player flooding must not silence everyone else in the room.
    const throttle = createInboundThrottle();
    expect(throttle.admit('alice', 1000)).toBe(true);
    expect(throttle.admit('bob', 1000)).toBe(true);
    expect(throttle.admit('carol', 1000)).toBe(true);
    expect(throttle.admit('alice', 1000)).toBe(false);
  });

  it('does not let a sender bank silence and spend it as a burst', () => {
    const throttle = createInboundThrottle();
    throttle.admit('alice', 0);
    // A minute of quiet buys exactly one message, not sixty.
    expect(throttle.admit('alice', 60_000)).toBe(true);
    expect(throttle.admit('alice', 60_001)).toBe(false);
    expect(throttle.admit('alice', 60_002)).toBe(false);
  });

  it('bounds a flood to a known rate rather than a queue', () => {
    const throttle = createInboundThrottle();
    let admitted = 0;
    // 100 messages in one second from one sender.
    for (let i = 0; i < 100; i += 1) {
      if (throttle.admit('flooder', 10_000 + i * 10)) admitted += 1;
    }
    expect(admitted).toBeLessThanOrEqual(4);
  });

  it('is below the FASTEST send cooldown, so a well-behaved client is never throttled', () => {
    // Sized against the fastest class, not the slowest: free text may be sent
    // every 500 ms, so a receiver-side limit at or above that would drop
    // messages from a player who is simply typing quickly.
    expect(INBOUND_MIN_INTERVAL_MS).toBeLessThan(Math.min(...Object.values(SEND_COOLDOWN_MS)));
  });

  it('lets a player type at the full send rate without being throttled', () => {
    const throttle = createInboundThrottle();
    let admitted = 0;
    // Ten messages at exactly the free-text cooldown: every one must arrive.
    for (let i = 0; i < 10; i += 1) {
      if (throttle.admit('chatty', i * SEND_COOLDOWN_MS.text)) admitted += 1;
    }
    expect(admitted).toBe(10);
  });

  it('forgets senders it has not heard from, so memory stays bounded', () => {
    const throttle = createInboundThrottle();
    for (let i = 0; i < 200; i += 1) throttle.admit(`sender-${i}`, 1000);
    expect(throttle.size()).toBe(200);

    // Far past the entry TTL: the next admit prunes everyone who went quiet.
    throttle.admit('someone-new', 1000 + 120_000);
    expect(throttle.size()).toBe(1);
  });

  it('keeps memory bounded even with a continuous stream of new senders', () => {
    const throttle = createInboundThrottle();
    for (let i = 0; i < 2000; i += 1) throttle.admit(`sender-${i}`, 1000 + i);
    expect(throttle.size()).toBeLessThanOrEqual(512);
  });

  it('accepts an injected interval, so the policy is testable without a clock', () => {
    const throttle = createInboundThrottle(50);
    throttle.admit('alice', 0);
    expect(throttle.admit('alice', 49)).toBe(false);
    expect(throttle.admit('alice', 50)).toBe(true);
  });
});
