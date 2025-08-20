import React, { useState, useRef, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { useLocation } from '@/hooks/useLocation';
import type { LocationId } from '@/lib/location-types';
import { IconX } from '@tabler/icons-react';

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

const LOCATIONS: Location[] = [
  {
    id: 'home',
    name: 'Home',
    image: '/assets/map/miniature-home.png',
    position: { x: 64, y: 38 },
    size: { width: 80 }
  },
  {
    id: 'beach',
    name: 'Beach',
    image: '/assets/map/miniature-beach.png',
    position: { x: 60, y: 87 },
    size: { width: 60 }
  },
  {
    id: 'mine',
    name: 'Mine',
    image: '/assets/map/miniature-mine.png',
    position: { x: 24, y: 79 },
    size: { width: 100 }
  },
  {
    id: 'nostr-station',
    name: 'Nostr Station',
    image: '/assets/map/miniature-nostr-station.png',
    position: { x: 80, y: 66 },
    size: { width: 100 }
  },
  {
    id: 'plaza',
    name: 'Plaza',
    image: '/assets/map/miniature-plaza.png',
    position: { x: 47.5, y: 46 },
    size: { width: 120 }
  },
  {
    id: 'town',
    name: 'Town',
    image: '/assets/map/miniature-town.png',
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
  const [imageDimensions, setImageDimensions] = useState<Record<string, ImageDimensions>>({});
  const [loadingImages, setLoadingImages] = useState<Set<string>>(new Set());

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

  if (!isMapModalOpen) return null;

  const handleLocationClick = (locationId: LocationId) => {
    console.log(`Clicked location: ${locationId}`);

    // Set the new location and close modal for all locations
    setCurrentLocation(locationId);
    setIsMapModalOpen(false);
  };

  const handleCloseModal = () => {
    setIsMapModalOpen(false);
  };

  return (
    <div
      className={cn(
        "absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-2",
        className
      )}
      onClick={(e) => {
        // Close modal when clicking on backdrop
        if (e.target === e.currentTarget) {
          handleCloseModal();
        }
      }}
    >
      <div
        className="relative w-full h-full max-w-[95%] max-h-[95%] bg-transparent flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={handleCloseModal}
          className={cn(
            "absolute top-2 right-2 z-50",
            "bg-white/80 hover:bg-white/90 backdrop-blur-sm rounded-full",
            "h-8 w-8 shadow-lg hover:shadow-xl",
            "transition-all duration-200 ease-out",
            "hover:scale-105 active:scale-95",
            "text-foreground hover:text-red-500",
            "flex items-center justify-center"
          )}
          title="Close Map"
          aria-label="Close Map"
        >
          <IconX className="w-3 h-3" />
        </button>



        {/* Map Container */}
        <div
          ref={mapContainerRef}
          className="relative w-full h-full flex items-center justify-center"
        >
          {/* Island Map Background */}
          <img
            src="/assets/blobbi-island.png"
            alt="Blobbi Village Map"
            className="max-w-full max-h-full object-contain drop-shadow-2xl transition-all duration-500 ease-in-out"
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              width: 'auto',
              height: 'auto'
            }}
          />

          {/* Location Overlays */}
          {LOCATIONS.map((location) => {
            const finalSize = calculateFinalSize(location);
            const isImageLoading = loadingImages.has(location.image);

            return (
              <button
                key={location.id}
                onClick={() => handleLocationClick(location.id)}
                onMouseEnter={() => setHoveredLocation(location.id)}
                onMouseLeave={() => setHoveredLocation(null)}
                className={cn(
                  "absolute transform -translate-x-1/2 -translate-y-1/2",
                  "transition-all duration-300 ease-out",
                  "cursor-pointer",
                  "hover:z-20",
                  "rounded-lg",
                  "active:scale-95",
                  hoveredLocation === location.id && "scale-110 drop-shadow-2xl z-20",
                  isImageLoading && "opacity-50", // Show loading state
                )}
                style={{
                  left: `${location.position.x}%`,
                  top: `${location.position.y}%`,
                  width: finalSize.width,
                  height: finalSize.height,
                }}
                title={location.name}
                aria-label={`Go to ${location.name}`}
                disabled={isImageLoading}
              >
              {isImageLoading ? (
                <div className="w-full h-full flex items-center justify-center bg-gray-200 dark:bg-gray-700 rounded-lg">
                  <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
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

              {/* Location Label (appears on hover) */}
              <div
                className={cn(
                  "absolute left-1/2 transform -translate-x-1/2 top-full mt-2",
                  "bg-black/90 text-white text-xs font-medium px-3 py-1.5 rounded-full",
                  "transition-all duration-300 ease-out",
                  "whitespace-nowrap border border-white/20",
                  "backdrop-blur-sm",
                  hoveredLocation === location.id
                    ? "opacity-100 translate-y-0"
                    : "opacity-0 translate-y-2"
                )}
              >
                {location.name}
                {currentLocation === location.id && " (Current)"}
              </div>
            </button>
          );})}


        </div>

        {/* Instructions */}
        <div className="absolute top-2 left-1 transform z-10 px-2">
          <div className="bg-white/95 backdrop-blur-sm border border-border rounded-full px-3 sm:px-6 py-2 sm:py-3 shadow-xl max-w-[90vw]">
            <p className="text-xs sm:text-sm text-muted-foreground text-center font-medium">
              🏝️ Click on a location to travel there • Current location is {`${currentLocation}`}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}