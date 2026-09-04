/**
 * The report flow: pick what happened, optionally attach what they said, send.
 *
 * ## It tells the truth about where the report goes
 *
 * Nothing consumes reports today. There is no moderation team, no relay-side
 * queue, no reviewer. So the dialog says the report is saved on this device and
 * does not claim anyone will read it.
 *
 * That copy is load-bearing rather than cautious. "Our team will review this" is
 * the sentence a distressed child would take at face value, and telling it to
 * them at the moment they most need to be told the truth is the worst possible
 * time to be optimistic about a roadmap. When a destination exists this copy
 * changes; until then it stays honest; see `docs/player-safety-controls.md`.
 *
 * ## Report and Block are separate, and the pairing is explicit
 *
 * Reporting does not silently block. It is a real decision with a real effect,
 * and a control that quietly does a second thing is a control the player cannot
 * reason about. The pairing children actually want is offered as its own button
 * ("Report and block") so both actions are chosen, once each.
 *
 * ## It opens inside the game window
 *
 * Reporting starts from a player's card, which is an in-world surface, so this
 * is `in-frame`: sized and positioned against the STAGE rather than the browser
 * viewport, which is what keeps it inside the wood frame on a windowed desktop
 * and on a short viewport. `BlobbiModal` caps an in-frame window's height at
 * the stage and scrolls its body, so a long category list on a small frame
 * scrolls INSIDE the window rather than growing past it.
 *
 * `md` rather than `sm` because the footer carries three actions, one of them
 * two words long. At `sm` on a small stage they have nowhere to go but into
 * each other.
 */

import { useMemo, useState } from 'react';
import { Flag, ShieldOff } from 'lucide-react';

import { BlobbiModal } from '@/components/ui/blobbi-modal';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  REPORT_CATEGORIES,
  buildPlayerReport,
  recentMessageFrom,
  setPlayerBlocked,
  storeReport,
  type ReportCategory,
} from '@/player-safety';

import { playerShortId } from './player-label';

interface ReportPlayerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pubkey: string;
  islandId: string;
  location: string;
  /** The reporter, when signed in. Recorded locally; never published. */
  reporterPubkey?: string | null;
  /** Called after a report is filed, so the caller can close the player card. */
  onFiled?: (outcome: { blocked: boolean }) => void;
}

