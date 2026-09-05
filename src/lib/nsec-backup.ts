/**
 * The secret-key backup file a new account downloads.
 *
 * One Nostr key is one identity across every Blobbi experience (Island, Farm
 * and whatever comes next), so the file is named for the account system, not
 * for the app that happened to generate it. The short npub suffix tells two
 * backups apart without putting anything secret in the name.
 *
 * The CONTENT is the bare `nsec1…` string and nothing else: it is exactly what
 * the login dialog's file upload expects back, and there is nothing else a
 * backup should carry.
 */
import { getPublicKey, nip19 } from 'nostr-tools';

export const NSEC_BACKUP_MIME = 'text/plain; charset=utf-8';

const FILENAME_PREFIX = 'blobbi-nostr-key-backup';

/**
 * `blobbi-nostr-key-backup-<8 npub chars>.txt` for a valid nsec.
 *
 * Throws on anything that is not an nsec, so a caller cannot download a file
 * whose name promises a key it does not contain.
 */
export function nsecBackupFilename(nsec: string): string {
  const decoded = nip19.decode(nsec);
  if (decoded.type !== 'nsec') throw new Error('Not an nsec');
  const npub = nip19.npubEncode(getPublicKey(decoded.data));
  return `${FILENAME_PREFIX}-${npub.slice(5, 13)}.txt`;
}
