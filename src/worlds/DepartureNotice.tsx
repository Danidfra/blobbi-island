/**
 * A small card over the world while the Blobbi is leaving for another one:
 * where it is going, and Stay (until the page has been asked to go; nothing
 * is signed or published before that moment). A navigation that did not
 * happen says so, with Try again: the Blobbi is back when nothing was
 * published, and has already `left` for the world when its move was (then
 * there is no OK or Stay that would seem to undo the trip, only Dismiss).
 */
import type { DeparturePhase } from './useWorldDeparture';
import type { World } from './worlds';
import { cn } from '@/lib/utils';

interface DepartureNoticeProps {
  phase: DeparturePhase;
  world: World;
  name: string;
  onStay: () => void;
  onRetry: () => void;
  /** The player's signer is being asked to let the Blobbi travel along (the page goes once it answers). */
  signing?: boolean;
  /** The Blobbi's move to the world was published: it has left, whether or not the world opened. */
  left?: boolean;
}

const BUTTON = 'min-h-9 rounded-full px-3.5 py-1.5 text-xs font-bold transition-transform duration-150 ease-cozy active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function DepartureNotice({ phase, world, name, onStay, onRetry, signing = false, left = false }: DepartureNoticeProps) {
  const failed = phase === 'failed';
  const text = failed
    ? left
      ? `${name} has left for ${world.name}, but it did not open.`
      : `${world.name} did not open. ${name} is back.`
    : phase === 'gone'
      ? signing
        ? `Approve the trip in your signer so ${name} comes along…`
        : `Opening ${world.name}…`
      : `${name} is off to ${world.name}…`;
  return (
    <div
      className={cn(
        'pointer-events-auto flex w-[min(calc(100%-1.5rem),24rem)] items-center gap-2.5 rounded-2xl border bg-island-cream px-3 py-2 text-island-ink',
        'shadow-[inset_0_1px_0_hsl(0_0%_100%/0.55),0_8px_20px_-12px_hsl(var(--island-ink)/0.55)]',
        failed ? 'border-island-danger/50' : 'border-island-wood/40',
      )}
      role={failed ? 'alert' : 'status'}
      aria-live="polite"
      data-testid="departure-notice"
      data-phase={phase}
      data-signing={signing ? 'true' : undefined}
      data-left={left ? 'true' : undefined}
      data-world-travel="ignore"
    >
      <span className="size-8 shrink-0 rounded-full" style={{ background: `linear-gradient(135deg, ${world.colors[0]}, ${world.colors[1]})` }} aria-hidden />
      <p className="min-w-0 flex-1 text-sm font-semibold">{text}</p>
      <span className="flex shrink-0 gap-1.5">
        {failed && (
          <button type="button" className={cn(BUTTON, 'bg-island-ocean text-white')} onClick={onRetry} data-testid="departure-retry">
            Try again
          </button>
        )}
        {failed && left ? (
          <button type="button" className={cn(BUTTON, 'bg-island-ink/10')} onClick={onStay} data-testid="departure-dismiss">
            Dismiss
          </button>
        ) : phase !== 'gone' ? (
          <button type="button" className={cn(BUTTON, 'bg-island-ink/10')} onClick={onStay} data-testid="departure-stay">
            {failed ? 'OK' : 'Stay'}
          </button>
        ) : null}
      </span>
    </div>
  );
}
