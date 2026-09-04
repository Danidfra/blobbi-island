import { Check, ImageIcon, Lock } from 'lucide-react';

import { cn } from '@/lib/utils';
import { playerFacingMessage } from '@/lib/player-facing-error';
import { BlobbiModal } from '@/components/ui/blobbi-modal';
import { STAGE_ASPECT_RATIO, type StageBackground } from '@/lib/blobbi-stage-backgrounds';
import { useStageBackground } from '@/hooks/useStageBackground';

/** The backdrop itself, at swatch scale. Same art the stage draws, nothing hand-coloured. */
function Swatch({ background }: { background: StageBackground }) {
  return (
    <span
      aria-hidden
      className="block w-full overflow-hidden rounded-lg border border-island-wood/30 bg-island-cream-2"
      style={{ aspectRatio: STAGE_ASPECT_RATIO }}
    >
      {background.art.kind === 'gradient' ? (
        <span className="block h-full w-full" style={{ backgroundImage: background.art.css }} />
      ) : (
        <img src={background.art.src} alt="" className="h-full w-full object-cover" />
      )}
    </span>
  );
}

/**
 * StageBackgroundPicker: My Blobbi → the stage's own "change background".
 *
 * ## Why the control is on the stage
 *
 * Because that is the thing it changes. The alternatives were a row in Primary
 * (far from the picture, and Primary is a care sheet) or a future Appearance
 * section (which does not exist and would be a whole tab for one setting). A
 * small button in the corner of the backdrop is the least clutter for the most
 * obvious meaning, and it leaves the Appearance section free to arrive later
 * without this having to move.
 *
 * ## Locked entries are shown, not hidden
 *
 * A backdrop the player has not unlocked renders with its picture and a lock,
 * disabled. Hiding it would make the slot look like it has two options forever;
 * showing it is what makes a future unlockable backdrop legible as something to
 * get. No production backdrop is locked today; both built-ins are always
 * available: but the gate is the one `isStageBackgroundOwned` applies, so the
 * first unlockable one needs no UI change.
 */
export function StageBackgroundPicker({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { background: active, choices, setBackground, isSaving, error, canSelect } =
    useStageBackground();

  return (
    <BlobbiModal
      open={open}
      onOpenChange={onOpenChange}
      presentation="in-frame"
      size="md"
      title="Stage background"
      description="The scene your Blobbi is photographed in. It does not change the island."
      icon={<ImageIcon />}
    >
      {error && (
        <div
          role="alert"
          className="mb-3 rounded-xl border border-island-danger/30 bg-island-danger/10 p-2.5 text-xs text-island-danger"
        >
          Could not save your background. {playerFacingMessage(error, 'Try again in a moment.')}
        </div>
      )}

      <div role="radiogroup" aria-label="Stage background" className="grid grid-cols-3 gap-2.5">
        {choices.map(({ background, owned }) => {
          const selected = background.id === active.id;
          const disabled = !owned || !canSelect || isSaving;
          return (
            <button
              key={background.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              data-testid={`stage-background-${background.id}`}
              onClick={() => setBackground(background.id)}
              className={cn(
                'group relative flex flex-col gap-1.5 rounded-panel border-2 p-1.5 text-left',
                'transition-transform duration-150 ease-cozy',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-island-cream',
                'motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100',
                selected
                  ? 'border-island-purple bg-island-cream-2 shadow-cozy-raised'
                  : 'border-island-wood/25 bg-island-cream/60',
                disabled
                  ? 'cursor-not-allowed opacity-60'
                  : 'hover:-translate-y-0.5 hover:border-island-wood/45 active:scale-[0.98]',
              )}
            >
              <span className="relative block">
                <Swatch background={background} />
                {selected && (
                  <span
                    aria-hidden
                    className="absolute right-1 top-1 inline-flex size-5 items-center justify-center rounded-full bg-island-purple text-island-cream shadow-cozy-soft"
                  >
                    <Check className="size-3" />
                  </span>
                )}
                {!owned && (
                  <span
                    aria-hidden
                    className="absolute inset-0 flex items-center justify-center rounded-lg bg-island-ink/45 text-island-cream"
                  >
                    <Lock className="size-4" />
                  </span>
                )}
              </span>
              <span className="min-w-0 px-0.5">
                <span className="block truncate text-xs font-semibold text-island-ink">
                  {background.emoji} {background.name}
                </span>
                <span className="mt-0.5 block text-[0.6875rem] leading-snug text-island-ink-soft">
                  {owned ? background.description : 'Not unlocked yet.'}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-4 text-center text-xs text-island-ink-soft">
        {canSelect
          ? 'Saved with your Blobbonaut profile, so it follows you to any device.'
          : 'Sign in to change your stage background.'}
      </p>
    </BlobbiModal>
  );
}
