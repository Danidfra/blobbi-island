import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { MovableBlobbi, MovableBlobbiRef } from './MovableBlobbi';
import { locationBoundaries } from '@/lib/location-boundaries';
import { getBlobbiInitialPosition } from '@/lib/location-initial-position';
import { IconX, IconCamera, IconShare } from '@tabler/icons-react';
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
  onOpenSocialShare?: (capturedPhoto: string, capturedPolaroidSrc: string | null) => void;
}

export function PhotoBoothModal({ isOpen, onClose, selectedBlobbi, onOpenSocialShare }: PhotoBoothModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const internalBlobbiRef = useRef<MovableBlobbiRef>(null);
  const { setPhotoBoothOpen } = usePhotoBooth();
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [capturedPolaroidSrc, setCapturedPolaroidSrc] = useState<string | null>(null);
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
      zoom: 2.2,        // Zoom level for background (0.8 = 80% of original size)
      offsetX: 0,       // Horizontal offset (-50 = 50px left, 50 = 50px right)
      offsetY: -68,     // Vertical offset (-50 = 50px up, 50 = 50px down)
    },
    // Blobbi character settings
    blobbi: {
      zoom: 1.06,        // Zoom level for Blobbi (1.2 = 120% of original size)
      offsetX: 0,       // Horizontal offset relative to background center
      offsetY: 68,      // Vertical offset relative to background center
    }
  };

