import { cn } from '@/lib/utils';
import type { ArcadeGameResult } from '@/arcade/types';
import { HOCKEY_AI_PROFILES, type HockeyDifficulty } from '@/arcade/hockey/ai';
import {
  HOCKEY_STAT_KEYS,
  formatMatchDuration,
  type AirHockeyMatchResult,
} from '@/arcade/hockey/hockey-result';

/**
 * The result of one match.
 *
 * ## Why there is no ticket panel
 *
 * Blobbi Dance's results screen is mostly a reward: a breakdown, a claim button
 * and a publish state. Air Hockey has none of that, on purpose — it grants no
 * Arcade Tickets in this phase, so a screen that showed a reward section, even
 * an empty or a disabled one, would be advertising something that does not
 * exist.
 *
 * What it shows instead is the match: who won, by how much, how long it took,
 * and a handful of numbers worth being pleased about. When a reward policy is
 * approved, it slots in beside this rather than replacing it — the result object
 * it would read is already the one being rendered here.
 *
 * ## Non-colour signalling
 *
 * The outcome is stated as a WORD ("You win" / "Rival wins"), backed by the
 * scoreline and by an icon. The tint is the last of four signals, not the only
 * one, so the screen reads correctly in greyscale and to a screen reader.
 */

interface AirHockeyResultsProps {
  readonly summary: AirHockeyMatchResult;
  /** The arcade-contract result. Rendered only for the DEV harness. */
  readonly result: ArcadeGameResult;
  readonly showDebugDetails?: boolean;
}

export function AirHockeyResults({
  summary,
  result,
  showDebugDetails = false,
}: AirHockeyResultsProps) {
  const won = summary.outcome === 'win';
  const profile = HOCKEY_AI_PROFILES[summary.difficulty as HockeyDifficulty];

  return (
    <div data-hockey-results className="mx-auto flex max-w-md flex-col gap-3 pb-2">
      <div
        data-hockey-outcome={summary.outcome}
        className={cn(
          'overflow-hidden rounded-2xl border-2 px-4 py-4 text-center shadow-[0_4px_0_rgba(140,98,57,0.25)]',
          won
            ? 'border-island-purple/50 bg-gradient-to-b from-island-purple/15 to-island-cream-2'
            : 'border-island-wood/40 bg-gradient-to-b from-island-cream-2 to-island-sand',
        )}
      >
        <p aria-hidden className="text-4xl leading-none">
          {won ? '🏆' : '💪'}
        </p>
        <h3 className="mt-1 text-2xl font-black uppercase tracking-[0.14em] text-island-wood-dark">
          {won ? 'You win' : 'Rival wins'}
        </h3>

        {/* The scoreline, labelled on both sides so it never depends on which
            number happens to be on the left. */}
        <p className="mt-2 flex items-end justify-center gap-3 font-mono">
          <span className="flex flex-col items-center">
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-island-ink-soft">
              You
            </span>
            <span className="text-4xl font-black leading-none text-island-purple">
              {summary.playerScore}
            </span>
          </span>
          <span className="pb-1 text-2xl font-black text-island-ink-soft">–</span>
          <span className="flex flex-col items-center">
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-island-ink-soft">
              Rival
            </span>
            <span className="text-4xl font-black leading-none text-amber-600">
              {summary.opponentScore}
            </span>
          </span>
        </p>

        <p className="mt-2 text-xs blobbi-text-muted">
          {profile?.label ?? summary.difficulty} opponent &middot; first to {summary.targetGoals}{' '}
          &middot; {formatMatchDuration(summary.durationMs)}
        </p>
      </div>

      <dl
        data-hockey-stats
        className="grid grid-cols-2 gap-2 rounded-2xl border-2 border-island-wood/25 bg-island-cream/60 p-3 sm:grid-cols-4"
      >
        <Stat label="Margin" value={formatMargin(summary.scoreDifference)} />
        <Stat label="Your hits" value={String(summary.stats.playerHits)} />
        <Stat label="Rebounds" value={String(summary.stats.wallBounces)} />
        <Stat label="Top speed" value={String(Math.round(summary.stats.topPuckSpeed))} />
      </dl>

      <p className="rounded-2xl border-2 border-island-wood/25 p-3 text-xs blobbi-text-muted">
        {won
          ? 'Nicely done. Try the match again on a tougher opponent.'
          : 'Close the angle with your mallet before the puck reaches your goal — sitting on the line lets it in.'}
      </p>

      {showDebugDetails && (
        <pre
          data-hockey-debug
          className="overflow-x-auto rounded-xl bg-island-ink/90 p-3 text-left font-mono text-[10px] leading-relaxed text-island-cream"
        >
          {JSON.stringify(
            {
              runId: result.runId,
              gameId: result.gameId,
              machineId: result.machineId,
              cleared: result.cleared,
              score: result.score,
              won: result.stats[HOCKEY_STAT_KEYS.won],
              difference: result.stats[HOCKEY_STAT_KEYS.goalDifference],
            },
            null,
            2,
          )}
        </pre>
      )}
    </div>
  );
}

function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="text-center">
      <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-island-ink-soft">
        {label}
      </dt>
      <dd className="font-mono text-lg font-black leading-tight text-island-ink">{value}</dd>
    </div>
  );
}

/** `+3`, `-2`, or `0`. The sign is the information, so it is always shown. */
function formatMargin(difference: number): string {
  if (difference > 0) return `+${difference}`;
  return String(difference);
}
