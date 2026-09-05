/**
 * CurrentBlobbiPreview: preview-context wrapper over CurrentBlobbiDisplay.
 *
 * Sizing goes through the ONE canonical renderer-size contract of
 * `@blobbi/renderer`: every token, including the preview-only `2xl` and
 * `3xl`, is a real renderer box, so there are no preview-specific overrides,
 * no separate accessory multiplier table, and no viewport breakpoints. The
 * accessory editor mounts its overlay on the same box (see BlobbiInfoModal),
 * so editor placement and world placement agree by construction.
 *
 * ## Sizing a preview to its CONTAINER
 *
 * The renderer draws its box as an INLINE width/height, so a utility class can
 * no longer override it. Instead `size` accepts a CSS length: pass
 * `size="100%"` inside a sized, square parent and the box fills it. The My
 * Blobbi stage uses that to make the Blobbi a fixed FRACTION of its scene
 * rather than a fixed pixel count, so the protagonist is the same size
 * relative to its backdrop on a phone and on a desktop, with no viewport
 * breakpoint anywhere.
 *
 * This is safe because everything the renderer paints is already expressed in
 * percentages OF the box: accessory x/y, accessory base size
 * (`ACCESSORY_BASE_RATIO`) and every effect shape. Resizing the box scales the
 * Blobbi and everything on it as ONE unit; no accessory-by-accessory
 * compensation, and saved placements keep their meaning exactly.
 */
import { forwardRef } from "react";
import { CurrentBlobbiDisplay, type CurrentBlobbiDisplayProps } from "./CurrentBlobbiDisplay";
import { cn } from "@/lib/utils";
import type { BlobbiRendererSize } from "@blobbi/renderer";

interface CurrentBlobbiPreviewProps extends Omit<CurrentBlobbiDisplayProps, "size"> {
  /** A size token, a pixel number, or a CSS length such as `"100%"`. */
  size?: BlobbiRendererSize;
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