const handleCapturePhoto = async () => {
  if (!containerRef.current || !selectedBlobbi) return;

  setIsCapturing(true);

  try {
    // -------- HiDPI / quality ----------
    const EXPORT_SCALE = Math.min(3, Math.max(window.devicePixelRatio || 1, 2)); // 2x to 3x is a good balance

    // Final canvas size (in CSS px)
    const cssW = photoCompositionConfig.polaroid.width;
    const cssH = photoCompositionConfig.polaroid.height;

    const finalCanvas = document.createElement('canvas');
    // Internal canvas size in real pixels (HiDPI)
    finalCanvas.width = Math.round(cssW * EXPORT_SCALE);
    finalCanvas.height = Math.round(cssH * EXPORT_SCALE);

    const finalCtx = finalCanvas.getContext('2d');
    if (!finalCtx) {
      console.error('Failed to get canvas context');
      return;
    }

    // Draw in CSS px coordinates, but at higher resolution for sharpness
    finalCtx.scale(EXPORT_SCALE, EXPORT_SCALE);
    finalCtx.imageSmoothingEnabled = true;
    finalCtx.imageSmoothingQuality = 'high';

    // ---------- Background ----------
    const backgroundImage = new Image();
    backgroundImage.crossOrigin = 'anonymous';
    await new Promise<void>((resolve, reject) => {
      backgroundImage.onload = () => resolve();
      backgroundImage.onerror = reject;
      backgroundImage.src = photoCompositionConfig.background.imagePath;
    });

    const bgZoom = photoCompositionConfig.background.zoom;
    const bgWidth =
      (backgroundImage.naturalWidth || backgroundImage.width) *
      bgZoom *
      (cssW / (backgroundImage.naturalWidth || backgroundImage.width));
    const bgHeight =
      (backgroundImage.naturalHeight || backgroundImage.height) *
      bgZoom *
      (cssH / (backgroundImage.naturalHeight || backgroundImage.height));

    // Center + offset (all in CSS px)
    const bgX = (cssW - bgWidth) / 2 + photoCompositionConfig.background.offsetX;
    const bgY = (cssH - bgHeight) / 2 + photoCompositionConfig.background.offsetY;

    finalCtx.drawImage(backgroundImage, bgX, bgY, bgWidth, bgHeight);

    // ---------- Container dimensions for accessory positioning ----------
    const containerRect = containerRef.current.getBoundingClientRect();

    // Get actual background image element and its position within container
    const backgroundImg = containerRef.current.querySelector('img[src*="photo-booth-inside.png"]') as HTMLImageElement;
    const backgroundRect = backgroundImg?.getBoundingClientRect();

    if (!backgroundRect) {
      console.error('Background image not found');
      return;
    }

    // Calculate background image dimensions
    const bgActualWidth = backgroundRect.width;
    const bgActualHeight = backgroundRect.height;

    // Calculate background image offset within container (due to object-contain centering)
    const bgOffsetX = (containerRect.width - bgActualWidth) / 2;
    const bgOffsetY = (containerRect.height - bgActualHeight) / 2;

    // ---------- Blobbi (SVG -> high-res bitmap) ----------
    const blobbiElement = containerRef.current.querySelector('.blobbi-character');
    if (blobbiElement) {
      const svgElement = blobbiElement.querySelector('svg');
      if (svgElement) {
        const cloned = svgElement.cloneNode(true) as SVGSVGElement;
        const br = blobbiElement.getBoundingClientRect();
        cloned.setAttribute('width', String(br.width));
        cloned.setAttribute('height', String(br.height));
        if (!cloned.getAttribute('viewBox') && svgElement.getAttribute('viewBox')) {
          cloned.setAttribute('viewBox', svgElement.getAttribute('viewBox')!);
        }

        const svgData = new XMLSerializer().serializeToString(cloned);
        const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
        const svgUrl = URL.createObjectURL(svgBlob);

        const blobbiImage = new Image();
        blobbiImage.crossOrigin = 'anonymous';

        await new Promise<void>((resolve, reject) => {
          blobbiImage.onload = () => {
            resolve();
          };
          blobbiImage.onerror = reject;
          blobbiImage.src = svgUrl;
        });

        const blobbiZoom = photoCompositionConfig.blobbi.zoom;
        const blobbiWidth = br.width * blobbiZoom;
        const blobbiHeight = br.height * blobbiZoom;

        const blobbiX =
          bgX + (bgWidth - blobbiWidth) / 2 + photoCompositionConfig.blobbi.offsetX;
        const blobbiY =
          bgY + (bgHeight - blobbiHeight) / 2 + photoCompositionConfig.blobbi.offsetY;

        finalCtx.drawImage(blobbiImage, blobbiX, blobbiY, blobbiWidth, blobbiHeight);
        URL.revokeObjectURL(svgUrl);
      }
    }

    // ---------- Accessories ----------
    for (const accessory of accessories) {
      const img = loadedImages[accessory.id];
      if (!img) continue;

      // Calculate position exactly like live preview (percentage-based)
      const containerPixelX = (accessory.position.x / 100) * containerRect.width;
      const containerPixelY = (accessory.position.y / 100) * containerRect.height;

      // Adjust for background image centering within container (object-contain behavior)
      const bgRelativeX = containerPixelX - bgOffsetX;
      const bgRelativeY = containerPixelY - bgOffsetY;

      // Map to final canvas background space
      const scaleX = bgWidth / bgActualWidth;
      const scaleY = bgHeight / bgActualHeight;

      const accessoryX = 35.3 + bgX + bgRelativeX * scaleX;
      const accessoryY = bgY - 2 + bgRelativeY * scaleY;

      // Calculate scale exactly like live preview (120px base * scale)
      const baseSize = 120; // Matches live preview base size
      const scaledSize = baseSize * (accessory.scale || 1);

      // Apply background scaling to maintain relative size
      const finalScale = Math.min(scaleX, scaleY);
      const finalWidth = scaledSize * finalScale;
      const finalHeight = scaledSize * finalScale;

      // Calculate image dimensions maintaining aspect ratio
      const imgAspect = (img.naturalWidth || img.width) / (img.naturalHeight || img.height);
      let drawWidth = finalWidth;
      let drawHeight = finalHeight;

      if (imgAspect > 1) {
        // Landscape image - constrain by width
        drawHeight = drawWidth / imgAspect;
      } else {
        // Portrait or square image - constrain by height
        drawWidth = drawHeight * imgAspect;
      }

      // Apply rotation and translation (matches live preview transform: translate(-50%, -50%) rotate())
      finalCtx.save();
      finalCtx.translate(accessoryX, accessoryY);
      finalCtx.rotate((accessory.rotation || 0) * Math.PI / 180);

      // Draw image centered at the position (matches translate(-50%, -50%))
      finalCtx.drawImage(img, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
      finalCtx.restore();
    }

    // ---------- Export ----------
    const photoDataUrl = finalCanvas.toDataURL('image/png');
    setCapturedPhoto(photoDataUrl);

    // ---------- Create Polaroid-framed version ----------
    try {
      // High-DPI / quality settings
      const EXPORT_SCALE = Math.min(3, Math.max(window.devicePixelRatio || 1, 2));

      // Target dimensions (matching CSS PolaroidFrame)
      const targetWidth = 500;

      // Polaroid frame margins (matching PolaroidFrame defaults)
      const margins = { top: 5, right: 4, bottom: 18, left: 4 };
      const aspectRatio = 3 / 4; // Rectangular aspect ratio for sharing

      // Calculate target height based on aspect ratio and margins
      const innerPhotoWidth = targetWidth * (1 - (margins.left + margins.right) / 100);
      const innerPhotoHeight = innerPhotoWidth / aspectRatio;
      const totalHeight = innerPhotoHeight / (1 - (margins.top + margins.bottom) / 100);

      // Create canvas with high resolution
      const polaroidCanvas = document.createElement('canvas');
      polaroidCanvas.width = Math.round(targetWidth * EXPORT_SCALE);
      polaroidCanvas.height = Math.round(totalHeight * EXPORT_SCALE);

      const polaroidCtx = polaroidCanvas.getContext('2d');
      if (!polaroidCtx) {
        console.error('Failed to get polaroid canvas context');
        return;
      }

      // Scale context for high DPI
      polaroidCtx.scale(EXPORT_SCALE, EXPORT_SCALE);
      polaroidCtx.imageSmoothingEnabled = true;
      polaroidCtx.imageSmoothingQuality = 'high';

      // Draw white frame background with rounded corners
      const frameRadius = 12;
      polaroidCtx.fillStyle = '#ffffff';
      polaroidCtx.beginPath();
      polaroidCtx.roundRect(0, 0, targetWidth, totalHeight, frameRadius);
      polaroidCtx.fill();

      // Add subtle border
      polaroidCtx.strokeStyle = '#e4e4e7';
      polaroidCtx.lineWidth = 1;
      polaroidCtx.stroke();

      // Calculate inner photo area dimensions using same margins as PolaroidFrame
      const photoAreaWidth = targetWidth * (1 - (margins.left + margins.right) / 100);
      const photoAreaHeight = totalHeight * (1 - (margins.top + margins.bottom) / 100);
      const photoAreaX = targetWidth * margins.left / 100;
      const photoAreaY = totalHeight * margins.top / 100;

      // Create rounded rectangle clipping path for photo area
      polaroidCtx.save();
      polaroidCtx.beginPath();
      polaroidCtx.roundRect(photoAreaX, photoAreaY, photoAreaWidth, photoAreaHeight, frameRadius * 0.8);
      polaroidCtx.clip();

      // Add subtle background for photo area
      polaroidCtx.fillStyle = 'rgba(0, 0, 0, 0.02)';
      polaroidCtx.fillRect(photoAreaX, photoAreaY, photoAreaWidth, photoAreaHeight);

      // Draw the captured photo inside the frame
      const photoImg = new Image();
      photoImg.crossOrigin = 'anonymous';

      await new Promise<void>((resolve, reject) => {
        photoImg.onload = () => resolve();
        photoImg.onerror = reject;
        photoImg.src = photoDataUrl;
      });

      // Draw photo to fit the photo area with cover behavior
      const photoAspect = photoImg.naturalWidth / photoImg.naturalHeight;
      const areaAspect = photoAreaWidth / photoAreaHeight;

      let drawWidth, drawHeight, drawX, drawY;

      if (photoAspect > areaAspect) {
        // Photo is wider than area - fit to width
        drawWidth = photoAreaWidth;
        drawHeight = photoAreaWidth / photoAspect;
        drawX = photoAreaX;
        drawY = photoAreaY + (photoAreaHeight - drawHeight) / 2;
      } else {
        // Photo is taller than area - fit to height
        drawHeight = photoAreaHeight;
        drawWidth = photoAreaHeight * photoAspect;
        drawX = photoAreaX + (photoAreaWidth - drawWidth) / 2;
        drawY = photoAreaY;
      }

      polaroidCtx.drawImage(photoImg, drawX, drawY, drawWidth, drawHeight);
      polaroidCtx.restore();

      // Export the complete polaroid-framed image
      const polaroidDataUrl = polaroidCanvas.toDataURL('image/png');
      setCapturedPolaroidSrc(polaroidDataUrl);
    } catch (error) {
      console.error('Error creating polaroid-framed image:', error);
    }
  } catch (error) {
    console.error('Error capturing photo:', error);
  } finally {
    setIsCapturing(false);
  }
};

  const handleRetakePhoto = () => {
    setCapturedPhoto(null);
    setCapturedPolaroidSrc(null);
  };

  if (!isOpen) return null;

  // If we have a captured photo, show the Polaroid preview
  if (capturedPhoto) {
    return (
      <>
        <div
          className={cn(
            "absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-2"
          )}
          onClick={handleBackdropClick}
        >
          <div
          className="relative w-[60%] h-full max-w-[95%] max-h-[95%] bg-transparent flex items-center justify-center"
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

            {/* Polaroid Preview - uses exact same composed image as ShareModal */}
            <div className="flex justify-center p-8">
              <div className="relative w-full max-w-[80%] aspect-[3/4]">
                {capturedPolaroidSrc ? (
                  <img
                    src={capturedPolaroidSrc}
                    alt="Captured Blobbi Photo"
                    className="w-full h-full object-contain rounded-2xl"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <div className="text-center">
                      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
                      <p className="text-sm text-muted-foreground">Processing polaroid...</p>
                    </div>
                  </div>
                )}

                {/* Action Buttons - absolutely positioned at bottom of polaroid wrapper */}
                <div className="absolute flex inset-x-0 bottom-10 translate-y-[16px] items-center justify-center">
                  <div className="flex flex-col gap-2 w-[70%]">
                    {/* Top row: Retake and Share buttons */}
                    <div className="flex gap-2">
                      <Button
                        onClick={handleRetakePhoto}
                        variant="outline"
                        className="flex-1 bg-white/95 backdrop-blur-sm border border-border hover:bg-white h-11 text-sm"
                      >
                        📷 Retake
                      </Button>
                      <Button
                        onClick={() => {
                          if (capturedPhoto && capturedPolaroidSrc) {
                            onOpenSocialShare?.(capturedPhoto, capturedPolaroidSrc);
                          }
                        }}
                        variant="outline"
                        className="flex-1 bg-white/95 backdrop-blur-sm border border-border hover:bg-white h-11 text-sm"
                      >
                        <IconShare className="w-4 h-4 mr-1" />
                        Share
                      </Button>
                    </div>

                    {/* Bottom row: Done button */}
                    <div className="flex">
                      <Button
                        onClick={onClose}
                        className="flex-1 bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-700 hover:to-pink-600 text-white h-11 text-sm"
                      >
                        ✨ Done
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
      </div>

      </>
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
              disableFloating={true} // Disable floating animation in photo booth
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