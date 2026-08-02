/**
 * Treasure Hunt — the findings summary.
 *
 * Renders the pure `TreasureHuntResult` and nothing else. Deliberate wording:
 * no "Coins", no "added to inventory", no durable-reward implication — the
 * result is a summary of the hunt, and a special find is a "discovery" whose
 * future is somebody else's phase (Beach 2). Groups carry icons AND text, so
 * nothing relies on color alone.
 */

import { Button } from '@/components/ui/button';
import type { TreasureHuntResult, TreasureFindResult } from '@/beach/treasure-hunt';
import { findPresentation } from './treasure-hunt-config';

interface TreasureHuntResultsProps {
  result: TreasureHuntResult;
  onReturnToBeach: () => void;
  /** Restarts a completely fresh local simulation. */
  onPlayAgain: () => void;
}

function FindList({ finds, emptyLabel }: { finds: readonly TreasureFindResult[]; emptyLabel: string }) {
  if (finds.length === 0) {
    return <p className="text-sm blobbi-text-muted">{emptyLabel}</p>;
  }
  return (
    <ul className="flex flex-wrap gap-2">
      {finds.map((find) => {
        const presentation = findPresentation(find.kind);
        return (
          <li
            key={find.targetId}
            className="flex items-center gap-1.5 rounded-full border border-island-wood/30 bg-white/60 px-3 py-1 text-sm text-island-ink"
          >
            <span aria-hidden>{presentation.icon}</span>
            <span>{presentation.name}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function TreasureHuntResults({ result, onReturnToBeach, onPlayAgain }: TreasureHuntResultsProps) {
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto px-2 py-1" data-treasure-results>
      <h3 className="text-center text-lg font-bold text-island-ink">Findings Summary</h3>

      <p
        className="mx-auto max-w-md rounded-2xl bg-amber-100/80 px-4 py-1.5 text-center text-xs text-island-ink"
        data-treasure-practice-notice
      >
        Practice round — no Coins or items were awarded.
      </p>

      <section aria-labelledby="treasure-cleanup-heading" className="space-y-1.5">
        <h4 id="treasure-cleanup-heading" className="text-sm font-semibold text-island-ink">
          🧹 Beach cleaned
        </h4>
        <FindList finds={result.litterFinds} emptyLabel="No litter this time — the sand was already sparkling." />
      </section>

      <section aria-labelledby="treasure-found-heading" className="space-y-1.5">
        <h4 id="treasure-found-heading" className="text-sm font-semibold text-island-ink">
          💎 Treasures discovered
        </h4>
        <FindList finds={result.valuableFinds} emptyLabel="No treasures this time. The beach keeps its secrets!" />
      </section>

      {result.specialCandidateFound && (
        <section aria-labelledby="treasure-special-heading" className="space-y-1.5">
          <h4 id="treasure-special-heading" className="text-sm font-semibold text-island-ink">
            ✨ Special discovery
          </h4>
          <FindList finds={result.specialFinds} emptyLabel="" />
          <p className="text-xs blobbi-text-muted">
            Something unusual! One day the museum might want a look at this…
          </p>
        </section>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-2xl border border-island-wood/20 bg-white/40 p-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="blobbi-text-muted">Digs used</dt>
          <dd className="font-semibold text-island-ink">{result.shovelUsesSpent}</dd>
        </div>
        <div>
          <dt className="blobbi-text-muted">Missed digs</dt>
          <dd className="font-semibold text-island-ink">{result.missedDigs}</dd>
        </div>
        <div>
          <dt className="blobbi-text-muted">Hunt time</dt>
          <dd className="font-semibold text-island-ink">{Math.round(result.durationSeconds)}s</dd>
        </div>
        {/* Raw units, phrased as scores — deliberately not a currency. */}
        <div>
          <dt className="blobbi-text-muted">Cleanup score</dt>
          <dd className="font-semibold text-island-ink" data-treasure-cleanup-value>
            {result.rawCleanupValue}
          </dd>
        </div>
        <div>
          <dt className="blobbi-text-muted">Treasure score</dt>
          <dd className="font-semibold text-island-ink" data-treasure-value>
            {result.rawTreasureValue}
          </dd>
        </div>
      </dl>

      <div className="mt-auto flex flex-wrap items-center justify-center gap-2 pb-1">
        <Button
          type="button"
          onClick={onReturnToBeach}
          className="rounded-full min-h-[44px] px-6"
          data-treasure-return
        >
          Return to Beach
        </Button>
        <Button
          type="button"
          variant="outline"
          className="rounded-full min-h-[44px]"
          onClick={onPlayAgain}
        >
          Practice Again
        </Button>
      </div>
    </div>
  );
}
