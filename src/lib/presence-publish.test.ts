import { describe, it, expect, vi } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import { createPresencePublisher, isPresenceSignerRefusal, PresenceSignerRefusedError } from './presence-publish';

const PUBKEY = 'a'.repeat(64);

function signer(behaviour: 'ok' | 'refuse') {
  return {
    pubkey: PUBKEY,
    signer: {
      signEvent: vi.fn(async (t: { kind: number; tags: string[][] }): Promise<NostrEvent> => {
        if (behaviour === 'refuse') throw 'User rejected the request'; // some extensions throw plain strings
        return { ...t, id: 'e'.repeat(64), pubkey: PUBKEY, content: '', created_at: 1, sig: 'sig' } as NostrEvent;
      }),
    },
  } as unknown as Parameters<typeof createPresencePublisher>[0]['user'];
}

describe('the presence publisher tells signing apart from sending', () => {
  it('a signer that declines is a PresenceSignerRefusedError, whatever it threw', async () => {
    const nostr = { event: vi.fn(async () => {}) };
    const publish = createPresencePublisher({ user: signer('refuse'), nostr });
    await expect(publish({ kind: 31950, tags: [] })).rejects.toBeInstanceOf(PresenceSignerRefusedError);
    expect(nostr.event).not.toHaveBeenCalled();
  });

  it('a relay timeout is best-effort: it resolves, exactly as presence always behaved', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const nostr = { event: vi.fn(async () => { throw timeout; }) };
    const publish = createPresencePublisher({ user: signer('ok'), nostr });
    await expect(publish({ kind: 31950, tags: [] })).resolves.toBeUndefined();
  });

  it('any other relay failure is transient and thrown as-is; never a refusal', async () => {
    const nostr = { event: vi.fn(async () => { throw new Error('relay refused'); }) };
    const publish = createPresencePublisher({ user: signer('ok'), nostr });
    await expect(publish({ kind: 31950, tags: [] })).rejects.toThrow('relay refused');
    await publish({ kind: 31950, tags: [] }).catch((e) => expect(isPresenceSignerRefusal(e)).toBe(false));
  });

  it('signs as the player with the client tag the generic hook always added', async () => {
    const nostr = { event: vi.fn(async () => {}) };
    const user = signer('ok');
    const publish = createPresencePublisher({ user, nostr });
    await publish({ kind: 31950, tags: [['t', 'blobbi:presence']], content: '{}' });
    const [template] = (user.signer.signEvent as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(template.tags).toContainEqual(['client', 'blobbi']);
    expect(template.kind).toBe(31950);
    expect(nostr.event).toHaveBeenCalledTimes(1);
  });
});
