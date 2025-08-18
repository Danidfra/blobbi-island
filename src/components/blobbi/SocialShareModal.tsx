import React, { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import {
  IconBrandTwitter,
  IconBrandFacebook,
  IconBrandInstagram,
  IconBrandWhatsapp,
  IconBrandTelegram,
  IconBrandReddit,
  IconBrandLinkedin,
  IconCopy
} from '@tabler/icons-react';

interface SocialShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  capturedPhoto: string | null;
  capturedPolaroidSrc: string | null;
  _className?: string;
}

export function SocialShareModal({ isOpen, onClose, title, capturedPolaroidSrc, _className }: SocialShareModalProps) {
  const { toast } = useToast();

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && isOpen) {
      onClose();
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

    const mandatoryHashtags = '#Blobbi #BlobbiIsland';
    const caption = mandatoryHashtags;
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
    onClose();
  };

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

  if (!isOpen) return null;

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className="w-[95%] max-w-2xl max-h-[90vh] p-0 bg-white/95 backdrop-blur-sm rounded-2xl shadow-2xl border border-purple-200/60 dark:border-purple-800/60 overflow-hidden flex flex-col">
        <div className="p-4 border-b border-purple-200/60 dark:border-purple-800/60">
          <h2 className="text-xl font-bold text-center text-purple-700 dark:text-purple-300">
            {title}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="absolute top-2 right-2 h-8 w-8 rounded-full hover:bg-red-50 hover:text-red-500"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="p-6">
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
        </div>

        <div className="p-4 border-t border-purple-200/60 dark:border-purple-800/60 flex justify-end">
          <Button variant="outline" onClick={onClose} className="border-purple-200 hover:bg-purple-50 dark:border-purple-700 dark:hover:bg-purple-900/20">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}