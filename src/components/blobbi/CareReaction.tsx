/**
 * The in-world moment after a Blobbi is fed (or played with, cleaned, dosed).
 *
 * ```
 *          ┌──────────────────┐
 *          │   +25 Hunger  ♥  │   ← rises off the Blobbi, fades
 *          │  From Nostr Farm │   ← a beat later, only for another game's item
 *          └──────────────────┘
 *               (Blobbi)          ← one squash-and-stretch bounce
 * ```
 *
 * Composed from what already exists: the reaction is a CSS keyframe on the
 * stage's Blobbi wrapper (`animate-care-bounce`), the readout is a floating
 * status chip (`animate-care-float`), and the numbers are the REAL applied
 * deltas carried on the consumption result, never a constant. Reduced
 * motion keeps the information (the chips appear and go) and drops the
 * motion (no bounce, no float).
 *
 * ## One action, one reaction
 *
 * {@link useCareReaction} keys everything on the feedback's `id`, which is
 * the spend id for an external consumption and a fresh id for an Island one.
 * Showing the same id twice is a no-op, so an optimistic refresh, a
 * re-render or a repeated callback for one logical action cannot replay it;
 * a new id replaces whatever is still on screen.
 *
 * Presentation only. Nothing here decides success: the surface calls `show`
 * from the consumption mutation's success callback, and only when the
 * result says the effect was applied in that action.
 *
 * The state lives in `useCareReaction.ts`; this file is the readout.
 */

import { Sprout } from 'lucide-react';

import { useReducedMotion } from '@/hooks/useReducedMotion';
import { provenanceCue, statGains, type CareFeedback } from '@/inventory';
import { cn } from '@/lib/utils';

import { CARE_STAT_ICONS } from './care-stat-icons';

interface CareReactionOverlayProps {
  feedback: CareFeedback | null;
  /** Position within the stage. Defaults to just above the Blobbi's head. */
  className?: string;
}

/**
 * The floating readout. Absolutely positioned inside a `relative` stage;
 * pointer-transparent so it can never block a tap on the Blobbi.
 */
export function CareReactionOverlay({ feedback, className }: CareReactionOverlayProps) {
  const reducedMotion = useReducedMotion();
  if (!feedback) return null;

  const gains = statGains(feedback.statDeltas);
  const cue = provenanceCue(feedback);
  const float = reducedMotion ? '' : 'animate-care-float';

  return (
    <div
      key={feedback.id}
      role="status"
      aria-live="polite"
      data-testid="care-reaction"
      data-care-reaction-id={feedback.id}
      data-care-provenance={feedback.provenance ?? undefined}
      className={cn(
        'pointer-events-none absolute inset-x-0 top-[10%] z-20 flex flex-col items-center gap-1',
        className,
      )}
    >
      {gains.map((gain, index) => {
        const Icon = CARE_STAT_ICONS[gain.stat];
        return (
          <span
            key={gain.stat}
            data-care-gain={gain.stat}
            style={reducedMotion ? undefined : { animationDelay: `${index * 120}ms` }}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border border-island-cream bg-island-purple px-2.5 py-1',
              'text-sm font-bold tabular-nums text-island-cream shadow-cozy-soft',
              float,
            )}
          >
            <Icon aria-hidden className="size-3.5 shrink-0" />
            {gain.text}
          </span>
        );
      })}
      {cue ? (
        <span
          data-care-provenance-cue
          style={reducedMotion ? undefined : { animationDelay: `${gains.length * 120 + 220}ms` }}
          className={cn(
            'inline-flex items-center gap-1 rounded-full border border-island-cream bg-island-grass-dark px-2 py-0.5',
            'text-[0.6875rem] font-semibold text-island-cream shadow-cozy-soft',
            float,
          )}
        >
          <Sprout aria-hidden className="size-3 shrink-0" />
          {cue}
        </span>
      ) : null}
    </div>
  );
}
