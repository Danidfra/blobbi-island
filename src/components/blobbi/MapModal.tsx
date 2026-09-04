import React, { useState, useRef, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { BlobbiModal } from '@/components/ui/blobbi-modal';
import { useLocation } from '@/hooks/useLocation';
import type { LocationId } from '@/lib/location-types';
import { WORLD_WIDTH, WORLD_HEIGHT } from '@/lib/world-coordinates';
import { mapDestinationFor } from '@/lib/map-destinations';

// Location data with positioning coordinates (as percentages of the island image)
interface Location {
  id: LocationId;
  name: string;
  image: string;
  position: {
    x: number; // percentage from left (0-100)
    y: number; // percentage from top (0-100)
  };
  size?: {
    width?: number; // pixels (optional)
    height?: number; // pixels (optional)
  };
}

/**
 * The map art's fixed design resolution. All marker positions (percent) AND
 * marker sizes (px) below were authored against this exact map image, so we use
 * it as a stable "virtual map" coordinate system: marker px sizes are converted
 * to a percentage of the rendered map width, and markers are positioned inside a
 * box that matches the rendered image rect. This keeps everything aligned and
 * proportional at any modal size.
 */
const MAP_DESIGN_WIDTH = WORLD_WIDTH;
const MAP_DESIGN_HEIGHT = WORLD_HEIGHT;
const MAP_ASPECT = MAP_DESIGN_WIDTH / MAP_DESIGN_HEIGHT;

const LOCATIONS: Location[] = [
  {
    id: 'home',
    name: 'Home',
    image: '/assets/world/map/miniature-home.png',
    position: { x: 64, y: 38 },
    size: { width: 80 }
  },
  {
    id: 'beach',
    name: 'Beach',
    image: '/assets/world/map/miniature-beach.png',
    position: { x: 60, y: 87 },
    size: { width: 60 }
  },
  {
    id: 'mine',
    name: 'Mine',
    image: '/assets/world/map/miniature-mine.png',
    position: { x: 24, y: 79 },
    size: { width: 100 }
  },
  {
    id: 'nostr-station',
    name: 'Nostr Station',
    image: '/assets/world/map/miniature-nostr-station.png',
    position: { x: 80, y: 66 },
    size: { width: 100 }
  },
  {
    id: 'plaza',
    name: 'Plaza',
    image: '/assets/world/map/miniature-plaza.png',
    position: { x: 47.5, y: 46 },
    size: { width: 120 }
  },
  {
    id: 'town',
    name: 'Town',
    image: '/assets/world/map/miniature-town.png',
    position: { x: 33, y: 24 },
    size: { width: 140 }
  },
];



interface MapModalProps {
  className?: string;
}

interface ImageDimensions {
  naturalWidth: number;
  naturalHeight: number;
}

export function MapModal({ className }: MapModalProps) {
  const { isMapModalOpen, setIsMapModalOpen, currentLocation, setCurrentLocation } = useLocation();
  const [hoveredLocation, setHoveredLocation] = useState<string | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [imageDimensions, setImageDimensions] = useState<Record<string, ImageDimensions>>({});
  const [loadingImages, setLoadingImages] = useState<Set<string>>(new Set());
  // The rendered map rect (the largest MAP_ASPECT box that fits the stage),
  // measured in JS so markers can be positioned/sized relative to the ACTUAL
  // on-screen map image rather than a letterboxed container.
  const [mapBox, setMapBox] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  // Function to load image dimensions
  const loadImageDimensions = useCallback((imageUrl: string): Promise<ImageDimensions> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        resolve({
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight
        });
      };
      img.onerror = reject;
      img.src = imageUrl;
    });
  }, []);

  // Function to calculate final size based on provided dimensions and image aspect ratio
  const calculateFinalSize = useCallback((location: Location) => {
    const { size, image } = location;
    const dimensions = imageDimensions[image];

    if (!dimensions) {
      // If image dimensions not loaded yet, return default size
      return { width: 60, height: 60 };
    }

    const { naturalWidth, naturalHeight } = dimensions;
    const aspectRatio = naturalWidth / naturalHeight;

    if (!size) {
      // If no size provided, use natural size
      return { width: naturalWidth, height: naturalHeight };
    }

    const { width: providedWidth, height: providedHeight } = size;

    if (providedWidth !== undefined && providedHeight !== undefined) {
      // Both dimensions provided, use as-is
      return { width: providedWidth, height: providedHeight };
    }

    if (providedWidth !== undefined) {
      // Only width provided, calculate height from aspect ratio
      return {
        width: providedWidth,
        height: Math.round(providedWidth / aspectRatio)
      };
    }

    if (providedHeight !== undefined) {
      // Only height provided, calculate width from aspect ratio
      return {
        width: Math.round(providedHeight * aspectRatio),
        height: providedHeight
      };
    }

    // Fallback to natural size
    return { width: naturalWidth, height: naturalHeight };
  }, [imageDimensions]);

  // Load all image dimensions when modal opens
  useEffect(() => {
    if (!isMapModalOpen) return;

    const loadAllImages = async () => {
      const newLoadingImages = new Set<string>();

      // Start loading all images
      LOCATIONS.forEach(location => {
        if (!imageDimensions[location.image]) {
          newLoadingImages.add(location.image);
        }
      });

      if (newLoadingImages.size === 0) return;

      setLoadingImages(newLoadingImages);

      try {
        const dimensionPromises = Array.from(newLoadingImages).map(async (imageUrl) => {
          const dimensions = await loadImageDimensions(imageUrl);
          return { imageUrl, dimensions };
        });

        const results = await Promise.all(dimensionPromises);

        // Update dimensions state
        const updatedDimensions = { ...imageDimensions };
        results.forEach(({ imageUrl, dimensions }) => {
          updatedDimensions[imageUrl] = dimensions;
        });

        setImageDimensions(updatedDimensions);
      } catch (error) {
        console.error('Error loading image dimensions:', error);
      } finally {
        setLoadingImages(new Set());
      }
    };

    loadAllImages();
  }, [isMapModalOpen, imageDimensions, loadImageDimensions]);

  // Measure the stage and compute the largest MAP_ASPECT box that fits inside
  // it (the actual rendered map rect). Markers are positioned relative to this.
  useEffect(() => {
    if (!isMapModalOpen) return;
    const stage = stageRef.current;
    if (!stage) return;

    const recompute = () => {
      const { width, height } = stage.getBoundingClientRect();
      if (width === 0 || height === 0) return;
      // Contain: bind by whichever dimension is the limiting constraint.
      let w = width;
      let h = w / MAP_ASPECT;
      if (h > height) {
        h = height;
        w = h * MAP_ASPECT;
      }
      setMapBox((prev) =>
        Math.abs(prev.width - w) > 0.5 || Math.abs(prev.height - h) > 0.5
          ? { width: w, height: h }
          : prev,
      );
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [isMapModalOpen]);

  if (!isMapModalOpen) return null;

  const handleLocationClick = (locationId: LocationId) => {
    // Set the new location and close modal for all locations
    setCurrentLocation(locationId);
    setIsMapModalOpen(false);
  };

  const handleCloseModal = () => {
    setIsMapModalOpen(false);
  };

  // Where the player IS, on this map's terms; never a raw location id.
  const hereId = mapDestinationFor(currentLocation);
  const currentName = LOCATIONS.find((l) => l.id === hereId)?.name ?? 'the Island';

  return (
    <BlobbiModal
      open
      onOpenChange={(next) => !next && handleCloseModal()}
      presentation="in-frame"
      size="full"
      title="Island Map"
      description={`Tap a place to travel there. You are at ${currentName}.`}
      icon="🏝️"
      className={className}
      /*
        No body padding and no scroller: the map measures the box it is given
        (a ResizeObserver on `stageRef` fits the largest MAP_ASPECT rectangle
        inside it) and every marker is positioned against that measurement, so
        the map must BE the body rather than sit in it.
      */
      bodyClassName="relative flex items-center justify-center overflow-hidden p-2"
    >
      <div
        ref={stageRef}
        className="relative flex h-full w-full items-center justify-center"
      >


        {/* Map Container: sized to the measured rendered map rect so all
            markers (children of this box) stay aligned and proportional with
            the map image at any modal size. */}
        <div
          ref={mapContainerRef}
          className="relative"
          style={{
            width: mapBox.width || undefined,
            height: mapBox.height || undefined,
            visibility: mapBox.width ? 'visible' : 'hidden',
          }}
        >
          {/* Island Map Background */}
          <img
            src="/assets/world/map/blobbi-island.png"
            alt="Blobbi Village Map"
            className="absolute inset-0 w-full h-full object-fill drop-shadow-2xl transition-all duration-500 ease-in-out"
            draggable={false}
          />

          {/* Location Overlays */}
          {LOCATIONS.map((location) => {
            const finalSize = calculateFinalSize(location);
            const isImageLoading = loadingImages.has(location.image);

            // Convert design-pixel sizes (authored against the 1046×697 map) to
            // a percentage of the map box so markers scale WITH the map image.
            const widthPct = (finalSize.width / MAP_DESIGN_WIDTH) * 100;
            const heightPct = (finalSize.height / MAP_DESIGN_HEIGHT) * 100;

            const isHere = location.id === hereId;

            return (
              <button
                key={location.id}
                data-map-destination={location.id}
                data-map-here={isHere ? '' : undefined}
                aria-current={isHere ? 'location' : undefined}
                onClick={() => handleLocationClick(location.id)}
                onMouseEnter={() => setHoveredLocation(location.id)}
                onMouseLeave={() => setHoveredLocation(null)}
                className={cn(
                  "absolute transform -translate-x-1/2 -translate-y-1/2",
                  "transition-all duration-300 ease-out motion-reduce:transition-none",
                  "cursor-pointer",
                  "hover:z-20",
                  "rounded-lg",
                  "active:scale-95",
                  hoveredLocation === location.id && "scale-110 drop-shadow-2xl z-20",
                  isHere && "z-10",
                  isImageLoading && "opacity-50", // Show loading state
                )}
                style={{
                  left: `${location.position.x}%`,
                  top: `${location.position.y}%`,
                  width: `${widthPct}%`,
                  height: `${heightPct}%`,
                }}
                title={location.name}
                aria-label={isHere ? `${location.name}: you are here` : `Go to ${location.name}`}
                disabled={isImageLoading}
              >
              {isImageLoading ? (
                <div className="w-full h-full flex items-center justify-center bg-island-cream-2 rounded-lg">
                  <div className="w-4 h-4 border-2 border-island-wood/40 border-t-transparent rounded-full animate-spin"></div>
                </div>
              ) : (
                <img
                  src={location.image}
                  alt={location.name}
                  className={cn(
                    "w-full h-full object-contain",
                    "transition-all duration-300 ease-out",
                    "drop-shadow-lg",
                    hoveredLocation === location.id && "brightness-110 contrast-110"
                  )}
                />
              )}

              {/* "You are here": a pin above the marker the player is on. */}
              {isHere && (
                <span
                  aria-hidden
                  className="absolute left-1/2 bottom-full mb-1 flex -translate-x-1/2 flex-col items-center"
                >
                  <span className="rounded-full border border-island-cream/40 bg-island-danger px-2 py-0.5 text-[0.625rem] font-black uppercase tracking-wide text-island-cream shadow-cozy-soft whitespace-nowrap">
                    You are here
                  </span>
                  <span className="-mt-px h-0 w-0 border-x-[5px] border-t-[6px] border-x-transparent border-t-island-danger" />
                </span>
              )}

              {/* Location label: ALWAYS visible. A new player has to be able
                  to read the map, not discover it by hovering; the hover only
                  lifts the label a little. */}
              <div
                className={cn(
                  "absolute left-1/2 transform -translate-x-1/2 top-full mt-1.5",
                  "rounded-full px-2.5 py-1 text-[0.6875rem] font-bold leading-none",
                  "transition-all duration-300 ease-out motion-reduce:transition-none",
                  "whitespace-nowrap border backdrop-blur-sm shadow-cozy-soft",
                  isHere
                    ? "border-island-cream/40 bg-island-danger text-island-cream"
                    : "border-island-cream/20 bg-island-ink/85 text-island-cream",
                  hoveredLocation === location.id && "-translate-y-0.5",
                )}
              >
                {location.name}
              </div>
            </button>
          );})}


        </div>

      </div>
    </BlobbiModal>
  );
}