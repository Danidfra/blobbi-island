import { cn } from '@/lib/utils';

import type { HockeyOrientation } from './hockey-draw';

/**
 * Lay the table out the long way, or the tall way.
 *
 * ## Why this control exists at all
 *
 * The renderer picks a layout from the shape of the box it is given, and that
 * answer is right almost always, a wide window gets a wide table. "Almost" is
 * the reason for the button: an arcade window on a tall, narrow desktop browser,
 * or a player who simply reads a vertical table better, both want the other one.
 * A measurement that is usually right and never overridable is a worse control
 * than a measurement with an override.
 *
 * It is deliberately NOT offered during expanded play on a phone. There the
 * layout is not a preference; it is which way the player is holding the
 * device: and a button that fights the next rotation would be an annoyance
 * rather than a choice. See `AirHockeyTable`.
 *
 * ## Why it is not an icon on its own
 *
 * The two states are a wide rectangle and a tall one, which is exactly the kind
 * of distinction an icon renders at 16 px and nobody can read. So the button
 * carries a WORD, "Wide" or "Tall", describing the layout currently in force,
 * with the shape beside it as reinforcement. The accessible name names the
 * ACTION instead ("Lay the table out tall"), because that is what pressing it
 * does; a name that matched the visible word would announce the state twice and
 * the action never.
 */

interface HockeyOrientationToggleProps {
  /** The layout currently in force, whether chosen or measured. */
  readonly orientation: HockeyOrientation;
  readonly onChoose: (orientation: HockeyOrientation) => void;
  readonly className?: string;
}

export function HockeyOrientationToggle({
  orientation,
  onChoose,
  className,
}: HockeyOrientationToggleProps) {
  const next: HockeyOrientation = orientation === 'landscape' ? 'portrait' : 'landscape';

  return (
    <button
      type="button"
      data-hockey-orientation-toggle={orientation}
      aria-label={next === 'portrait' ? 'Lay the table out tall' : 'Lay the table out wide'}
      // The table is a pointer surface: pressing this must move the layout,
      // never the mallet.
      onPointerDown={(event) => event.stopPropagation()}
      onClick={() => onChoose(next)}
      className={cn(
        'flex h-9 items-center gap-1.5 rounded-full border-2 px-2.5',
        'border-white/25 bg-black/40 text-white backdrop-blur-[2px]',
        'text-[11px] font-bold uppercase tracking-wider',
        'hover:bg-black/55 active:scale-95',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'block shrink-0 rounded-[2px] border-2 border-current',
          orientation === 'landscape' ? 'h-2.5 w-4' : 'h-4 w-2.5',
        )}
      />
      <span aria-hidden>{orientation === 'landscape' ? 'Wide' : 'Tall'}</span>
    </button>
  );
}
