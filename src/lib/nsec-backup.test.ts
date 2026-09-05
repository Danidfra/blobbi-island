import { describe, expect, it } from 'vitest';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { NSEC_BACKUP_MIME, nsecBackupFilename } from './nsec-backup';

describe('nsecBackupFilename', () => {
  it('names the file for the Blobbi account system with a short npub suffix', () => {
    const sk = generateSecretKey();
    const npub = nip19.npubEncode(getPublicKey(sk));
    const name = nsecBackupFilename(nip19.nsecEncode(sk));
    expect(name).toBe(`blobbi-nostr-key-backup-${npub.slice(5, 13)}.txt`);
    expect(name).toMatch(/^blobbi-nostr-key-backup-[a-z0-9]{8}\.txt$/);
  });

  it('never puts the secret in the name', () => {
    const nsec = nip19.nsecEncode(generateSecretKey());
    expect(nsecBackupFilename(nsec)).not.toContain(nsec.slice(5, 20));
  });

  it('refuses anything that is not an nsec', () => {
    const npub = nip19.npubEncode(getPublicKey(generateSecretKey()));
    expect(() => nsecBackupFilename(npub)).toThrow();
    expect(() => nsecBackupFilename('not-a-key')).toThrow();
  });

  it('declares the file as UTF-8 plain text', () => {
    expect(NSEC_BACKUP_MIME).toBe('text/plain; charset=utf-8');
  });
});
