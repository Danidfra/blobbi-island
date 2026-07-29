import React, { useState, forwardRef } from 'react';
import { cn } from '@/lib/utils';
import { useLocation } from '@/hooks/useLocation';
import { getBackgroundForLocation } from '@/lib/location-backgrounds';
import { locationBackgroundPath } from '@/lib/asset-paths';
import { VirtualWorld } from '@/components/shell/VirtualWorld';
import { IslandSkyLayer } from '@/components/sky/IslandSkyLayer';
import { IslandWorldLight } from '@/components/sky/IslandWorldLight';
import { IslandSkyDevPanel } from '@/components/sky/IslandSkyDevPanel';
import { useIslandArtworkGrade } from '@/hooks/useIslandSky';
import { isSkyDevMode } from '@/lib/island-sky-dev';

interface PlaceBackgroundProps {
  children: React.ReactNode;
  className?: string;
}

export const PlaceBackground = forwardRef<HTMLDivElement, PlaceBackgroundProps>(
  ({ children, className }, ref) => {
    const { currentLocation, isMapModalOpen } = useLocation();
    const [imageLoaded, setImageLoaded] = useState(false);
    const [imageError, setImageError] = useState(false);

    const backgroundImageFile = getBackgroundForLocation(currentLocation);
    const backgroundImage = locationBackgroundPath(backgroundImageFile);
    const shouldShowImage = imageLoaded && !imageError;

    /*
      Time-of-day grading for the location artwork. Applied as a CSS `filter` on
      the <img> rather than as an overlay above it, because the artwork is (or
      will be) TRANSPARENT where the sky shows through: an overlay would darken
      the sky and wash the stars out, while a filter leaves transparent pixels
      transparent. `filter` is `undefined` for locations without sky support, so
      their artwork renders exactly as it does today.

      This subscribes PlaceBackground to the island clock, so it re-renders once
      every ten seconds. `children` is referentially stable across those renders
      (it comes from PlayingView, which does not re-render), so React bails out on
      the entire world subtree and only these few wrapper divs are diffed.
    */
    const artworkGrade = useIslandArtworkGrade(currentLocation);
    const letterboxGrade = useIslandArtworkGrade(currentLocation, 'blur(40px)');

    return (
      <div
        className={cn(
          "relative w-full h-full",
          // Apply blur when map modal is open
          isMapModalOpen && "blur-sm",
          "transition-all duration-300 ease-in-out",
          className
        )}
      >
        {/*
          Letterbox fill (visual only). Because the playable world is a fixed
          1046×697 box scaled uniformly + centered, devices whose aspect ratio
          differs from ~3:2 show empty margins. We fill those margins with a
          blurred, scaled, dimmed copy of the SAME location background so the
          empty space looks intentional. This layer:
            - duplicates only the background image (no world objects),
            - is purely decorative: pointer-events-none + aria-hidden,
            - has NO data-world-surface and no interactive children,
            - sits BELOW the sharp, centered VirtualWorld.
        */}
        {shouldShowImage && (
          <div
            aria-hidden
            className="absolute inset-0 overflow-hidden pointer-events-none"
          >
            {/* `blur-2xl` (40px) moved into the inline filter: an inline `filter`
                would otherwise replace the Tailwind blur outright, and the two
                have to compose for the margins to stay both blurred and graded. */}
            <img
              src={backgroundImage}
              alt=""
              aria-hidden
              className={cn(
                'absolute inset-0 w-full h-full object-cover scale-110',
                !letterboxGrade.filter && 'blur-2xl',
              )}
              style={{ filter: letterboxGrade.filter, transition: letterboxGrade.transition }}
            />
            {/* Subtle dark/cream overlay so the world reads as the focus. */}
            <div className="absolute inset-0 bg-island-ink/40 mix-blend-multiply" />
            <div className="absolute inset-0 bg-island-cream/10" />
          </div>
        )}

        {/*
          Fixed virtual world coordinate space (1046×697), uniformly scaled to
          fit. The background image AND the clickable world surface both live
          inside it so every percent-positioned and px/rem-sized world object
          shares one consistent coordinate system. UI/HUD/dock/chat/modals are
          rendered outside this layer and do not scale as world objects.
        */}
        <VirtualWorld className="relative z-[1]">
          {/*
            The dynamic sky, BEHIND the location artwork (z-0 vs z-[1]). It shows
            through wherever the artwork's sky region is transparent, and is
            harmlessly invisible where the artwork is still opaque. Decorative
            only: pointer-events-none, aria-hidden, no data-world-surface.
            Disabled locations render nothing at all.
          */}
          <IslandSkyLayer location={currentLocation} className="z-0" />

          {/* Background Image */}
          <>
            <img
              src={backgroundImage}
              alt={`${currentLocation} background`}
              className={cn(
                "absolute inset-0 w-full h-full object-cover transition-opacity duration-500 pointer-events-none z-[1]",
                shouldShowImage ? "opacity-100" : "opacity-0",
                currentLocation === "stage" ? 'bg-black' : '',
              )}
              style={{
                filter: artworkGrade.filter,
                // Composed with the existing opacity fade-in rather than
                // replacing it, so a first load still fades as it did before.
                transition: artworkGrade.transition
                  ? `opacity 500ms, ${artworkGrade.transition}`
                  : undefined,
              }}
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageError(true)}
            />

            {/* Loading state for background image */}
            {!shouldShowImage && (
              <div className="absolute inset-0 z-[1] bg-gradient-to-b from-sky-200 to-blue-300 animate-pulse" />
            )}
          </>

          {/*
            Clickable ground/surface layer (only this recebe data-world-surface).

            It also PUBLISHES the world grade as a CSS custom property. Every world
            sprite — buildings, doors, props, bushes, furniture — is an <img> inside
            here, and until now only the background plate above was graded, so at
            night the plate darkened to brightness 0.70 while the sprites sitting on
            it stayed at 1.0. Bright saturated art (the Town bushes especially) read
            as lit by a different sun than the ground it stands on.

            A custom property is the fix rather than a wrapper because `filter` on a
            wrapper would create a stacking context and flatten this layer's
            z-indexes — and the Blobbi's z-index is computed from its Y position
            precisely so it can walk BEHIND a bush or a building. Collapsing that
            would break occlusion. A custom property is inert: it creates no
            stacking context, moves nothing, and changes no pointer behaviour.
            `src/index.css` consumes it in one rule; see there for what opts out.
          */}
          <div
          ref={ref}
            className="relative z-10 w-full h-full"
            data-world-surface
            data-island-world-graded={artworkGrade.filter ? '' : undefined}
            style={
              artworkGrade.filter
                ? ({ ['--island-world-grade' as string]: artworkGrade.filter } as React.CSSProperties)
                : undefined
            }
          >
            {children}
          </div>

          {/*
            World lighting, ABOVE the world content so the shared warm/cool cast
            reaches the Blobbi and remote players too. Its alpha is capped low
            (≤0.14 before per-location scaling) precisely because it also covers
            name labels and chat bubbles; the weight of night is carried by the
            artwork filter above, which cannot reach characters.
            Sitting at z-[20] inside VirtualWorld puts it over every world child
            (the content div is z-10) while staying below the HUD, dock, modals
            and SceneTransition, which are rendered outside this stacking context.
          */}
          <IslandWorldLight location={currentLocation} className="z-[20]" />
        </VirtualWorld>

        {/*
          DEV harness. Rendered OUTSIDE VirtualWorld on purpose: it is UI, not a
          world object, so it must not be scaled by the world transform (it would
          shrink to unreadable on a small viewport).

          `isSkyDevMode` is `import.meta.env.DEV`, a literal `false` in a
          production build, so this branch and the panel's module are dropped from
          the bundle rather than hidden with CSS.
        */}
        {isSkyDevMode && <IslandSkyDevPanel />}
      </div>
    );
  }
);

PlaceBackground.displayName = 'PlaceBackground';
