/**
 * Coverage for visual seat occupancy and the duplicate-claim policy.
 *
 * The one invariant everything else serves: **no client ever draws two seated
 * Blobbis in the same chair.** Nothing reserves a seat, so two players really
 * can walk into one, and without a deterministic rule two sprites would overlap
 * at the same anchor.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveRemoteSeatOccupancy,
  occupiedSeatIds,
  type RemoteSeatClaim,
} from './theater-occupancy';
import {
  decorativeTheaterSeats,
  occupiableTheaterSeats,
} from './theater-seats-config';

const SEAT_A = 'theater-seat-a4';
const SEAT_B = 'theater-seat-c2';
/** Row B's outermost chairs hang off the world; they are scenery, not seats. */
const DECORATIVE = decorativeTheaterSeats[0].id;

const claim = (seatId: string, pubkey: string, sessionId = 's1'): RemoteSeatClaim => ({
  seatId,
  pubkey,
  sessionId,
});

describe('resolveRemoteSeatOccupancy', () => {
  it('returns nothing when nobody claims a seat', () => {
    expect(resolveRemoteSeatOccupancy([], null).size).toBe(0);
  });

  it('seats a single uncontested remote claim', () => {
    const winners = resolveRemoteSeatOccupancy([claim(SEAT_A, 'ff')], null);
    expect(winners.get(SEAT_A)).toEqual(claim(SEAT_A, 'ff'));
  });

  it('keeps independent seats independent', () => {
    const winners = resolveRemoteSeatOccupancy(
      [claim(SEAT_A, 'ff'), claim(SEAT_B, 'aa')],
      null,
    );
    expect(winners.get(SEAT_A)!.pubkey).toBe('ff');
    expect(winners.get(SEAT_B)!.pubkey).toBe('aa');
  });

  describe('duplicate claims', () => {
    it('gives the seat to the lowest hex pubkey, whatever order they arrive in', () => {
      const forwards = resolveRemoteSeatOccupancy(
        [claim(SEAT_A, 'aa11'), claim(SEAT_A, 'bb22'), claim(SEAT_A, '0099')],
        null,
      );
      const backwards = resolveRemoteSeatOccupancy(
        [claim(SEAT_A, '0099'), claim(SEAT_A, 'bb22'), claim(SEAT_A, 'aa11')],
        null,
      );

      // Order-independent: two clients that received the same presence in
      // different orders must still agree on who is in the chair.
      expect(forwards.get(SEAT_A)!.pubkey).toBe('0099');
      expect(backwards.get(SEAT_A)!.pubkey).toBe('0099');
      expect(forwards.size).toBe(1);
    });

    it('never returns more than one winner per seat', () => {
      const winners = resolveRemoteSeatOccupancy(
        [claim(SEAT_A, 'aa'), claim(SEAT_A, 'bb'), claim(SEAT_A, 'cc'), claim(SEAT_A, 'dd')],
        null,
      );
      expect(winners.size).toBe(1);
    });

    it('breaks a same-pubkey tie by session id, deterministically', () => {
      // Two live sessions of one account (two tabs) is rare but must not be
      // resolved by luck.
      const winners = resolveRemoteSeatOccupancy(
        [claim(SEAT_A, 'aa', 'zzz'), claim(SEAT_A, 'aa', 'aaa')],
        null,
      );
      expect(winners.get(SEAT_A)!.sessionId).toBe('aaa');
    });

    it('lets the loser keep their other seat claims', () => {
      const winners = resolveRemoteSeatOccupancy(
        [claim(SEAT_A, 'ff'), claim(SEAT_A, 'aa'), claim(SEAT_B, 'ff')],
        null,
      );
      expect(winners.get(SEAT_A)!.pubkey).toBe('aa');
      expect(winners.get(SEAT_B)!.pubkey).toBe('ff');
    });
  });

  describe('the local player keeps their own seat', () => {
    it('drops a remote claim on the seat the local player occupies', () => {
      // Presence is advisory. A stranger's claim must never be able to stand you
      // up, spin your Blobbi around or tear down your control card, and drawing
      // them in your chair would be the overlap this whole module exists to
      // prevent.
      const winners = resolveRemoteSeatOccupancy([claim(SEAT_A, '0000')], SEAT_A);
      expect(winners.has(SEAT_A)).toBe(false);
    });

    it('drops EVERY remote claim on that seat, not just the winner', () => {
      const winners = resolveRemoteSeatOccupancy(
        [claim(SEAT_A, '0000'), claim(SEAT_A, 'ffff')],
        SEAT_A,
      );
      expect(winners.size).toBe(0);
    });

    it('leaves other seats untouched', () => {
      const winners = resolveRemoteSeatOccupancy(
        [claim(SEAT_A, '0000'), claim(SEAT_B, 'ffff')],
        SEAT_A,
      );
      expect(winners.has(SEAT_A)).toBe(false);
      expect(winners.get(SEAT_B)!.pubkey).toBe('ffff');
    });
  });

  describe('unusable claims', () => {
    it('refuses a decorative chair', () => {
      // Defence in depth: nothing local can ever produce this id, so seeing it
      // means a hostile or broken publisher.
      expect(decorativeTheaterSeats.length).toBeGreaterThan(0);
      expect(resolveRemoteSeatOccupancy([claim(DECORATIVE, 'aa')], null).size).toBe(0);
    });

    it('refuses an unknown or stale seat id', () => {
      const winners = resolveRemoteSeatOccupancy(
        [claim('theater-seat-z99', 'aa'), claim('town-bush-1', 'bb'), claim('', 'cc')],
        null,
      );
      expect(winners.size).toBe(0);
    });

    it('does not let an unusable claim displace a valid one', () => {
      // A lower pubkey with a junk id must not shadow a legitimate sitter.
      const winners = resolveRemoteSeatOccupancy(
        [claim(SEAT_A, 'ffff'), claim('nonsense', '0000')],
        null,
      );
      expect(winners.get(SEAT_A)!.pubkey).toBe('ffff');
    });

    it('accepts every real occupiable seat', () => {
      for (const seat of occupiableTheaterSeats) {
        expect(resolveRemoteSeatOccupancy([claim(seat.id, 'aa')], null).size).toBe(1);
      }
    });
  });

  describe('staleness', () => {
    it('releases a seat as soon as the claim leaves the input', () => {
      // There is no expiry logic in this module ON PURPOSE: claims come from the
      // live presence map, which NIP-40 expiration and the presence GC sweep
      // already prune. "Stale presence releases the seat" is therefore just
      // "the claim is no longer passed in".
      const seated = resolveRemoteSeatOccupancy([claim(SEAT_A, 'aa')], null);
      expect(seated.has(SEAT_A)).toBe(true);

      const afterExpiry = resolveRemoteSeatOccupancy([], null);
      expect(afterExpiry.has(SEAT_A)).toBe(false);
    });
  });
});

describe('occupiedSeatIds', () => {
  it('unions remote winners with the local seat', () => {
    const winners = resolveRemoteSeatOccupancy([claim(SEAT_A, 'aa')], SEAT_B);
    expect(occupiedSeatIds(winners, SEAT_B)).toEqual(new Set([SEAT_A, SEAT_B]));
  });

  it('is empty when nobody is seated anywhere', () => {
    expect(occupiedSeatIds(new Map(), null).size).toBe(0);
  });

  it('never reports a decorative chair as occupied, even locally', () => {
    expect(occupiedSeatIds(new Map(), DECORATIVE).size).toBe(0);
  });

  it('counts a seat once when the local player is its only occupant', () => {
    expect(occupiedSeatIds(new Map(), SEAT_A)).toEqual(new Set([SEAT_A]));
  });
});
