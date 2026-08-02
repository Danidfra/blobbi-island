/**
 * Treasure Hunt — the intro screen. Title lives in the shell header; this is
 * the explanation, Start Hunt, and an expandable How to Play. Copy is short
 * and child-friendly and never mentions protocol machinery.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';

interface TreasureHuntIntroProps {
  onStart: () => void;
  /** Round creation failed (a seed that cannot place targets). Rare; visible. */
  startError: string | null;
}

export function TreasureHuntIntro({ onStart, startError }: TreasureHuntIntroProps) {
  const [showHowTo, setShowHowTo] = useState(false);

  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-4 text-center px-4"
      data-treasure-intro
    >
      <div className="text-5xl" aria-hidden>
        🏖️
      </div>
      <p className="max-w-md text-base text-island-ink">
        Somewhere under this sand there are lost treasures — and some litter that
        would love a cleanup. Grab the metal detector and see what you can find!
      </p>

      <p
        className="max-w-md rounded-2xl bg-amber-100/80 px-4 py-2 text-sm text-island-ink"
        data-treasure-practice-notice
      >
        <span className="font-semibold">Practice Hunt</span> — rewards are not
        active yet. You can explore the detector and learn how to find objects.
      </p>

      {showHowTo && (
        <div
          className="max-w-md rounded-2xl border border-island-wood/30 bg-white/60 p-4 text-sm text-island-ink"
          data-treasure-howto
        >
          <p>Move the detector across the sand and watch the signal.</p>
          <p>When the signal is strong, switch to the shovel and choose where to dig.</p>
          <p>You only have a few digs, so choose carefully.</p>
        </div>
      )}

      {startError && (
        <p role="alert" className="max-w-md text-sm text-destructive">
          {startError}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          type="button"
          onClick={onStart}
          className="rounded-full min-h-[44px] px-6"
          data-treasure-start
        >
          Start Practice Hunt
        </Button>
        <Button
          type="button"
          variant="outline"
          className="rounded-full min-h-[44px]"
          onClick={() => setShowHowTo((v) => !v)}
          aria-expanded={showHowTo}
        >
          How to Play
        </Button>
      </div>
    </div>
  );
}
