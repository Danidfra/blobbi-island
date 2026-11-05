/**
 * The relay list handed to the kit's world-travel session: the newly added
 * primary cannot vouch for "no location" alone, and a location that already
 * exists is not re-sent unless the account chose to have its events carried.
 * In-memory relays and synthetic events only.
 */
import { describe, expect, it } from 'vitest';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { CARRY_OFF_MESSAGE, islandWorldTravelRelays } from './travel-relays';
import { BLOBBI_RELAY_URL, classifyRejection } from './relay-routing';

const DITTO = 'wss://relay.ditto.pub';
const PRIMAL = 'wss://relay.primal.net';
const KIT = [DITTO, PRIMAL];
const FILTER: NostrFilter = { kinds: [31126], authors: ['f'.repeat(64)], '#d': ['blobbi-x'], limit: 5 };

const location = (id: string): NostrEvent => ({ id, pubkey: 'f'.repeat(64), kind: 31126, created_at: 1000, tags: [['d', 'blobbi-x']], content: '', sig: `sig-${id}` });

class Relay {
  stored: NostrEvent[] = [];
  offered: NostrEvent[] = [];
  down = false;
  async query(): Promise<NostrEvent[]> {
    if (this.down) throw new Error('unreachable');
    return [...this.stored];
  }
  async event(event: NostrEvent): Promise<void> {
    this.offered.push(event);
    if (this.down) throw new Error('unreachable');
    this.stored.push(event);
  }
  async *req(): AsyncIterable<unknown> {}
}

function setup(mayCarryTo?: (relay: string) => boolean) {
  const relays: Record<string, Relay> = { [BLOBBI_RELAY_URL]: new Relay(), [DITTO]: new Relay(), [PRIMAL]: new Relay() };
  const travel = islandWorldTravelRelays({ relay: (url) => relays[url] }, BLOBBI_RELAY_URL, KIT, { mayCarryTo });
  const signal = new AbortController().signal;
  return { relays, travel, signal, blobbi: relays[BLOBBI_RELAY_URL], ditto: relays[DITTO], primal: relays[PRIMAL] };
}

describe('the travel relay list', () => {
  it('is the primary, then the kit\'s own relays', () => {
    expect(setup().travel.urls).toEqual([BLOBBI_RELAY_URL, DITTO, PRIMAL]);
  });

  it('an empty primary alone is no answer; with an established relay answering, it is', async () => {
    const alone = setup();
    alone.ditto.down = true;
    alone.primal.down = true;
    const round = alone.travel.urls.map((url) => alone.travel.query(url, FILTER, alone.signal).then((e) => e, () => null));
    expect(await Promise.all(round)).toEqual([null, null, null]);

    const together = setup();
    together.primal.down = true;
    const answers = await Promise.all(together.travel.urls.map((url) => together.travel.query(url, FILTER, together.signal).then((e) => e, () => null)));
    expect(answers).toEqual([[], [], null]);
  });

  it('a primary that holds the location answers by itself', async () => {
    const w = setup();
    w.ditto.down = true;
    w.primal.down = true;
    w.blobbi.stored.push(location('a1'));
    expect(await w.travel.query(BLOBBI_RELAY_URL, FILTER, w.signal)).toHaveLength(1);
  });

  it('a location a relay already showed is not re-sent to the relays lacking it: no EVENT on a page that only looked', async () => {
    const w = setup();
    const existing = location('a1');
    w.ditto.stored.push(existing);
    await Promise.all(w.travel.urls.map((url) => w.travel.query(url, FILTER, w.signal).catch(() => null)));

    for (const url of [BLOBBI_RELAY_URL, PRIMAL]) {
      await expect(w.travel.publish(url, existing, w.signal)).rejects.toThrow(CARRY_OFF_MESSAGE);
    }
    expect([...w.blobbi.offered, ...w.ditto.offered, ...w.primal.offered]).toEqual([]);
    // The kit reads this prefix as final and stops repairing that relay.
    expect(classifyRejection(CARRY_OFF_MESSAGE)).toBe('rejected');
  });

  it('a move made on this page is new: it goes to every relay, and may be retried', async () => {
    const w = setup();
    const move = location('b2');
    w.primal.down = true;
    await w.travel.publish(BLOBBI_RELAY_URL, move, w.signal);
    await w.travel.publish(DITTO, move, w.signal);
    await expect(w.travel.publish(PRIMAL, move, w.signal)).rejects.toThrow('unreachable');
    w.primal.down = false;
    await w.travel.publish(PRIMAL, move, w.signal);
    expect(w.blobbi.stored).toEqual([move]);
    expect(w.primal.stored).toEqual([move]);
  });

  it('once the account chose to have its events carried, the repair reaches the chosen relays only', async () => {
    const w = setup((relay) => relay === BLOBBI_RELAY_URL);
    const existing = location('a1');
    w.ditto.stored.push(existing);
    await Promise.all(w.travel.urls.map((url) => w.travel.query(url, FILTER, w.signal).catch(() => null)));

    await w.travel.publish(BLOBBI_RELAY_URL, existing, w.signal);
    await expect(w.travel.publish(PRIMAL, existing, w.signal)).rejects.toThrow(CARRY_OFF_MESSAGE);
    expect(w.blobbi.stored).toEqual([existing]);
    expect(w.primal.offered).toEqual([]);
  });
});
