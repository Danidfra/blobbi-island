import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { MovableBlobbi, MovableBlobbiRef } from './MovableBlobbi';
import { locationBoundaries } from '@/lib/location-boundaries';
import { getBlobbiInitialPosition } from '@/lib/location-initial-position';
import { IconX, IconCamera } from '@tabler/icons-react';
import { usePhotoBooth } from '@/hooks/usePhotoBooth';
import type { Blobbi } from '@/hooks/useBlobbis';
import { Button } from '@/components/ui/button';

interface Accessory {
  id: string;
  name: string;
  imagePath: string;
  position: { x: number; y: number };
  isDragging: boolean;
  isResizing: boolean;
  isRotating: boolean;
  originalSize: { width: number; height: number };
  scale: number;
  rotation: number;
}

interface PhotoBoothModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedBlobbi: Blobbi | null;
}

export function PhotoBoothModal({ isOpen, onClose, selectedBlobbi }: PhotoBoothModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const internalBlobbiRef = useRef<MovableBlobbiRef>(null);
  const { setPhotoBoothOpen } = usePhotoBooth();
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  // Accessory state
  const [accessories, setAccessories] = useState<Accessory[]>([]);
  const [draggingAccessory, setDraggingAccessory] = useState<string | null>(null);
  const [rotatingAccessory, setRotatingAccessory] = useState<string | null>(null);
  const [loadedImages, setLoadedImages] = useState<Record<string, HTMLImageElement>>({});
  const [selectedAccessory, setSelectedAccessory] = useState<string | null>(null);

  // Available accessories configuration
  const availableAccessories = useMemo(() => [
    { id: 'hat', name: 'Hat', imagePath: '/assets/scenario/shop/photo-booth/hat.png' },
    { id: 'glasses', name: 'Glasses', imagePath: '/assets/scenario/shop/photo-booth/glasses.png' },
    { id: 'mouth', name: 'Mouth', imagePath: '/assets/scenario/shop/photo-booth/mouth.png' },
    { id: 'chat-balloon', name: 'Chat Balloon', imagePath: '/assets/scenario/shop/photo-booth/chat-balloon.png' },
    { id: 'mustache', name: 'Mustache', imagePath: '/assets/scenario/shop/photo-booth/mustache.png' },
    { id: 'party-hat', name: 'Party Hat', imagePath: '/assets/scenario/shop/photo-booth/party-hat.png' },
    { id: 'tiara', name: 'Tiara', imagePath: '/assets/scenario/shop/photo-booth/tiara.png' },
  ], []);

  // Use centralized boundary system
  const backgroundFile = 'photo-booth-inside.png';
  const boundary = locationBoundaries[backgroundFile] || {
    shape: 'rectangle',
    x: [0, 100],
    y: [60, 100],
  };
  const blobbiInitialPosition = getBlobbiInitialPosition(backgroundFile);

  // Preload accessory images
  useEffect(() => {
    if (!isOpen) return;

    const loadImages = async () => {
      const images: Record<string, HTMLImageElement> = {};

      for (const accessory of availableAccessories) {
        const img = new Image();
        img.crossOrigin = 'anonymous';

        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = reject;
          img.src = accessory.imagePath;
        });

        images[accessory.id] = img;
      }

      setLoadedImages(images);
    };

    loadImages();
  }, [isOpen, availableAccessories]);

  // Reset accessories when modal opens
  useEffect(() => {
    if (isOpen) {
      setAccessories([]);
      setDraggingAccessory(null);
    }
  }, [isOpen]);

  // Get accessory position relative to container
  const getAccessoryPosition = useCallback((accessoryId: string, clientX: number, clientY: number) => {
    if (!containerRef.current) return { x: 0, y: 0 };

    const containerRect = containerRef.current.getBoundingClientRect();
    const x = ((clientX - containerRect.left) / containerRect.width) * 100;
    const y = ((clientY - containerRect.top) / containerRect.height) * 100;

    return { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) };
  }, []);

  // Handle accessory drag start
  const handleAccessoryDragStart = useCallback((accessoryId: string, clientX: number, clientY: number) => {
    setDraggingAccessory(accessoryId);

    // Add new accessory to the photo area if not already there
    if (!accessories.find(a => a.id === accessoryId)) {
      const position = getAccessoryPosition(accessoryId, clientX, clientY);
      const accessoryConfig = availableAccessories.find(a => a.id === accessoryId);

      if (accessoryConfig && loadedImages[accessoryId]) {
        const img = loadedImages[accessoryId];
        setAccessories(prev => [...prev, {
          id: accessoryId,
          name: accessoryConfig.name,
          imagePath: accessoryConfig.imagePath,
          position,
          isDragging: true,
          isResizing: false,
          isRotating: false,
          originalSize: { width: img.width, height: img.height },
          scale: 1.0,
          rotation: 0
        }]);
      }
    } else {
      // Update existing accessory dragging state
      setAccessories(prev => prev.map(a =>
        a.id === accessoryId ? { ...a, isDragging: true } : a
      ));
    }
  }, [accessories, availableAccessories, loadedImages, getAccessoryPosition]);

  // Handle accessory drag
  const handleAccessoryDrag = useCallback((clientX: number, clientY: number) => {
    if (!draggingAccessory || !containerRef.current) return;

    const position = getAccessoryPosition(draggingAccessory, clientX, clientY);

    setAccessories(prev => prev.map(a =>
      a.id === draggingAccessory ? { ...a, position } : a
    ));
  }, [draggingAccessory, getAccessoryPosition]);

  // Handle accessory drag end
  const handleAccessoryDragEnd = useCallback(() => {
    if (!draggingAccessory) return;

    setAccessories(prev => prev.map(a =>
      a.id === draggingAccessory ? { ...a, isDragging: false } : a
    ));
    setDraggingAccessory(null);
  }, [draggingAccessory]);

  // Handle accessory removal (double click)
  const handleAccessoryRemove = useCallback((accessoryId: string) => {
    setAccessories(prev => prev.filter(a => a.id !== accessoryId));
  }, []);

  // Handle accessory rotation start
  const handleAccessoryRotateStart = useCallback((accessoryId: string, _clientX: number, _clientY: number) => {
    setRotatingAccessory(accessoryId);
    setAccessories(prev => prev.map(a =>
      a.id === accessoryId ? { ...a, isRotating: true } : a
    ));
  }, []);

  // Handle accessory rotation
  const handleAccessoryRotate = useCallback((clientX: number, clientY: number) => {
    if (!rotatingAccessory || !containerRef.current) return;

    const accessory = accessories.find(a => a.id === rotatingAccessory);
    if (!accessory) return;

    const accessoryElement = document.querySelector(`[data-accessory-id="${rotatingAccessory}"]`);
    if (!accessoryElement) return;

    const accessoryRect = accessoryElement.getBoundingClientRect();
    const centerX = accessoryRect.left + accessoryRect.width / 2;
    const centerY = accessoryRect.top + accessoryRect.height / 2;

    // Calculate angle from center to mouse position
    const angle = Math.atan2(clientY - centerY, clientX - centerX);
    const degrees = (angle * 180) / Math.PI;

    setAccessories(prev => prev.map(a =>
      a.id === rotatingAccessory ? { ...a, rotation: degrees } : a
    ));
  }, [rotatingAccessory, accessories]);

  // Handle accessory rotation end
  const handleAccessoryRotateEnd = useCallback(() => {
    if (!rotatingAccessory) return;

    setAccessories(prev => prev.map(a =>
      a.id === rotatingAccessory ? { ...a, isRotating: false } : a
    ));
    setRotatingAccessory(null);
  }, [rotatingAccessory]);

  // Handle accessory selection
  const handleAccessorySelect = useCallback((accessoryId: string) => {
    setSelectedAccessory(accessoryId);
  }, []);

  // Handle size change via controller
  const handleSizeChange = useCallback((accessoryId: string, newScale: number) => {
    setAccessories(prev => prev.map(a =>
      a.id === accessoryId ? { ...a, scale: Math.max(0, Math.min(1, newScale)) } : a
    ));
  }, []);

  // Handle rotation change via controller
  const handleRotationChange = useCallback((accessoryId: string, newRotation: number) => {
    setAccessories(prev => prev.map(a =>
      a.id === accessoryId ? { ...a, rotation: newRotation } : a
    ));
  }, []);

  // Get selected accessory data
  const selectedAccessoryData = accessories.find(a => a.id === selectedAccessory);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Set Photo Booth state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setPhotoBoothOpen(true);
    } else {
      setPhotoBoothOpen(false);
    }
  }, [isOpen, setPhotoBoothOpen]);

  // Global drag and resize event listeners
  useEffect(() => {
    if (!isOpen) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (draggingAccessory) {
        handleAccessoryDrag(e.clientX, e.clientY);
      } else if (rotatingAccessory) {
        handleAccessoryRotate(e.clientX, e.clientY);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (draggingAccessory && e.touches.length > 0) {
        handleAccessoryDrag(e.touches[0].clientX, e.touches[0].clientY);
      } else if (rotatingAccessory && e.touches.length > 0) {
        handleAccessoryRotate(e.touches[0].clientX, e.touches[0].clientY);
      }
    };

    const handleMouseUp = () => {
      if (draggingAccessory) {
        handleAccessoryDragEnd();
      } else if (rotatingAccessory) {
        handleAccessoryRotateEnd();
      }
    };

    const handleTouchEnd = () => {
      if (draggingAccessory) {
        handleAccessoryDragEnd();
      } else if (rotatingAccessory) {
        handleAccessoryRotateEnd();
      }
    };

    // Add event listeners
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchend', handleTouchEnd);

    return () => {
      // Clean up event listeners
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isOpen, draggingAccessory, rotatingAccessory, handleAccessoryDrag, handleAccessoryDragEnd, handleAccessoryRotate, handleAccessoryRotateEnd]);

  // Handle keyboard events for modal-local Blobbi movement
  useEffect(() => {
    if (!isOpen || !selectedBlobbi) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent default behavior for movement keys
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        e.stopPropagation();

        // Calculate movement direction
        let deltaX = 0;
        let deltaY = 0;
        const moveAmount = 2; // Small movement amount

        switch (e.key.toLowerCase()) {
          case 'arrowup':
          case 'w':
            deltaY = -moveAmount;
            break;
          case 'arrowdown':
          case 's':
            deltaY = moveAmount;
            break;
          case 'arrowleft':
          case 'a':
            deltaX = -moveAmount;
            break;
          case 'arrowright':
          case 'd':
            deltaX = moveAmount;
            break;
        }

        if (internalBlobbiRef.current) {
          const currentPos = internalBlobbiRef.current.getCurrentPosition?.() || blobbiInitialPosition;
          const newPos = {
            x: Math.max(36, Math.min(58, currentPos.x + deltaX)), // Constrain to booth boundaries
            y: Math.max(59, Math.min(63, currentPos.y + deltaY)), // Constrain to booth boundaries
          };
          internalBlobbiRef.current.goTo(newPos, true); // Immediate movement
        }
      }
    };

    // Add event listener with capture phase to prevent bubbling
    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isOpen, selectedBlobbi, blobbiInitialPosition]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only close if clicking the backdrop, not the modal content
    if (e.target === e.currentTarget && isOpen) {
      onClose();
    }
  };



  // Configuration for photo composition - easily adjustable
  const photoCompositionConfig = {
    // Polaroid frame settings
    polaroid: {
      width: 320,
      height: 320,
    },
    // Background image settings
    background: {
      imagePath: '/assets/places/photo-booth-inside.png',
      zoom: 0.8,        // Zoom level for background (0.8 = 80% of original size)
      offsetX: 0,       // Horizontal offset (-50 = 50px left, 50 = 50px right)
      offsetY: -30,     // Vertical offset (-50 = 50px up, 50 = 50px down)
    },
    // Blobbi character settings
    blobbi: {
      zoom: 1.2,        // Zoom level for Blobbi (1.2 = 120% of original size)
      offsetX: 0,       // Horizontal offset relative to background center
      offsetY: 20,      // Vertical offset relative to background center
    }
  };

  const handleCapturePhoto = async () => {
    if (!containerRef.current || !selectedBlobbi) return;

    setIsCapturing(true);

    try {
      // Create final canvas for Polaroid frame
      const finalCanvas = document.createElement('canvas');
      const finalCtx = finalCanvas.getContext('2d');

      if (!finalCtx) {
        console.error('Failed to get canvas context');
        return;
      }

      // Set canvas size to match Polaroid frame
      finalCanvas.width = photoCompositionConfig.polaroid.width;
      finalCanvas.height = photoCompositionConfig.polaroid.height;

      // Step 1: Load and draw the background image
      const backgroundImage = new Image();
      backgroundImage.crossOrigin = 'anonymous';

      await new Promise<void>((resolve, reject) => {
        backgroundImage.onload = () => resolve();
        backgroundImage.onerror = reject;
        backgroundImage.src = photoCompositionConfig.background.imagePath;
      });

      // Calculate background dimensions with zoom
      const bgZoom = photoCompositionConfig.background.zoom;
      const bgWidth = backgroundImage.width * bgZoom;
      const bgHeight = backgroundImage.height * bgZoom;

      // Calculate background position (centered with offsets)
      const bgX = (finalCanvas.width - bgWidth) / 2 + photoCompositionConfig.background.offsetX;
      const bgY = (finalCanvas.height - bgHeight) / 2 + photoCompositionConfig.background.offsetY;

      // Draw the background
      finalCtx.drawImage(backgroundImage, bgX, bgY, bgWidth, bgHeight);

      // Step 2: Get and draw the Blobbi character
      const blobbiElement = containerRef.current.querySelector('.blobbi-character');
      if (blobbiElement) {
        // Get the Blobbi's current SVG
        const svgElement = blobbiElement.querySelector('svg');
        if (svgElement) {
          // Create a temporary canvas for the Blobbi
          const blobbiCanvas = document.createElement('canvas');
          const blobbiCtx = blobbiCanvas.getContext('2d');

          if (blobbiCtx) {
            // Get Blobbi dimensions
            const blobbiRect = blobbiElement.getBoundingClientRect();
            blobbiCanvas.width = blobbiRect.width;
            blobbiCanvas.height = blobbiRect.height;

            try {
              // Convert SVG to image
              const svgData = new XMLSerializer().serializeToString(svgElement);
              const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
              const svgUrl = URL.createObjectURL(svgBlob);

              const blobbiImage = new Image();
              await new Promise<void>((resolve, reject) => {
                blobbiImage.onload = () => {
                  // Draw Blobbi to temporary canvas
                  blobbiCtx.drawImage(blobbiImage, 0, 0, blobbiRect.width, blobbiRect.height);
                  URL.revokeObjectURL(svgUrl);
                  resolve();
                };
                blobbiImage.onerror = reject;
                blobbiImage.src = svgUrl;
              });

              // Calculate Blobbi dimensions with zoom
              const blobbiZoom = photoCompositionConfig.blobbi.zoom;
              const blobbiWidth = blobbiRect.width * blobbiZoom;
              const blobbiHeight = blobbiRect.height * blobbiZoom;

              // Calculate Blobbi position (relative to background center with offsets)
              const blobbiX = bgX + (bgWidth - blobbiWidth) / 2 + photoCompositionConfig.blobbi.offsetX;
              const blobbiY = bgY + (bgHeight - blobbiHeight) / 2 + photoCompositionConfig.blobbi.offsetY;

              // Draw the Blobbi on top of the background
              finalCtx.drawImage(blobbiCanvas, blobbiX, blobbiY, blobbiWidth, blobbiHeight);

            } catch (error) {
              console.error('Error processing Blobbi:', error);
              // Fallback: draw a simple placeholder
              finalCtx.fillStyle = '#ff6b6b';
              const fallbackSize = 60;
              finalCtx.fillRect(
                (finalCanvas.width - fallbackSize) / 2,
                (finalCanvas.height - fallbackSize) / 2,
                fallbackSize,
                fallbackSize
              );
            }
          }
        }
      }

      // Step 3: Draw accessories on top of everything
      for (const accessory of accessories) {
        if (loadedImages[accessory.id]) {
          const img = loadedImages[accessory.id];

          // Calculate accessory position relative to background
          const containerRect = containerRef.current.getBoundingClientRect();
          const accessoryPixelX = (accessory.position.x / 100) * containerRect.width;
          const accessoryPixelY = (accessory.position.y / 100) * containerRect.height;

          // Scale accessory position to final canvas
          const scaleX = bgWidth / containerRect.width;
          const scaleY = bgHeight / containerRect.height;

          const accessoryX = bgX + (accessoryPixelX * scaleX);
          const accessoryY = bgY + (accessoryPixelY * scaleY);

          // Draw accessory with high resolution and scale
          const devicePixelRatio = window.devicePixelRatio || 1;
          const scaledWidth = (img.width * accessory.scale) / devicePixelRatio;
          const scaledHeight = (img.height * accessory.scale) / devicePixelRatio;

          const accessoryWidth = scaledWidth * scaleX;
          const accessoryHeight = scaledHeight * scaleY;

          // Center the accessory on the position
          const centeredX = accessoryX - (accessoryWidth / 2);
          const centeredY = accessoryY - (accessoryHeight / 2);

          finalCtx.drawImage(img, centeredX, centeredY, accessoryWidth, accessoryHeight);
        }
      }

      // Convert final canvas to data URL
      const photoDataUrl = finalCanvas.toDataURL('image/png');
      setCapturedPhoto(photoDataUrl);

    } catch (error) {
      console.error('Error capturing photo:', error);
    } finally {
      setIsCapturing(false);
    }
  };

  const handleRetakePhoto = () => {
    setCapturedPhoto(null);
  };

  if (!isOpen) return null;

  // If we have a captured photo, show the Polaroid preview
  if (capturedPhoto) {
    return (
      <div
        className={cn(
          "absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-2"
        )}
        onClick={handleBackdropClick}
        style={{
          position: 'absolute',
        }}
      >
        {/* Polaroid Preview Container */}
        <div
          className="relative bg-transparent mx-auto"
          style={{
            width: '500px',
            height: '600px',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close Button */}
          <button
            onClick={onClose}
            className={cn(
              "absolute top-2 right-2 z-50",
              "bg-white/80 hover:bg-white/90 backdrop-blur-sm rounded-full",
              "h-8 w-8 shadow-lg hover:shadow-xl",
              "transition-all duration-200 ease-out",
              "hover:scale-105 active:scale-95",
              "text-foreground hover:text-red-500",
              "flex items-center justify-center"
            )}
            title="Close Photo Booth"
            aria-label="Close Photo Booth"
          >
            <IconX className="w-3 h-3" />
          </button>

          {/* Polaroid Frame */}
          <div className="relative w-full h-full">
            <img
              src="/assets/scenario/shop/polaroid-frame.png"
              alt="Polaroid Frame"
              className="w-full h-full object-contain drop-shadow-2xl"
            />

            {/* Captured Photo - positioned to fit inside the frame */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div
                className="w-[69%] h-[78%]"
                style={{
                  position: 'absolute',
                  top: '5%',
                  left: '50%',
                  transform: 'translate(-50%, 0%)',
                  borderRadius: '4px',
                  overflow: 'hidden',
                }}
              >
                <img
                  src={capturedPhoto}
                  alt="Captured Photo"
                  className="w-full h-full object-cover"
                  style={{
                    transformOrigin: 'center',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-10 flex gap-3">
            <Button
              onClick={handleRetakePhoto}
              variant="outline"
              className="bg-white/95 backdrop-blur-sm border border-border hover:bg-white"
            >
              📷 Retake Photo
            </Button>
            <Button
              onClick={onClose}
              className="bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-700 hover:to-pink-600 text-white"
            >
              ✨ Done
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-2"
      )}
      onClick={handleBackdropClick}
      style={{
        // Ensure this is positioned relative to the game container
        position: 'absolute',
      }}
    >
      {/* Main Container with Accessories List and Photo Booth */}
      <div
        className="relative bg-transparent"
        style={{
          width: '650px',
          height: '705px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Accessories List - Left Side (Absolute Positioned) */}
        <div
          className="absolute -left-12 top-1/2 transform -translate-y-1/2 bottom-0 w-32 bg-white/90 backdrop-blur-sm rounded-lg p-3 shadow-xl border border-purple-200/60 dark:border-purple-800/60 flex flex-col z-30 overflow-hidden"
          style={{ height: '90%' }}
        >
          <h3 className="text-sm font-bold text-center mb-3 text-purple-700 dark:text-purple-300 flex-shrink-0">
            Accessories
          </h3>
          <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-2 py-2">
            {availableAccessories.map((accessory) => (
              <div
                key={accessory.id}
                className={cn(
                  "relative group cursor-grab active:cursor-grabbing mx-auto w-[90%]",
                  "bg-white/80 hover:bg-white border border-purple-200/60 dark:border-purple-800/60 rounded-lg p-2",
                  "transition-all duration-200 hover:scale-105 active:scale-95",
                  "flex flex-col items-center gap-1 flex-shrink-0",
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleAccessoryDragStart(accessory.id, e.clientX, e.clientY);
                  handleAccessorySelect(accessory.id);
                }}
                onTouchStart={(e) => {
                  e.preventDefault();
                  if (e.touches.length > 0) {
                    handleAccessoryDragStart(accessory.id, e.touches[0].clientX, e.touches[0].clientY);
                    handleAccessorySelect(accessory.id);
                  }
                }}
                title={`Drag ${accessory.name} onto the photo`}
              >
                <div className="w-12 h-12 flex items-center justify-center">
                  {loadedImages[accessory.id] ? (
                    <img
                      src={accessory.imagePath}
                      alt={accessory.name}
                      className="w-full h-full object-contain"
                      draggable={false}
                    />
                  ) : (
                    <div className="w-full h-full bg-purple-100 dark:bg-purple-900 rounded animate-pulse" />
                  )}
                </div>
                <span className="text-xs text-center text-muted-foreground font-medium">
                  {accessory.name}
                </span>
                {accessories.find(a => a.id === accessory.id) && (
                  <div className="absolute top-1 right-1 w-2 h-2 bg-green-500 rounded-full" />
                )}
                {selectedAccessory === accessory.id && (
                  <div className="absolute -top-1 -left-1 -right-1 -bottom-1 border-2 border-blue-500 rounded-lg pointer-events-none" />
                )}
              </div>
            ))}
          </div>
          <div className="mt-3 text-xs text-muted-foreground text-center flex-shrink-0">
            <p>Drag to photo area</p>
            <p className="text-xs opacity-60">Double-click to remove</p>
            <p className="text-xs opacity-60 mt-1">Click to select & rotate</p>
          </div>
        </div>

        {/* Size Controller Panel - Right Side (Absolute Positioned) */}
        {selectedAccessoryData && (
          <div className="absolute -right-20 top-1/2 transform -translate-y-1/2 w-40 bg-white/90 backdrop-blur-sm rounded-lg p-4 shadow-xl border border-purple-200/60 dark:border-purple-800/60 flex flex-col z-30" style={{ height: '40%' }}>
            <h3 className="text-sm font-bold text-center mb-4 text-purple-700 dark:text-purple-300 flex-shrink-0">
              Size Control
            </h3>
            <div className="flex-1 flex flex-col justify-center space-y-4">
              <div className="text-center">
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  {selectedAccessoryData.name}
                </p>
                <div className="w-16 h-16 mx-auto mb-3 flex items-center justify-center">
                  {loadedImages[selectedAccessoryData.id] && (
                    <img
                      src={selectedAccessoryData.imagePath}
                      alt={selectedAccessoryData.name}
                      className="w-full h-full object-contain"
                      style={{
                        transform: `scale(${selectedAccessoryData.scale}) rotate(${selectedAccessoryData.rotation}deg)`,
                        transformOrigin: 'center',
                      }}
                      draggable={false}
                    />
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-2">
                    Size: {Math.round(selectedAccessoryData.scale * 100)}%
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={selectedAccessoryData.scale * 100}
                    onChange={(e) => handleSizeChange(selectedAccessoryData.id, parseInt(e.target.value) / 100)}
                    className="w-full h-2 bg-purple-200 rounded-lg appearance-none cursor-pointer dark:bg-purple-700"
                    style={{
                      background: `linear-gradient(to right, #a855f7 0%, #a855f7 ${selectedAccessoryData.scale * 100}%, #e5e7eb ${selectedAccessoryData.scale * 100}%, #e5e7eb 100%)`
                    }}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-2">
                    Rotation: {Math.round(selectedAccessoryData.rotation)}°
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="360"
                    value={selectedAccessoryData.rotation}
                    onChange={(e) => handleRotationChange(selectedAccessoryData.id, parseInt(e.target.value))}
                    className="w-full h-2 bg-green-200 rounded-lg appearance-none cursor-pointer dark:bg-green-700"
                    style={{
                      background: `linear-gradient(to right, #10b981 0%, #10b981 ${(selectedAccessoryData.rotation / 360) * 100}%, #e5e7eb ${(selectedAccessoryData.rotation / 360) * 100}%, #e5e7eb 100%)`
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Photo Booth Container - Centered */}
        <div
          className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-transparent"
          style={{
            width: '470px',
            height: '705px',
          }}
        >
        {/* Close Button */}
        <button
          onClick={onClose}
          className={cn(
            "absolute top-2 right-2 z-50",
            "bg-white/80 hover:bg-white/90 backdrop-blur-sm rounded-full",
            "h-8 w-8 shadow-lg hover:shadow-xl",
            "transition-all duration-200 ease-out",
            "hover:scale-105 active:scale-95",
            "text-foreground hover:text-red-500",
            "flex items-center justify-center"
          )}
          title="Close Photo Booth"
          aria-label="Close Photo Booth"
        >
          <IconX className="w-3 h-3" />
        </button>

        {/* Photo Booth Background - Exact size */}
        <div ref={containerRef} className="relative w-full h-full">
          <img
            src="/assets/places/photo-booth-inside.png"
            alt="Photo Booth Interior"
            className="w-full h-full object-contain drop-shadow-2xl"
            style={{
              width: '470px',
              height: '705px',
            }}
          />

          {/* Movable Blobbi inside booth - increased size */}
          {selectedBlobbi && (
            <MovableBlobbi
              ref={internalBlobbiRef}
              containerRef={containerRef}
              boundary={boundary}
              isVisible={!!selectedBlobbi}
              initialPosition={blobbiInitialPosition}
              backgroundFile={backgroundFile}
              size="xl" // Increased size for modal
              scaleByYPosition={true}
            />
          )}

          {/* Draggable Accessories in Photo Area */}
          {accessories.map((accessory) => (
            <div
              key={accessory.id}
              data-accessory-id={accessory.id}
              className={cn(
                "absolute select-none",
                accessory.isDragging && "opacity-80 scale-105 z-50",
                accessory.isResizing && "z-50",
                "z-40" // Ensure accessories are above Blobbi
              )}
              style={{
                left: `${accessory.position.x}%`,
                top: `${accessory.position.y}%`,
                transform: `translate(-50%, -50%) rotate(${accessory.rotation}deg)`,
                transition: (accessory.isDragging || accessory.isRotating) ? 'none' : 'all 0.2s ease',
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleAccessorySelect(accessory.id);
                // Check if clicking on rotation handle
                const target = e.target as HTMLElement;
                if (target.classList.contains('rotation-handle')) {
                  handleAccessoryRotateStart(accessory.id, e.clientX, e.clientY);
                } else {
                  handleAccessoryDragStart(accessory.id, e.clientX, e.clientY);
                }
              }}
              onTouchStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleAccessorySelect(accessory.id);
                if (e.touches.length === 1) {
                  // Single touch for dragging
                  const target = e.target as HTMLElement;
                  if (target.classList.contains('rotation-handle')) {
                    handleAccessoryRotateStart(accessory.id, e.touches[0].clientX, e.touches[0].clientY);
                  } else {
                    handleAccessoryDragStart(accessory.id, e.touches[0].clientX, e.touches[0].clientY);
                  }
                }
              }}
              onDoubleClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleAccessoryRemove(accessory.id);
              }}
            >
              {loadedImages[accessory.id] && (
                <div className="relative">
                  <img
                    src={accessory.imagePath}
                    alt={accessory.name}
                    className="max-w-none pointer-events-none"
                    style={{
                      width: 'auto',
                      height: 'auto',
                      maxWidth: `${120 * accessory.scale}px`,
                      maxHeight: `${120 * accessory.scale}px`,
                    }}
                    draggable={false}
                  />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Take Photo Button */}
        <div className="absolute bottom-20 left-1/2 transform -translate-x-1/2 z-10">
          <Button
            onClick={handleCapturePhoto}
            disabled={isCapturing || !selectedBlobbi}
            className={cn(
              "bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-700 hover:to-pink-600",
              "text-white font-medium shadow-lg hover:shadow-xl",
              "transition-all duration-200 ease-out",
              "hover:scale-105 active:scale-95",
              "px-6 py-3 rounded-full",
              isCapturing && "opacity-50 cursor-not-allowed"
            )}
          >
            {isCapturing ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Capturing...
              </>
            ) : (
              <>
                <IconCamera className="w-4 h-4 mr-2" />
                Take Photo
              </>
            )}
          </Button>
        </div>

        {/* Instructions */}
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-10">
          <div className="bg-white/95 backdrop-blur-sm border border-border rounded-full px-4 py-2 shadow-xl">
            <p className="text-xs text-muted-foreground text-center font-medium">
              📸 Move Blobbi • Drag accessories • Click to select & rotate • Double-click to remove
            </p>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}