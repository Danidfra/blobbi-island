import { forwardRef } from "react";
import { CurrentBlobbiDisplay, type CurrentBlobbiDisplayProps } from "./CurrentBlobbiDisplay";
import { cn } from "@/lib/utils";

interface CurrentBlobbiPreviewProps extends Omit<CurrentBlobbiDisplayProps, "size"> {
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";
  isStaticPreview?: boolean;
  children?: React.ReactNode;
  _transparent?: boolean;
}

const sizeClasses = {
  sm: "h-8 w-8 md:h-10 md:w-10",
  md: "h-12 w-12 md:h-16 md:w-16",
  lg: "h-16 w-16 md:h-20 md:w-20",
  xl: "h-24 w-24 md:h-32 md:w-32",
  "2xl": "h-48 w-48 md:h-64 md:w-64",
  "3xl": "h-64 w-64 md:h-80 md:w-80"
};



export const CurrentBlobbiPreview = forwardRef<HTMLDivElement, CurrentBlobbiPreviewProps>(({
  className,
  size = "lg",
  showFallback = true,
  isStaticPreview = false,
  onClick,
  interactive = false,
  _transparent = false,
  isSleeping = false,
  eyesClosed = false,
  children,
  ...props
}, ref) => {
  // For static preview mode, we want to disable all interactions and animations
  const effectiveInteractive = isStaticPreview ? false : interactive;
  const effectiveOnClick = isStaticPreview ? undefined : onClick;

  // Map larger sizes to CurrentBlobbiDisplay's "xl" size but override with custom classes
  const displaySize = size === "2xl" || size === "3xl" ? "xl" : size;

  return (
    <div ref={ref} className={cn("relative", sizeClasses[size], className)}>
      <CurrentBlobbiDisplay
        {...props}
        size={displaySize}
        showFallback={showFallback}
        onClick={effectiveOnClick}
        interactive={effectiveInteractive}
        transparent={true} // Always use transparent mode for preview to match the original static display behavior
        isSleeping={isSleeping}
        eyesClosed={eyesClosed}
        className={cn(
          // Override the size classes for larger sizes
          (size === "2xl" || size === "3xl") && "!h-auto !w-auto",
          // Apply custom SVG sizing for larger sizes
          size === "2xl" && "[&>div]:h-40 [&>div]:w-40 md:[&>div]:h-56 md:[&>div]:w-56",
          size === "3xl" && "[&>div]:h-56 [&>div]:w-56 md:[&>div]:h-72 md:[&>div]:w-72",
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