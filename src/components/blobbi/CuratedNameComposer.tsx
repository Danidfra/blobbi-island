/**
 * Naming a Blobbi from approved words.
 *
 * ## Affirmative, not disabled
 *
 * A greyed-out text field with an explanation underneath is a worse experience
 * than a chooser, and it invites copy nobody should have to write. Two
 * dropdowns and a name that assembles itself as you change them is a nicer way
 * to name a pet than typing into a box, the restriction happens to be the
 * feature.
 *
 * ## Native `<select>`, on purpose
 *
 * The same reasoning as the theater's phrase builder: it is the best touch
 * control on every phone with no work, it is keyboard- and screen-reader-correct
 * by default, and it renders in place rather than through a portal, which
 * matters because the ceremony runs inside the island's own frame.
 *
 * ## This is not the boundary
 *
 * `admitOwnBlobbiName` is, at the adoption writer. This component is how a
 * player produces something that passes it.
 */

import { useMemo } from 'react';

import {
  CURATED_ADJECTIVES,
  CURATED_NOUNS,
  composeCuratedName,
} from '@/blobbi-names';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface CuratedNameComposerProps {
  adjective: string;
  noun: string;
  onAdjectiveChange: (value: string) => void;
  onNounChange: (value: string) => void;
  onSubmit: () => void;
  submitting?: boolean;
  submitLabel: string;
}

const SELECT_CLASS = cn(
  'min-h-[2.75rem] w-full rounded-full px-3 text-center text-sm font-light',
  'bg-white/10 text-white border border-transparent',
  'focus:bg-white/[0.25] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40',
  'transition-all duration-300',
);

export function CuratedNameComposer({
  adjective,
  noun,
  onAdjectiveChange,
  onNounChange,
  onSubmit,
  submitting = false,
  submitLabel,
}: CuratedNameComposerProps) {
  const preview = useMemo(() => composeCuratedName(adjective, noun), [adjective, noun]);

  return (
    <div className="w-full space-y-2 animate-onboard-soft-fade-in" data-curated-name-composer>
      <div className="flex items-center gap-2">
        <label className="flex-1">
          <span className="sr-only">First part of the name</span>
          <select
            value={adjective}
            onChange={(event) => onAdjectiveChange(event.target.value)}
            className={SELECT_CLASS}
          >
            {CURATED_ADJECTIVES.map((word) => (
              <option key={word} value={word}>
                {word}
              </option>
            ))}
          </select>
        </label>
        <label className="flex-1">
          <span className="sr-only">Second part of the name</span>
          <select
            value={noun}
            onChange={(event) => onNounChange(event.target.value)}
            className={SELECT_CLASS}
          >
            {CURATED_NOUNS.map((word) => (
              <option key={word} value={word}>
                {word}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* The assembled name, announced so a screen reader hears it change. */}
      <p
        aria-live="polite"
        data-testid="curated-name-preview"
        className="text-center text-sm font-light text-white/80"
      >
        {preview}
      </p>

      {preview && (
        <Button
          onClick={onSubmit}
          disabled={submitting}
          variant="ghost"
          className={cn(
            'max-w-[12rem] mx-auto h-9 px-6 text-sm font-light tracking-wide',
            'bg-white/15 hover:bg-white/25 text-white/80 border-transparent',
            'rounded-full transition-all duration-300 focus-visible:ring-0 focus-visible:ring-offset-0',
          )}
        >
          {submitLabel}
        </Button>
      )}
    </div>
  );
}
