import React, { useState, useEffect } from 'react';
import {
  IconX,
  IconDownload,
  IconShare,
  IconSend,
  IconChevronDown,
  IconChevronUp,
  IconBrandTwitter,
  IconBrandFacebook,
  IconBrandInstagram,
  IconBrandWhatsapp,
  IconBrandTelegram,
  IconBrandReddit,
  IconBrandLinkedin,
  IconCopy
} from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
  const [isRelayListExpanded, setIsRelayListExpanded] = useState(false);
  const [userText, setUserText] = useState('');
  const [isNostrSectionExpanded, setIsNostrSectionExpanded] = useState(false);
  const [isSocialPanelOpen, setIsSocialPanelOpen] = useState(false);

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

  const getPrefilledCaption = () => {
    const mandatoryHashtags = '#Blobbi #BlobbiIsland';
    return userText.trim() ? `${mandatoryHashtags} ${userText.trim()}` : mandatoryHashtags;
  };

  const toggleNostrSection = () => {
    setIsNostrSectionExpanded(!isNostrSectionExpanded);
  };

  const handleNostrSectionKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleNostrSection();
    }
  };

  const handleWebShare = async () => {
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

      // Check if Web Share API Level 2 is available (with files support)
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [] })) {
        // Convert polaroid data URL to blob
        const response = await fetch(capturedPolaroidSrc);
        const blob = await response.blob();
        const file = new File([blob], 'blobbi-polaroid.png', { type: 'image/png' });

        await navigator.share({
          title: 'My Blobbi Polaroid! 📸',
          text: getPrefilledCaption(),
          files: [file]
        });
      } else {
        // Fallback to opening social media panel
        setIsSocialPanelOpen(true);
        return;
      }

      toast({
        title: "Photo shared! 🎉",
        description: "Your Blobbi polaroid has been shared successfully.",
      });
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        // User cancelled or fallback needed
        setIsSocialPanelOpen(true);
      }
    } finally {
      setIsSharing(false);
    }
  };

  const handleSocialShare = async (platform: string) => {
    if (!capturedPolaroidSrc) {
      toast({
        title: "Photo not available",
        description: "Polaroid image is not available. Please take a new photo.",
        variant: "destructive",
      });
      return;
    }

    const caption = getPrefilledCaption();
    const pageUrl = window.location.href;
    const encodedCaption = encodeURIComponent(caption);
    const encodedUrl = encodeURIComponent(pageUrl);

    let shareUrl = '';

    switch (platform) {
      case 'twitter':
        shareUrl = `https://twitter.com/intent/tweet?text=${encodedCaption}&url=${encodedUrl}&hashtags=Blobbi,BlobbiIsland`;
        break;
      case 'facebook':
        shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`;
        break;
      case 'linkedin':
        shareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`;
        break;
      case 'reddit':
        shareUrl = `https://www.reddit.com/submit?url=${encodedUrl}&title=${encodedCaption}`;
        break;
      case 'whatsapp':
        shareUrl = `https://wa.me/?text=${encodedCaption}%20${encodedUrl}`;
        break;
      case 'telegram':
        shareUrl = `https://t.me/share/url?url=${encodedUrl}&text=${encodedCaption}`;
        break;
      case 'instagram':
        // Instagram doesn't support web sharing with prefilled text
        // Download the image and instruct user
        handleDownload();
        toast({
          title: "Instagram sharing",
          description: "Image downloaded! Please open Instagram and paste the caption manually.",
        });
        return;
      case 'copy':
        try {
          await navigator.clipboard.writeText(`${caption} ${pageUrl}`);
          toast({
            title: "Link copied!",
            description: "Caption and link copied to clipboard.",
          });
        } catch {
          toast({
            title: "Copy failed",
            description: "Could not copy to clipboard. Please try again.",
            variant: "destructive",
          });
        }
        return;
      default:
        return;
    }

    // Open the share URL in a new window
    window.open(shareUrl, '_blank', 'width=600,height=400');
    setIsSocialPanelOpen(false);
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

    if (selectedRelays.length === 0) {
      toast({
        title: "No relays selected",
        description: "Please select at least one relay to publish to.",
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

      // Create content with mandatory hashtags
      const content = getPrefilledCaption();

      // Add image tags and NIP-94 metadata
      const tags = [...fileTags];

      // Add alt tag for accessibility
      tags.push(['alt', 'A polaroid photo taken at Blobbi Island with accessories, background, and frame']);

      // Add discoverability tags
      tags.push(['t', 'Blobbi']);
      tags.push(['t', 'BlobbiIsland']);

      // Publish to selected relays
      const event = await publishEvent({
        kind: 1, // Text note
        content,
        tags,
      });

      toast({
        title: "Photo shared to Nostr! 🚀",
        description: `Your polaroid has been published to ${selectedRelays.length} relay(s). Event ID: ${event?.id?.slice(0, 8)}...`,
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

  // Reset Nostr section state when modal closes
  useEffect(() => {
    if (!isOpen) {
      // Don't reset immediately to allow for smooth transitions
      const timer = setTimeout(() => {
        setIsNostrSectionExpanded(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className={cn(
        "absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      )}
      onClick={handleBackdropClick}
      style={{
        position: 'absolute',
      }}
    >
      {/* Share Modal Container - Two-pane layout */}
      <div
        className="relative w-full h-full max-w-[90%] max-h-[90%] bg-white/95 backdrop-blur-sm rounded-2xl shadow-2xl border border-purple-200/60 dark:border-purple-800/60 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-purple-100 dark:border-purple-900 flex-shrink-0">
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

        {/* Main Content - Two-pane layout */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Left Pane - Photo Preview (60% on desktop, full width on mobile) */}
          <div className="md:w-[60%] flex items-center justify-center p-6 flex-shrink-0">
            <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-6 w-full h-full flex items-center justify-center">
              {capturedPolaroidSrc ? (
                <div className="w-full h-full flex items-center justify-center">
                  <img
                    src={capturedPolaroidSrc}
                    alt="Captured Blobbi Photo"
                    className="max-w-full max-h-full object-contain rounded-lg shadow-md"
                    style={{
                      width: 'auto',
                      height: 'auto',
                      maxWidth: '100%',
                      maxHeight: '100%'
                    }}
                  />
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-red-500 font-medium mb-2">❌ Polaroid image not available</p>
                  <p className="text-sm text-muted-foreground">Please take a new photo to enable sharing.</p>
                </div>
              )}
            </div>
          </div>

          {/* Right Pane - Share Options (40% on desktop, full width on mobile) */}
          <div className="md:w-[40%] flex flex-col border-l border-purple-100 dark:border-purple-900 md:border-l-0 md:border-t border-t-purple-100 dark:border-t-purple-900 overflow-hidden">
            <div className="p-6 overflow-y-auto flex-1">
              <div className="space-y-4">
                {/* Download Option */}
                <Button
                  onClick={handleDownload}
                  variant="outline"
                  className="w-full justify-start h-auto p-4"
                  disabled={isSharing || !capturedPolaroidSrc}
                >
                  <div className="flex items-center space-x-3">
                    <IconDownload className="w-5 h-5 text-blue-600 flex-shrink-0" />
                    <div className="text-left">
                      <div className="font-medium">Download Photo</div>
                      <div className="text-sm text-muted-foreground">Save as PNG to your device</div>
                    </div>
                  </div>
                </Button>

                {/* Share to App - Social Media */}
                <Dialog open={isSocialPanelOpen} onOpenChange={setIsSocialPanelOpen}>
                  <Button
                    variant="outline"
                    className="w-full justify-start h-auto p-4"
                    onClick={handleWebShare}
                    disabled={isSharing || !capturedPolaroidSrc}
                  >
                    <div className="flex items-center space-x-3">
                      <IconShare className="w-5 h-5 text-green-600 flex-shrink-0" />
                      <div className="text-left">
                        <div className="font-medium">Share to App</div>
                        <div className="text-sm text-muted-foreground">
                          {typeof navigator.share !== 'undefined' && typeof navigator.canShare !== 'undefined' ? 'Use native share dialog' : 'Choose social network'}
                        </div>
                      </div>
                    </div>
                  </Button>
                  <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden">
                    <DialogHeader>
                      <DialogTitle>Share to Social Media</DialogTitle>
                    </DialogHeader>
                    <div className="overflow-y-auto max-h-[60vh] p-6">
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                        {/* Twitter/X */}
                        <Button
                          variant="outline"
                          className="h-24 flex flex-col items-center justify-center space-y-2 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors"
                          onClick={() => handleSocialShare('twitter')}
                          aria-label="Share to X (Twitter)"
                        >
                          <IconBrandTwitter className="w-8 h-8 text-black" />
                          <span className="text-sm font-medium">X (Twitter)</span>
                        </Button>

                        {/* Facebook */}
                        <Button
                          variant="outline"
                          className="h-24 flex flex-col items-center justify-center space-y-2 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors"
                          onClick={() => handleSocialShare('facebook')}
                          aria-label="Share to Facebook"
                        >
                          <IconBrandFacebook className="w-8 h-8 text-blue-600" />
                          <span className="text-sm font-medium">Facebook</span>
                          <span className="text-xs text-muted-foreground">No prefilled text</span>
                        </Button>

                        {/* Instagram */}
                        <Button
                          variant="outline"
                          className="h-24 flex flex-col items-center justify-center space-y-2 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors"
                          onClick={() => handleSocialShare('instagram')}
                          aria-label="Share to Instagram"
                        >
                          <IconBrandInstagram className="w-8 h-8 text-pink-600" />
                          <span className="text-sm font-medium">Instagram</span>
                          <span className="text-xs text-muted-foreground">Manual upload</span>
                        </Button>

                        {/* WhatsApp */}
                        <Button
                          variant="outline"
                          className="h-24 flex flex-col items-center justify-center space-y-2 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors"
                          onClick={() => handleSocialShare('whatsapp')}
                          aria-label="Share to WhatsApp"
                        >
                          <IconBrandWhatsapp className="w-8 h-8 text-green-600" />
                          <span className="text-sm font-medium">WhatsApp</span>
                        </Button>

                        {/* Telegram */}
                        <Button
                          variant="outline"
                          className="h-24 flex flex-col items-center justify-center space-y-2 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors"
                          onClick={() => handleSocialShare('telegram')}
                          aria-label="Share to Telegram"
                        >
                          <IconBrandTelegram className="w-8 h-8 text-blue-500" />
                          <span className="text-sm font-medium">Telegram</span>
                        </Button>

                        {/* Reddit */}
                        <Button
                          variant="outline"
                          className="h-24 flex flex-col items-center justify-center space-y-2 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors"
                          onClick={() => handleSocialShare('reddit')}
                          aria-label="Share to Reddit"
                        >
                          <IconBrandReddit className="w-8 h-8 text-orange-600" />
                          <span className="text-sm font-medium">Reddit</span>
                        </Button>

                        {/* LinkedIn */}
                        <Button
                          variant="outline"
                          className="h-24 flex flex-col items-center justify-center space-y-2 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors"
                          onClick={() => handleSocialShare('linkedin')}
                          aria-label="Share to LinkedIn"
                        >
                          <IconBrandLinkedin className="w-8 h-8 text-blue-700" />
                          <span className="text-sm font-medium">LinkedIn</span>
                          <span className="text-xs text-muted-foreground">URL only</span>
                        </Button>

                        {/* Copy Link */}
                        <Button
                          variant="outline"
                          className="h-24 flex flex-col items-center justify-center space-y-2 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors"
                          onClick={() => handleSocialShare('copy')}
                          aria-label="Copy link to clipboard"
                        >
                          <IconCopy className="w-8 h-8 text-gray-600" />
                          <span className="text-sm font-medium">Copy Link</span>
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>

                {/* Post to Relay - Nostr */}
                <div className="border border-purple-200 dark:border-purple-800 rounded-lg overflow-hidden">
                  {/* Collapsible Header */}
                  <button
                    id="nostr-composer-header"
                    type="button"
                    onClick={toggleNostrSection}
                    onKeyDown={handleNostrSectionKeyDown}
                    aria-expanded={isNostrSectionExpanded}
                    aria-controls="nostr-composer-content"
                    className="w-full p-4 flex items-center justify-between hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-inset"
                  >
                    <div className="flex items-center space-x-3">
                      <IconSend className="w-5 h-5 text-purple-600 flex-shrink-0" />
                      <div className="text-left">
                        <div className="font-medium">Post to Relay</div>
                        <div className="text-sm text-muted-foreground">Share to Nostr network</div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      {!user && (
                        <span className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded flex-shrink-0">
                          Login required
                        </span>
                      )}
                      <div className="flex-shrink-0 text-purple-600 dark:text-purple-400">
                        {isNostrSectionExpanded ? (
                          <IconChevronUp className="w-4 h-4" />
                        ) : (
                          <IconChevronDown className="w-4 h-4" />
                        )}
                      </div>
                    </div>
                  </button>

                  {/* Collapsible Content */}
                  <div
                    id="nostr-composer-content"
                    role="region"
                    aria-labelledby="nostr-composer-header"
                    tabIndex={isNostrSectionExpanded ? -1 : undefined}
                    className={`transition-all duration-300 ease-in-out overflow-hidden ${
                      isNostrSectionExpanded ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0'
                    }`}
                  >
                    <div className="p-4 pt-0 border-t border-purple-100 dark:border-purple-900">

                  {/* Text Input with Mandatory Hashtags */}
                  <div className="space-y-3">
                    <div className="text-sm text-muted-foreground">
                      Your post will include:
                    </div>

                    {/* Preview Area */}
                    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-sm">
                      <div className="font-medium text-purple-600 dark:text-purple-400">#Blobbi #BlobbiIsland</div>
                      {userText && (
                        <div className="mt-1 text-gray-700 dark:text-gray-300">{userText}</div>
                      )}
                    </div>

                    {/* Text Input */}
                    <Textarea
                      placeholder="Add optional text..."
                      value={userText}
                      onChange={(e) => setUserText(e.target.value.slice(0, 280))}
                      maxLength={280}
                      className="resize-none"
                      rows={3}
                      disabled={isSharing || !user}
                    />

                    {/* Character Counter */}
                    <div className="flex justify-between items-center text-xs text-muted-foreground">
                      <span>Total: {20 + (userText.length ? userText.length + 1 : 0)}/280 characters</span>
                      <span>{280 - userText.length} remaining</span>
                    </div>
                  </div>

                  {/* Relay Selection */}
                  <div className="space-y-2 mt-4">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium text-muted-foreground">
                        {selectedRelays.length} relay{selectedRelays.length !== 1 ? 's' : ''} selected
                      </div>
                      <button
                        onClick={() => setIsRelayListExpanded(!isRelayListExpanded)}
                        className="text-xs text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 flex items-center space-x-1 transition-colors"
                      >
                        <span>{isRelayListExpanded ? 'Show less' : 'Show more'}</span>
                        <svg
                          className={`w-3 h-3 transition-transform duration-200 ${isRelayListExpanded ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>

                    {/* Compact view - show only first selected relay */}
                    {!isRelayListExpanded && selectedRelays.length > 0 && (
                      <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3">
                        <div className="flex items-center space-x-2">
                          <div className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0"></div>
                          <div className="text-sm flex-1">
                            <div className="font-medium">
                              {presetRelays?.find(r => r.url === selectedRelays[0])?.name || 'Unknown'}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {selectedRelays[0]}
                            </div>
                          </div>
                          {selectedRelays.length > 1 && (
                            <span className="text-xs text-muted-foreground">
                              +{selectedRelays.length - 1} more
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Expanded state - show all relays */}
                    {isRelayListExpanded && (
                      <div className="space-y-2">
                        <div className="max-h-32 overflow-y-auto space-y-2 pr-2">
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
                      </div>
                    )}

                    {/* Empty state when no relays selected */}
                    {selectedRelays.length === 0 && (
                      <div className="space-y-2">
                        <div className="max-h-32 overflow-y-auto space-y-2 pr-2">
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
                      </div>
                    )}
                  </div>

                  <Button
                    onClick={handleNostrShare}
                    className="w-full mt-4 bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-700 hover:to-pink-600 text-white"
                    disabled={isSharing || !user || selectedRelays.length === 0 || !capturedPolaroidSrc}
                  >
                    {isSharing ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                        Posting to Nostr...
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
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-purple-100 dark:border-purple-900 bg-purple-50/50 dark:bg-purple-900/20 flex-shrink-0">
          <p className="text-xs text-center text-muted-foreground">
            Your photo includes all accessories, background, and your Blobbi exactly as shown in the preview.
          </p>
        </div>
      </div>
    </div>
  );
}