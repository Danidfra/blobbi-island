/**
 * Mute, Block and Report for one player — the row inside their card.
 *
 * ## Why it lives here and looks like this
 *
 * The player's card is already the place you end up when you tap someone's
 * Blobbi, so it is where "and I would like them to stop" belongs. Putting these
 * on the world itself would mean a safety control one mis-tap away during
 * ordinary play; putting them behind a settings screen would mean hunting for
 * them while the thing you want to stop is still happening.
 *
 * They sit in the card's footer, visually quiet — a soft chip and two text
 * buttons — because most of the time you opened the card to look at a Blobbi.
 * Quiet is not the same as hidden: they are always present, always in the same
 * place, and reachable in one tap from the person who is bothering you.
 *
 * ## The asymmetry between Mute and Block is deliberate
 *
 * Mute acts immediately with no confirmation. It is small, obviously reversible,
 * and the button relabels itself to Unmute — a dialog asking "are you sure you
 * want to stop reading this?" is friction charged to the person being bothered.
 *
 * Block confirms, because it removes a player from the world entirely and the
 * confirmation is also where the honest description of what it does belongs.
 */

import { useState } from 'react';
import { Flag, ShieldOff, Volume2, VolumeX } from 'lucide-react';

import { BlobbiModal } from '@/components/ui/blobbi-modal';
import { Button } from '@/components/ui/button';
import {
  setPlayerBlocked,
  setPlayerMuted,
  usePlayerRelationship,
} from '@/player-safety';

import { ReportPlayerDialog } from './ReportPlayerDialog';
import { playerShortId } from './player-label';

interface PlayerSafetyActionsProps {
  pubkey: string;
  islandId: string;
  location: string;
  reporterPubkey?: string | null;
  /**
   * Called once the player has been blocked, so the surrounding card can close.
   * A card left open onto someone who is no longer in the world is exactly the
   * stale interaction Block is supposed to remove.
   */
  onBlocked?: () => void;
}

export function PlayerSafetyActions({
  pubkey,
  islandId,
  location,
  reporterPubkey,
  onBlocked,
}: PlayerSafetyActionsProps) {
  const relationship = usePlayerRelationship(pubkey);
  const [confirmingBlock, setConfirmingBlock] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [failed, setFailed] = useState(false);

  const toggleMute = () => {
    const ok = setPlayerMuted(pubkey, !relationship.muted);
    setFailed(!ok);
  };

  const confirmBlock = () => {
    const ok = setPlayerBlocked(pubkey, true);
    setConfirmingBlock(false);
    if (!ok) {
      setFailed(true);
      return;
    }
    onBlocked?.();
  };

  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <Button
        variant="soft"
        size="sm"
        onClick={toggleMute}
        aria-pressed={relationship.muted}
        className="min-h-[2.5rem]"
      >
        {relationship.muted ? (
          <>
            <Volume2 className="mr-1.5 size-4" aria-hidden="true" />
            Unmute
          </>
        ) : (
          <>
            <VolumeX className="mr-1.5 size-4" aria-hidden="true" />
            Mute
          </>
        )}
      </Button>

      <Button
        variant="soft"
        size="sm"
        onClick={() => setConfirmingBlock(true)}
        className="min-h-[2.5rem]"
      >
        <ShieldOff className="mr-1.5 size-4" aria-hidden="true" />
        Block
      </Button>

      <Button
        variant="soft"
        size="sm"
        onClick={() => setReporting(true)}
        className="min-h-[2.5rem]"
      >
        <Flag className="mr-1.5 size-4" aria-hidden="true" />
        Report
      </Button>

      {failed ? (
        <p role="alert" className="w-full text-xs font-semibold text-island-danger">
          That could not be saved on this device. Try again, or check your browser settings.
        </p>
      ) : null}

      <BlobbiModal
        open={confirmingBlock}
        onOpenChange={setConfirmingBlock}
        title="Block this player?"
        description={playerShortId(pubkey)}
        icon={<ShieldOff />}
        size="sm"
        footer={
          <>
            <Button variant="soft" onClick={() => setConfirmingBlock(false)}>
              Cancel
            </Button>
            {/* The destructive-looking action is also the clearly-labelled one:
                colour alone never carries the difference. */}
            <Button variant="destructive" onClick={confirmBlock}>
              Block player
            </Button>
          </>
        }
      >
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-island-ink">
          <li>You will not see them on the island any more.</li>
          <li>You will not see anything they say.</li>
          <li>You can undo this in Settings › Safety.</li>
        </ul>
        {/*
          The honest limit, stated rather than glossed. Blocking is local
          perception filtering: this client stops showing them and stops sending
          intentional interactions their way, but their client keeps receiving
          the public presence every player publishes. Claiming otherwise would be
          claiming privacy the architecture does not provide.
        */}
        <p className="mt-3 text-xs text-island-ink-soft">
          Blocking hides them from you. It does not hide you from them, and it does not remove them
          from the island for other players.
        </p>
      </BlobbiModal>

      <ReportPlayerDialog
        open={reporting}
        onOpenChange={setReporting}
        pubkey={pubkey}
        islandId={islandId}
        location={location}
        reporterPubkey={reporterPubkey}
        onFiled={({ blocked }) => {
          if (blocked) onBlocked?.();
        }}
      />
    </div>
  );
}
