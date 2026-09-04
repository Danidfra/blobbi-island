/**
 * The one control that commits a Token, and says so BEFORE it is pressed.
 *
 * Every paid machine used to offer a bare "Start": the price was only
 * discoverable by pressing it and being refused. The label now carries the
 * cost the entry model will actually charge ("Play · 1 Token"), drops it when
 * the run is free or a Pass waives it ("Start"), and, when the balance is
 * known to be short, says so underneath, while leaving the button live, so
 * the entry model's own refusal (which also knows about "unavailable",
 * "busy" and "unconfirmed") remains the single authority. No economy rule
 * lives here: cost, pass and balance all come from `ArcadeGameEntry`.
 */

import { cn, islandCtaButtonClass } from '@/lib/utils';
import {
  arcadeEntryLooksShort,
  arcadeStartLabel,
  type ArcadeStartLabelInput,
} from '@/arcade/tokens/start-label';

interface ArcadeStartButtonProps extends ArcadeStartLabelInput {
  onClick: () => void;
  /** A data attribute name (e.g. `data-hockey-start`) the machine's tests key on. */
  dataAttribute?: string;
  /** The value for that attribute (e.g. `first` / `again`). */
  dataValue?: string;
  className?: string;
}

export function ArcadeStartButton({
  entry,
  gameId,
  replay = false,
  onClick,
  dataAttribute,
  dataValue,
  className,
}: ArcadeStartButtonProps) {
  const label = arcadeStartLabel({ entry, gameId, replay });
  const short = arcadeEntryLooksShort({ entry, gameId });
  const data = dataAttribute ? { [dataAttribute]: dataValue ?? '' } : {};
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        {...data}
        data-arcade-start-cost={entry.hasPass ? 'pass' : String(entry.costFor(gameId))}
        onClick={onClick}
        className={cn(islandCtaButtonClass, 'w-auto min-w-[10rem] px-8 py-2.5', className)}
      >
        {label}
      </button>
      {short && (
        <span data-arcade-start-short className="text-xs font-medium text-island-ink-soft">
          Not enough Tokens yet; you have {entry.tokenBalance}.
        </span>
      )}
    </div>
  );
}
