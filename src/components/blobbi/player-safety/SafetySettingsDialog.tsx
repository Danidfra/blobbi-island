/**
 * Settings › Safety — the list of people you have muted or blocked, and the way
 * to undo it.
 *
 * ## Why this is the whole surface
 *
 * Block has to be reversible somewhere that is not "find them again in the
 * world", because the entire point is that you can no longer find them in the
 * world. That is the only requirement this screen has, and it is deliberately
 * not the beginning of a Family Settings experience — no profile selector, no
 * PIN, no age gate. Those are their own phase.
 *
 * ## Players are named by their key, not by their Blobbi
 *
 * A Blobbi name is free text its owner chose. Rendering it here would mean a
 * list built to stop showing you someone's words shows you their words — and
 * a blocked player who renames themselves could write a message into this
 * screen. So each row is an abbreviated npub: stable, unchosen, and incapable of
 * saying anything. See `player-label.ts`.
 */

import { Shield, ShieldOff, Volume2, VolumeX } from 'lucide-react';

import { BlobbiModal } from '@/components/ui/blobbi-modal';
import { Button } from '@/components/ui/button';
import { SettingsRow, SettingsSection } from '@/components/ui/settings-row';
import { StateCard } from '@/components/ui/state-card';
import {
  setPlayerBlocked,
  setPlayerMuted,
  usePlayerSafetyEntries,
  type PlayerSafetyEntry,
} from '@/player-safety';

import { playerShortId } from './player-label';

interface SafetySettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function PlayerRow({
  entry,
  action,
  onAction,
}: {
  entry: PlayerSafetyEntry;
  action: 'unblock' | 'unmute';
  onAction: (pubkey: string) => void;
}) {
  const label = playerShortId(entry.pubkey);
  return (
    <SettingsRow
      icon={action === 'unblock' ? <ShieldOff /> : <VolumeX />}
      label={label}
      description={
        action === 'unblock' ? 'Hidden from your island' : 'Their messages are hidden'
      }
      trailing={
        <Button
          variant="soft"
          size="sm"
          onClick={() => onAction(entry.pubkey)}
          /* The row shows a short key, so the button must name the whole action
             or a screen reader hears six identical "Unblock"s. */
          aria-label={`${action === 'unblock' ? 'Unblock' : 'Unmute'} ${label}`}
        >
          {action === 'unblock' ? (
            <>
              <Shield className="mr-1.5 size-4" aria-hidden="true" />
              Unblock
            </>
          ) : (
            <>
              <Volume2 className="mr-1.5 size-4" aria-hidden="true" />
              Unmute
            </>
          )}
        </Button>
      }
    />
  );
}

export function SafetySettingsDialog({ open, onOpenChange }: SafetySettingsDialogProps) {
  const entries = usePlayerSafetyEntries();
  const blocked = entries.filter((entry) => entry.blocked);
  // Blocked players are listed once, under Blocked. A player who is both would
  // otherwise appear twice with two buttons, and unmuting them would look like
  // it had done nothing — because blocking already silences them.
  const muted = entries.filter((entry) => entry.muted && !entry.blocked);

  return (
    <BlobbiModal
      open={open}
      onOpenChange={onOpenChange}
      title="Safety"
      description="Players you have muted or blocked"
      icon={<Shield />}
      size="md"
    >
      {blocked.length === 0 && muted.length === 0 ? (
        <StateCard
          kind="empty"
          title="Nobody is blocked"
          message="If another player bothers you, tap their Blobbi and choose Mute or Block."
          compact
        />
      ) : (
        <div className="space-y-4">
          {blocked.length > 0 ? (
            <SettingsSection label="Blocked" icon={<ShieldOff />}>
              {blocked.map((entry) => (
                <PlayerRow
                  key={entry.pubkey}
                  entry={entry}
                  action="unblock"
                  onAction={(pubkey) => setPlayerBlocked(pubkey, false)}
                />
              ))}
            </SettingsSection>
          ) : null}

          {muted.length > 0 ? (
            <SettingsSection label="Muted" icon={<VolumeX />}>
              {muted.map((entry) => (
                <PlayerRow
                  key={entry.pubkey}
                  entry={entry}
                  action="unmute"
                  onAction={(pubkey) => setPlayerMuted(pubkey, false)}
                />
              ))}
            </SettingsSection>
          ) : null}
        </div>
      )}

      <p className="mt-4 text-xs text-island-ink-soft">
        Muting and blocking are saved on this device only. Someone who makes a brand-new account
        will look like a different player, so block them again if that happens.
      </p>
    </BlobbiModal>
  );
}
