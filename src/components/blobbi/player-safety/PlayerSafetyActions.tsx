/**
 * Mute, Block and Report for one player, the row inside their card.
 *
 * ## Why it lives here and looks like this
 *
 * The player's card is already the place you end up when you tap someone's
 * Blobbi, so it is where "and I would like them to stop" belongs. Putting these
 * on the world itself would mean a safety control one mis-tap away during
 * ordinary play; putting them behind a settings screen would mean hunting for
 * them while the thing you want to stop is still happening.
 *
 * They sit in the card's footer, visually quiet, a soft chip and two text
 * buttons: because most of the time you opened the card to look at a Blobbi.
 * Quiet is not the same as hidden: they are always present, always in the same
 * place, and reachable in one tap from the person who is bothering you.
 *
 * ## The asymmetry between Mute and Block is deliberate
 *
 * Mute acts immediately with no confirmation. It is small, obviously reversible,
 * and the button relabels itself to Unmute, a dialog asking "are you sure you
 * want to stop reading this?" is friction charged to the person being bothered.
 *
 * Block confirms, because it removes a player from the world entirely and the
 * confirmation is also where the honest description of what it does belongs.
 *
 * ## Everything here stays inside the game window
 *
 * These are opened from a player's card, which is an in-world surface
 * (`BlobbiInfoModal` is `presentation="in-frame"`). A confirmation that floats
 * over the whole browser instead, dimming the page around the cozy frame,
 * reads as "the website opened a dialog" rather than "the game asked you
 * something", and on a windowed or short viewport it can end up positioned
 * against the browser rather than the stage it belongs to. So both layers this
 * file opens are `in-frame` too: the island's existing frame-aware portal, not
 * a second positioning scheme invented here.
 *
 * ## The row owns its own width
 *
 * It is handed to `BlobbiModal`'s footer, which lays its children out as flex
 * items: and a flex item is shrinkable by default. Left to that, this row
 * collapses toward its content width and squeezes the three buttons inside it
 * until the labels no longer fit their pills. `flex-1` makes it claim the
 * footer row instead, and `shrink-0` on each button means the labels set the
 * minimum rather than being the first thing sacrificed.
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
    // Stacked and full-width on a narrow frame, a single row once there is room
    // for one. `flex-1` claims the footer row (see the note above); `min-w-0`
    // keeps that claim from forcing the footer wider than the window.
    <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-1 sm:flex-row sm:flex-wrap sm:items-center">
      <Button
        variant="soft"
        size="sm"
        onClick={toggleMute}
        aria-pressed={relationship.muted}
        className="min-h-[2.75rem] w-full shrink-0 justify-center sm:w-auto sm:min-w-[6.5rem]"
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
        className="min-h-[2.75rem] w-full shrink-0 justify-center sm:w-auto sm:min-w-[6.5rem]"
      >
        <ShieldOff className="mr-1.5 size-4" aria-hidden="true" />
        Block
      </Button>

      <Button
        variant="soft"
        size="sm"
        onClick={() => setReporting(true)}
        className="min-h-[2.75rem] w-full shrink-0 justify-center sm:w-auto sm:min-w-[6.5rem]"
      >
        <Flag className="mr-1.5 size-4" aria-hidden="true" />
        Report
      </Button>

      {failed ? (
        <p role="alert" className="w-full basis-full text-xs font-semibold text-island-danger">
          That could not be saved on this device. Try again, or check your browser settings.
        </p>
      ) : null}

      <BlobbiModal
        open={confirmingBlock}
        onOpenChange={setConfirmingBlock}
        title="Block this player?"
        description={playerShortId(pubkey)}
        icon={<ShieldOff />}
        presentation="in-frame"
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
