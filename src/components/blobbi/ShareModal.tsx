import React, { useState } from 'react';
import { IconX, IconDownload, IconShare, IconSend } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/useToast';
import { useUploadFile } from '@/hooks/useUploadFile';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { cn } from '@/lib/utils';
import { PolaroidFrame as _PolaroidFrame } from '@/components/ui/PolaroidFrame';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  capturedPhoto: string;
  capturedPolaroidSrc: string | null;
}

export function ShareModal({ isOpen, onClose, capturedPhoto: _capturedPhoto, capturedPolaroidSrc }: ShareModalProps) {
  const { toast } = useToast();
  const { mutateAsync: uploadFile } = useUploadFile();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const { config, presetRelays } = useAppContext();
  const { user } = useCurrentUser();

  const [selectedRelays, setSelectedRelays] = useState<string[]>([config.relayUrl]);
  const [isSharing, setIsSharing] = useState(false);

  const handleDownload = async () => {
    if (!capturedPolaroidSrc) {
      toast({
        title: "Photo not available",
        description: "Polaroid image is not available. Please take a new photo.",
        variant: "destructive",
      });
      return;
    }

    try {
      // Create a download link
      const link = document.createElement('a');
      link.href = capturedPolaroidSrc;
      link.download = `blobbi-polaroid-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast({
        title: "Photo downloaded! 📸",
        description: "Your Blobbi polaroid has been saved to your device.",
      });
    } catch {
      toast({
        title: "Download failed",
        description: "Could not download the photo. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleWebShare = async () => {
    if (!navigator.share) {
      toast({
        title: "Web Share API not available",
        description: "Your browser doesn't support the Web Share API.",
        variant: "destructive",
      });
      return;
    }

    if (!capturedPolaroidSrc) {
      toast({
        title: "Photo not available",
        description: "Polaroid image is not available. Please take a new photo.",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsSharing(true);

      // Convert polaroid data URL to blob
      const response = await fetch(capturedPolaroidSrc);
      const blob = await response.blob();
      const file = new File([blob], 'blobbi-polaroid.png', { type: 'image/png' });

      await navigator.share({
        title: 'My Blobbi Polaroid! 📸',
        text: 'Check out this awesome polaroid I took at Blobbi Island!',
        files: [file]
      });

      toast({
        title: "Photo shared! 🎉",
        description: "Your Blobbi polaroid has been shared successfully.",
      });
    } catch {
      if (typeof navigator.share !== 'undefined') {
        toast({
          title: "Share cancelled",
          description: "The share operation was cancelled or failed.",
          variant: "destructive",
        });
      }
    } finally {
      setIsSharing(false);
    }
  };

  const handleNostrShare = async () => {
    if (!user) {
      toast({
        title: "Login required",
        description: "Please log in to share photos to Nostr.",
        variant: "destructive",
      });
      return;
    }

    if (!capturedPolaroidSrc) {
      toast({
        title: "Photo not available",
        description: "Polaroid image is not available. Please take a new photo.",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsSharing(true);

      // Convert polaroid data URL to blob for upload
      const response = await fetch(capturedPolaroidSrc);
      const blob = await response.blob();
      const file = new File([blob], 'blobbi-polaroid.png', { type: 'image/png' });

      // Upload file to Blossom server
      const fileTags = await uploadFile(file);

      // Create Nostr event with the image
      const content = `📸 Blobbi Island Polaroid!\n\nCheck out this awesome polaroid I took at Blobbi Island!`;

      // Add image tags
      const tags = [...fileTags];

      // Add alt tag for accessibility
      tags.push(['alt', 'A polaroid photo taken at Blobbi Island with accessories, background, and frame']);

      // Publish to selected relays
      await publishEvent({
        kind: 1, // Text note
        content,
        tags,
      });

      toast({
        title: "Photo shared to Nostr! 🚀",
        description: `Your polaroid has been published to ${selectedRelays.length} relay(s).`,
      });

      // Close modal after successful share
      onClose();
    } catch (error) {
      console.error('Error sharing to Nostr:', error);
      toast({
        title: "Share failed",
        description: "Could not share polaroid to Nostr. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSharing(false);
    }
  };

  const handleRelayToggle = (relayUrl: string, checked: boolean) => {
    if (checked) {
      setSelectedRelays(prev => [...prev, relayUrl]);
    } else {
      setSelectedRelays(prev => prev.filter(url => url !== relayUrl));
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && isOpen) {
      onClose();
    }
  };

  if (!isOpen) return null;

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
      {/* Share Modal Container */}
      <div
        className="relative bg-white/95 backdrop-blur-sm rounded-xl shadow-2xl border border-purple-200/60 dark:border-purple-800/60 max-w-md w-full mx-auto"
        style={{
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-purple-100 dark:border-purple-900">
          <h2 className="text-xl font-bold text-purple-700 dark:text-purple-300">
            Share Your Photo 📸
          </h2>
          <button
            onClick={onClose}
            className={cn(
              "bg-white/80 hover:bg-white/90 backdrop-blur-sm rounded-full",
              "h-8 w-8 shadow-lg hover:shadow-xl",
              "transition-all duration-200 ease-out",
              "hover:scale-105 active:scale-95",
              "text-foreground hover:text-red-500",
              "flex items-center justify-center"
            )}
            title="Close Share Modal"
            aria-label="Close Share Modal"
          >
            <IconX className="w-4 h-4" />
          </button>
        </div>

        {/* Photo Preview */}
        <div className="p-6">
          <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-4 mb-6 flex justify-center">
            {capturedPolaroidSrc ? (
              <div style={{ maxHeight: '400px' }}>
                <img
                  src={capturedPolaroidSrc}
                  alt="Captured Blobbi Photo"
                  className="h-auto rounded-lg shadow-md"
                  style={{ maxWidth: '150px', objectFit: 'contain' }}
                />
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-red-500 font-medium mb-2">❌ Polaroid image not available</p>
                <p className="text-sm text-muted-foreground">Please take a new photo to enable sharing.</p>
              </div>
            )}
          </div>

          {/* Share Options */}
          <div className="space-y-4">
            {/* Download Option */}
            <Button
              onClick={handleDownload}
              variant="outline"
              className="w-full justify-start h-auto p-4"
              disabled={isSharing || !capturedPolaroidSrc}
            >
              <div className="flex items-center space-x-3">
                <IconDownload className="w-5 h-5 text-blue-600" />
                <div className="text-left">
                  <div className="font-medium">Download Photo</div>
                  <div className="text-sm text-muted-foreground">Save as PNG to your device</div>
                </div>
              </div>
            </Button>

            {/* Web Share Option */}
            <Button
              onClick={handleWebShare}
              variant="outline"
              className="w-full justify-start h-auto p-4"
              disabled={isSharing || typeof navigator.share === 'undefined' || !capturedPolaroidSrc}
            >
              <div className="flex items-center space-x-3">
                <IconShare className="w-5 h-5 text-green-600" />
                <div className="text-left">
                  <div className="font-medium">Share to App</div>
                  <div className="text-sm text-muted-foreground">
                    {typeof navigator.share !== 'undefined' ? 'Use native share dialog' : 'Not supported in this browser'}
                  </div>
                </div>
              </div>
            </Button>

            {/* Nostr Share Option */}
            <div className="border border-purple-200 dark:border-purple-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-3">
                  <IconSend className="w-5 h-5 text-purple-600" />
                  <div className="text-left">
                    <div className="font-medium">Post to Nostr</div>
                    <div className="text-sm text-muted-foreground">Share to selected relays</div>
                  </div>
                </div>
                {!user && (
                  <span className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded">
                    Login required
                  </span>
                )}
              </div>

              {/* Relay Selection */}
              <div className="space-y-2 mt-3">
                <div className="text-sm font-medium text-muted-foreground">Select relays:</div>
                {presetRelays?.map((relay) => (
                  <div key={relay.url} className="flex items-center space-x-2">
                    <Checkbox
                      id={relay.url}
                      checked={selectedRelays.includes(relay.url)}
                      onCheckedChange={(checked) => handleRelayToggle(relay.url, checked as boolean)}
                      disabled={isSharing || !user}
                    />
                    <label
                      htmlFor={relay.url}
                      className={cn(
                        "text-sm cursor-pointer flex-1",
                        !user && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      <div className="font-medium">{relay.name}</div>
                      <div className="text-xs text-muted-foreground">{relay.url}</div>
                    </label>
                  </div>
                ))}
              </div>

              <Button
                onClick={handleNostrShare}
                className="w-full mt-4 bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-700 hover:to-pink-600 text-white"
                disabled={isSharing || !user || selectedRelays.length === 0 || !capturedPolaroidSrc}
              >
                {isSharing ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Sharing to Nostr...
                  </>
                ) : (
                  <>
                    <IconSend className="w-4 h-4 mr-2" />
                    Post to {selectedRelays.length} Relay{selectedRelays.length !== 1 ? 's' : ''}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-purple-100 dark:border-purple-900 bg-purple-50/50 dark:bg-purple-900/20">
          <p className="text-xs text-center text-muted-foreground">
            Your photo includes all accessories, background, and your Blobbi exactly as shown in the preview.
          </p>
        </div>
      </div>
    </div>
  );
}