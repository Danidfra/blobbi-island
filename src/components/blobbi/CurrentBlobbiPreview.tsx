/**
 * CurrentBlobbiPreview — preview-context wrapper over CurrentBlobbiDisplay.
 *
 * Sizing goes through the ONE canonical renderer-size table
 * (`blobbi-render-size.ts`): every token — including the preview-only `2xl`
 * and `3xl` — is a real renderer box now, so there are no preview-specific
 * class overrides, no separate accessory multiplier table, and no viewport
 * breakpoints. The accessory editor mounts its overlay on the same box (see
 * BlobbiInfoModal), so editor placement and world placement agree by
 * construction.
 */
import { forwardRef } from "react";
import { CurrentBlobbiDisplay, type CurrentBlobbiDisplayProps } from "./CurrentBlobbiDisplay";
import { cn } from "@/lib/utils";
import type { BlobbiRenderSize } from "./lib/blobbi-render-size";

interface CurrentBlobbiPreviewProps extends Omit<CurrentBlobbiDisplayProps, "size"> {
  size?: BlobbiRenderSize;
  isStaticPreview?: boolean;
  children?: React.ReactNode;
  showAccessories?: boolean;
}

export const CurrentBlobbiPreview = forwardRef<HTMLDivElement, CurrentBlobbiPreviewProps>(({
  className,
  size = "lg",
  showFallback = true,
  isStaticPreview = false,
  onClick,
  interactive = false,
  isSleeping = false,
  eyesClosed = false,
  showAccessories = true,
  children,
  ...props
}, ref) => {
  // For static preview mode, we want to disable all interactions and animations
  const effectiveInteractive = isStaticPreview ? false : interactive;
  const effectiveOnClick = isStaticPreview ? undefined : onClick;

  return (
    // w-fit/h-fit: shrink-wrap exactly the renderer box, so a parent that uses
    // this element as an accessory-editing coordinate space (BlobbiInfoModal's
    // stageRef) measures the canonical box and nothing more.
    <div ref={ref} className={cn("relative h-fit w-fit", className)}>
      <CurrentBlobbiDisplay
        {...props}
        size={size}
        showFallback={showFallback}
        onClick={effectiveOnClick}
        interactive={effectiveInteractive}
        transparent={true} // Always use transparent mode for preview to match the original static display behavior
        isSleeping={isSleeping}
        eyesClosed={eyesClosed}
        showAccessories={showAccessories}
        className={cn(
          // For static preview, remove any hover/click effects
          isStaticPreview && "!cursor-default !hover:scale-100 !transition-none"
        )}
      />

      {/* Overlay slot for accessories - future-ready */}
      {children && (
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          {children}
        </div>
      )}
    </div>
  );
});

CurrentBlobbiPreview.displayName = "CurrentBlobbiPreview";