export function ReportPlayerDialog({
  open,
  onOpenChange,
  pubkey,
  islandId,
  location,
  reporterPubkey,
  onFiled,
}: ReportPlayerDialogProps) {
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [error, setError] = useState<string | null>(null);
  /*
    ATTACHING THE MESSAGE IS A CHOICE, and it starts unmade.

    Opening a card and pressing Report used to attach whatever the player had
    last said, automatically: so a report about someone standing too close
    quietly saved a sentence they wrote about something else. The reporter is
    the one who knows whether the message is the point.

    It also keeps the free-text path deliberate: a rendered message is the only
    unbounded, attacker-authored string a report can hold, and it is now only
    held when somebody asked for it.
  */
  const [includeMessage, setIncludeMessage] = useState(false);

  // Read once per opening: the buffer is memory-only and its contents can be
  // evicted while the dialog is open.
  const evidence = useMemo(() => (open ? recentMessageFrom(pubkey) : null), [open, pubkey]);

  const file = (alsoBlock: boolean) => {
    if (!category) {
      setError('Choose what happened first.');
      return;
    }

    const built = buildPlayerReport({
      reportedPubkey: pubkey,
      reporterPubkey,
      category,
      islandId,
      location,
      evidence:
        evidence && includeMessage
          ? {
              sourceEvent: evidence.event,
              messageClass: evidence.messageClass,
              renderedText: evidence.renderedText,
            }
          : null,
    });

    if (!built.ok) {
      setError('Something went wrong saving that report.');
      return;
    }

    /*
      TWO ACTIONS, ATTEMPTED INDEPENDENTLY, REPORTED HONESTLY.

      They fail for different reasons and they matter differently. Blocking is
      the one that actually protects the player, so it is never skipped because
      the report could not be saved, and the report failing is never hidden
      because the block worked.

      Both writers read back what they wrote, so `false` here means the decision
      is genuinely not on this device, not merely that `setItem` did not throw.
    */
    const saved = storeReport(built.report);
    const blocked = alsoBlock ? setPlayerBlocked(pubkey, true) : false;

    if (!saved && alsoBlock && blocked) {
      setError("They're blocked, but we couldn't save the report on this device.");
      onFiled?.({ blocked });
      return;
    }
    if (!saved) {
      setError("We couldn't save that report on this device. Try again, or check your browser settings.");
      return;
    }
    if (alsoBlock && !blocked) {
      setError("Report saved, but we couldn't block them on this device. Try Block again.");
      return;
    }

    setCategory(null);
    setIncludeMessage(false);
    setError(null);
    onOpenChange(false);
    onFiled?.({ blocked });
  };

  return (
    <BlobbiModal
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setCategory(null);
          setIncludeMessage(false);
          setError(null);
        }
        onOpenChange(next);
      }}
      title="Report a player"
      description={`About ${playerShortId(pubkey)}`}
      icon={<Flag />}
      presentation="in-frame"
      size="md"
      footer={
        <>
          <Button variant="soft" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="soft" onClick={() => file(true)} disabled={!category}>
            <ShieldOff className="mr-1.5 size-4" aria-hidden="true" />
            Save and block
          </Button>
          {/* "Save", never "Send": nothing leaves this device, and a child who
              reads "Sent" reasonably believes somebody is now looking. */}
          <Button variant="playful" onClick={() => file(false)} disabled={!category}>
            Save report
          </Button>
        </>
      }
    >
      <fieldset className="space-y-2">
        <legend className="px-1 pb-1 text-sm font-semibold text-island-ink">
          What happened?
        </legend>
        {REPORT_CATEGORIES.map((entry) => {
          const selected = category === entry.id;
          return (
            <label
              key={entry.id}
              className={cn(
                'flex min-h-[3rem] cursor-pointer items-start gap-3 rounded-xl border p-3',
                'transition-colors duration-150 ease-cozy',
                'focus-within:ring-2 focus-within:ring-ring',
                selected
                  ? 'border-island-ocean bg-island-cream'
                  : 'border-island-wood/25 bg-island-cream/60 hover:bg-island-cream',
              )}
            >
              <input
                type="radio"
                name="report-category"
                value={entry.id}
                checked={selected}
                onChange={() => {
                  setCategory(entry.id);
                  setError(null);
                }}
                className="mt-0.5 size-4 accent-island-ocean"
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-island-ink">{entry.label}</span>
                <span className="block text-xs text-island-ink-soft">{entry.description}</span>
              </span>
            </label>
          );
        })}
      </fieldset>

      {evidence ? (
        <label
          className={cn(
            'mt-3 flex cursor-pointer items-start gap-3 rounded-xl border p-3',
            'transition-colors duration-150 ease-cozy focus-within:ring-2 focus-within:ring-ring',
            includeMessage
              ? 'border-island-ocean bg-island-cream'
              : 'border-island-wood/25 bg-island-cream/60 hover:bg-island-cream',
          )}
        >
          <input
            type="checkbox"
            checked={includeMessage}
            onChange={(event) => setIncludeMessage(event.target.checked)}
            className="mt-0.5 size-4 accent-island-ocean"
            data-testid="report-include-message"
          />
          <span className="min-w-0">
            <span className="block text-xs font-semibold uppercase tracking-wide text-island-ink-soft">
              Include the last thing they said
            </span>
            <span
              className="mt-1 block break-words text-sm text-island-ink"
              data-testid="report-evidence"
            >
              {evidence.renderedText}
            </span>
            <span className="mt-1.5 block text-xs text-island-ink-soft">
              Messages disappear after a few seconds, so this is the only way to keep it.
            </span>
          </span>
        </label>
      ) : (
        <p className="mt-3 text-xs text-island-ink-soft">
          They have not said anything recently, so this report is about the player.
        </p>
      )}

      {/* Honest, and deliberately not reassuring: nothing reads these yet. */}
      <p className="mt-3 text-xs text-island-ink-soft">
        Reports are saved on this device and are not sent anywhere. Nobody reviews them yet, so if
        someone is bothering you, block them too and tell a grown-up you trust.
      </p>

      {error ? (
        <p role="alert" className="mt-2 text-sm font-semibold text-island-danger">
          {error}
        </p>
      ) : null}
    </BlobbiModal>
  );
}
