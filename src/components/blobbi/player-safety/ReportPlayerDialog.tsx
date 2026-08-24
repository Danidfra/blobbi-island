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
 * changes; until then it stays honest — see `docs/player-safety-controls.md`.
 *
 * ## Report and Block are separate, and the pairing is explicit
 *
 * Reporting does not silently block. It is a real decision with a real effect,
 * and a control that quietly does a second thing is a control the player cannot
 * reason about. The pairing children actually want is offered as its own button
 * ("Report and block") so both actions are chosen, once each.
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
      evidence: evidence
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

    storeReport(built.report);
    // Blocking is local and immediate; it never waits on the report.
    const blocked = alsoBlock ? setPlayerBlocked(pubkey, true) : false;

    setCategory(null);
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
          setError(null);
        }
        onOpenChange(next);
      }}
      title="Report a player"
      description={`About ${playerShortId(pubkey)}`}
      icon={<Flag />}
      size="sm"
      footer={
        <>
          <Button variant="soft" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="soft" onClick={() => file(true)} disabled={!category}>
            <ShieldOff className="mr-1.5 size-4" aria-hidden="true" />
            Report and block
          </Button>
          <Button variant="playful" onClick={() => file(false)} disabled={!category}>
            Send report
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
        <div className="mt-3 rounded-xl border border-island-wood/25 bg-island-cream/60 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-island-ink-soft">
            The last thing they said
          </p>
          <p className="mt-1 break-words text-sm text-island-ink" data-testid="report-evidence">
            {evidence.renderedText}
          </p>
          <p className="mt-1.5 text-xs text-island-ink-soft">
            This is saved with your report, because messages disappear after a few seconds.
          </p>
        </div>
      ) : (
        <p className="mt-3 text-xs text-island-ink-soft">
          They have not said anything recently, so this report is about the player.
        </p>
      )}

      {/* Honest, and deliberately not reassuring: nothing reads these yet. */}
      <p className="mt-3 text-xs text-island-ink-soft">
        Reports are saved on this device. Nobody reviews them yet, so if someone is bothering you,
        block them too and tell a grown-up you trust.
      </p>

      {error ? (
        <p role="alert" className="mt-2 text-sm font-semibold text-island-danger">
          {error}
        </p>
      ) : null}
    </BlobbiModal>
  );
}
