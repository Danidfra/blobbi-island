import { useMemo } from "react";
import { loadBlobbiSvg, normalizeBlobbiRenderModel } from "@blobbi/react";
import { cn } from "@/lib/utils";
import { Check, Sparkles } from "lucide-react";
import { getBlobbiDisplayName } from "@/lib/blobbi-legacy";
import type { Blobbi } from "@/hooks/useBlobbis";

interface BlobbiCardProps {
  blobbi: Blobbi;
  isSelected: boolean;
  isCurrent: boolean;
  onSelect: () => void;
  onConfirm: () => void;
}

/**
 * BlobbiCard — a cozy "creature card" for the Blobbi nest.
 *
 * Shows the Blobbi art prominently on a warm sand/cream pedestal, the name,
 * and a small stage chip. The currently active companion gets an "Active"
 * ribbon; the picked card gets a soft ocean glow. Selecting is a single tap
 * on the card (no separate buttons), keeping the collection clean. The
 * confirm action lives in the parent screen's footer.
 */
export function BlobbiCard({
  blobbi,
  isSelected,
  isCurrent,
  onSelect,
  onConfirm,
}: BlobbiCardProps) {
  const svgContent = useMemo(() => {
    // Shares the ONE stage/adult-type/id rule with the pure renderer rather
    // than restating it: this card builds its own SVG (it needs no accessory
    // layers or gaze), but a card must never disagree with the world about
    // which drawing a Blobbi has.
    const model = normalizeBlobbiRenderModel({ visual: blobbi, instanceId: blobbi.id });

    return loadBlobbiSvg(
      model.stage,
      model.adultType,
      model.baseColor,
      model.secondaryColor,
      model.eyeColor,
      model.eyesClosed,
      model.instanceId,
    );
  }, [blobbi.stage, blobbi.adultType, blobbi.baseColor, blobbi.secondaryColor, blobbi.eyeColor, blobbi.id]);

  // Resolve the friendliest display name. The modern `name` tag is the
  // authoritative source; see getBlobbiDisplayName for the full priority order
  // and why blobbi.name alone can't be trusted (it's d-tag-derived first).
  const displayName = getBlobbiDisplayName(blobbi);

  return (
    <button
      type="button"
      onClick={onSelect}
      // Double-tap / double-click the active-but-not-current pick to confirm,
      // mirroring the previous card "Confirm" affordance without a button.
      onDoubleClick={() => {
        if (isSelected && !isCurrent) onConfirm();
      }}
      aria-pressed={isSelected}
      aria-label={`${displayName}${isCurrent ? " (active companion)" : ""}`}
      className={cn(
        "group relative flex w-full flex-col items-center rounded-2xl border-2 p-2 text-center",
        "shadow-cozy-soft outline-none transition-all duration-200 ease-cozy",
        "hover:-translate-y-0.5 hover:shadow-cozy-raised focus-visible:ring-2 focus-visible:ring-island-ocean focus-visible:ring-offset-2",
        isCurrent
          ? "border-island-grass bg-gradient-to-b from-island-grass/15 to-island-cream shadow-cozy-raised"
          : isSelected
            ? "border-island-ocean bg-island-cream shadow-cozy-raised ring-2 ring-island-ocean/30"
            : "border-island-wood/25 bg-island-cream hover:border-island-wood/45",
      )}
    >
      {/* Active companion ribbon */}
      {isCurrent && (
        <span className="absolute top-1.5 left-1/2 z-20 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-island-grass px-2.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-island-ink shadow-cozy-soft">
          <Sparkles className="size-3" />
          Active
        </span>
      )}

      {/* Selected check badge */}
      {isSelected && !isCurrent && (
        <span className="absolute top-1 right-1 z-20 inline-flex size-6 items-center justify-center rounded-full bg-island-ocean text-island-cream shadow-cozy-soft">
          <Check className="size-3.5" />
        </span>
      )}

      {/* Art pedestal — a tiny layered diorama: sky, sun highlight, sandy
          ground shelf, and a soft contact shadow so the Blobbi feels like it's
          standing in its own little nest rather than floating on a flat card. */}
      <div
        className={cn(
          "relative aspect-square w-full overflow-hidden rounded-xl border-2 shadow-cozy-inset transition-colors duration-200 ease-cozy",
          "bg-gradient-to-b from-island-sky/45 via-island-sky/15 to-island-cream",
          isCurrent
            ? "border-island-grass/40"
            : isSelected
              ? "border-island-ocean/30"
              : "border-island-wood/15",
        )}
      >
        {/* Soft sun highlight (top-left) */}
        <div className="pointer-events-none absolute -left-3 -top-3 size-16 rounded-full bg-white/40 blur-xl" />

        {/* Sandy ground shelf */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[38%] bg-gradient-to-t from-island-sand via-island-sand/80 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-[36%] h-[2px] bg-island-wood/10" />

        {/* Blobbi + its ground shadow, stacked and anchored to the shelf so the
            shadow sits right at the creature's feet. The shadow is sized
            relative to the art container (≈64% of its width, a flat ellipse),
            so it stays proportional to the Blobbi at every breakpoint —
            including the smaller mobile-landscape size — instead of being a
            generic fixed oval detached from the creature. */}
        <div className="absolute inset-x-0 bottom-[14%] flex flex-col items-center">
          <div className="relative size-[4.5rem] sm:size-[5.5rem] landscape:max-md:size-14">
            <div
              className="size-full drop-shadow-[0_4px_6px_rgba(58,42,26,0.16)] transition-transform duration-200 ease-cozy group-hover:-translate-y-0.5 group-hover:scale-105"
              dangerouslySetInnerHTML={{ __html: svgContent }}
            />
          </div>
          {/* Proportional contact shadow (width = ~64% of art width via w-[64%]
              of the same-sized track below). */}
          <div className="-mt-1 flex w-[4.5rem] justify-center sm:w-[5.5rem] landscape:max-md:w-14">
            <div className="h-2 w-[64%] rounded-[50%] bg-island-ink/20 blur-[2px] transition-all duration-200 ease-cozy group-hover:w-[72%] group-hover:opacity-80" />
          </div>
        </div>
      </div>

      {/* Name + stage */}
      <div className="mt-1.5 flex w-full flex-col items-center gap-0.5">
        <h3 className="max-w-full truncate text-sm font-bold text-island-ink landscape:max-md:text-xs">
          {displayName}
        </h3>
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2 py-px text-[0.65rem] font-semibold capitalize",
            isCurrent
              ? "bg-island-grass/25 text-island-grass-dark"
              : "bg-island-cream-2 text-island-wood-dark",
          )}
        >
          {blobbi.stage}
        </span>
      </div>
    </button>
  );
}
