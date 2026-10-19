/**
 * The worlds a Blobbi can travel to, as cards in an Island window. An open
 * world is a button that starts the departure (the page goes only once the
 * Blobbi has left); a world that is not open is a card labelled so, never a
 * link. What travels: nothing. The other app asks for its own sign-in.
 *
 * With a policy that keeps players inside the Island (`externalLinks` off),
 * every door is shown closed: the egress boundary would refuse the trip, and
 * a door that cannot open is said so here rather than found out later.
 */
import { Globe2, Lock } from 'lucide-react';

import { BlobbiModal } from '@/components/ui/blobbi-modal';
import { cn } from '@/lib/utils';

import type { OpenWorld } from './worlds';

export interface WorldsModalProps {
  open: boolean;
  onClose: () => void;
  /** The Blobbi's name, for the words. */
  name: string;
  worlds: readonly OpenWorld[];
  /** The policy lets the player leave the Island. */
  canLeave: boolean;
  /** A departure is under way: no door opens a second one until it ends (or Stay ends it). */
  departing: boolean;
  onTravel: (world: OpenWorld) => void;
}

export function WorldsModal({ open, onClose, name, worlds, canLeave, departing, onTravel }: WorldsModalProps) {
  return (
    <BlobbiModal
      open={open}
      onOpenChange={(next) => !next && onClose()}
      presentation="in-frame"
      size="md"
      title="Worlds"
      description={`Where will ${name} go today?`}
      icon={<Globe2 />}
    >
      <ul className="flex flex-col gap-2.5" data-testid="worlds-list" data-world-travel="ignore">
        {worlds.map((w) => {
          const openDoor = w.open && canLeave;
          const badge = openDoor ? 'Visit' : w.open ? 'Not available' : 'Coming soon';
          const body = (
            <>
              <span
                className="grid size-12 shrink-0 place-items-center rounded-2xl text-2xl shadow-[inset_0_-5px_0_hsl(0_0%_0%/0.06)]"
                style={{ background: `linear-gradient(135deg, ${w.colors[0]}, ${w.colors[1]})` }}
                aria-hidden
              >
                {openDoor ? w.emoji : <Lock className="size-5 text-island-ink/70" />}
              </span>
              <span className="flex min-w-0 flex-1 flex-col text-left">
                <span className="font-bold text-island-ink">{w.name}</span>
                <span className="text-xs text-island-ink-soft">{w.tagline}</span>
              </span>
              <span
                className={cn(
                  'shrink-0 rounded-full px-2.5 py-1 text-[0.72rem] font-bold',
                  openDoor ? 'bg-island-ocean text-white' : 'bg-island-ink/10 text-island-ink-soft',
                )}
              >
                {badge}
              </span>
            </>
          );
          const card = cn(
            'flex w-full items-center gap-3 rounded-2xl border border-island-wood/30 bg-island-cream px-3 py-2.5',
            'shadow-[0_2px_0_hsl(var(--island-ink)/0.06)]',
          );
          return (
            <li key={w.id}>
              {openDoor ? (
                <button
                  type="button"
                  className={cn(card, 'transition-transform duration-150 ease-cozy hover:scale-[1.01] active:scale-[0.98] disabled:cursor-progress disabled:opacity-70 disabled:hover:scale-100', 'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring')}
                  onClick={() => onTravel(w)}
                  disabled={departing}
                  aria-busy={departing || undefined}
                  data-testid={`world-${w.id}`}
                  data-open="true"
                  aria-label={`Visit ${w.name}. ${w.tagline}`}
                >
                  {body}
                </button>
              ) : (
                <div className={cn(card, 'opacity-75')} data-testid={`world-${w.id}`} data-open="false" aria-label={`${w.name}, ${badge.toLowerCase()}`}>
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-center text-xs text-island-ink-soft" data-testid="worlds-note">
        {canLeave
          ? 'Each world is its own app. Your key never travels: the other world asks you to sign in there, the way you signed in here.'
          : 'Leaving the Island is turned off for this experience, so the doors stay closed for now.'}
      </p>
    </BlobbiModal>
  );
}
