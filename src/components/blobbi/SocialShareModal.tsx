import React from 'react';
import { Button } from '@/components/ui/button';
import { Share2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BlobbiModal } from '@/components/ui/blobbi-modal';
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

/**
 * The share targets.
 *
 * Eight buttons that differed only in icon, label and footnote were eight
 * copies of the same 6-class string. The table is the component now.
 *
 * `iconClass` carries BRAND colours, which are the one legitimate exception to
 * the no-hardcoded-colour rule: Facebook blue is a fact about Facebook, not a
 * decision this design system gets to make, and it does not follow the theme.
 * The two that are NOT brand colours use tokens — X's mark is monochrome
 * (`text-black` would have vanished on a dusk panel) and Copy Link is a plain
 * utility icon.
 */
const SHARE_TARGETS: ReadonlyArray<{
  id: string;
  label: string;
  note?: string;
  Icon: typeof IconBrandTwitter;
  iconClass: string;
}> = [
  { id: 'twitter', label: 'X (Twitter)', Icon: IconBrandTwitter, iconClass: 'text-island-ink' },
  { id: 'facebook', label: 'Facebook', note: 'No prefilled text', Icon: IconBrandFacebook, iconClass: 'text-[#1877F2]' },
  { id: 'instagram', label: 'Instagram', note: 'Manual upload', Icon: IconBrandInstagram, iconClass: 'text-[#E1306C]' },
  { id: 'whatsapp', label: 'WhatsApp', Icon: IconBrandWhatsapp, iconClass: 'text-[#25D366]' },
  { id: 'telegram', label: 'Telegram', Icon: IconBrandTelegram, iconClass: 'text-[#229ED9]' },
  { id: 'reddit', label: 'Reddit', Icon: IconBrandReddit, iconClass: 'text-[#FF4500]' },
  { id: 'linkedin', label: 'LinkedIn', note: 'URL only', Icon: IconBrandLinkedin, iconClass: 'text-[#0A66C2]' },
  { id: 'copy', label: 'Copy Link', Icon: IconCopy, iconClass: 'text-island-ink-soft' },
];

export function SocialShareModal({ isOpen, onClose, title, capturedPolaroidSrc, _className }: SocialShareModalProps) {
  const { toast } = useToast();

  /*
    The hand-rolled `document` Escape listener and backdrop handler that used
    to live here are gone: BlobbiModal's Radix dialog owns both, and it does
    Escape correctly for a STACK — only the topmost surface closes. The global
    listener fired regardless of what was above it.
  */

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
    <BlobbiModal
      open={isOpen}
      onOpenChange={(next) => !next && onClose()}
      presentation="in-frame"
      size="lg"
      title={title}
      description="Pick where this goes. Some apps can only take the link."
      icon={<Share2 />}
      footer={
        <Button variant="soft" onClick={onClose} className="min-h-[44px]">
          Close
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
        {SHARE_TARGETS.map(({ id, label, note, Icon, iconClass }) => (
          <Button
            key={id}
            variant="soft"
            onClick={() => handleSocialShare(id)}
            aria-label={`Share to ${label}`}
            className="h-auto min-h-[5.5rem] flex-col justify-center gap-1.5 rounded-panel p-3 text-center"
          >
            <Icon aria-hidden className={cn('size-7 shrink-0', iconClass)} />
            <span className="text-sm font-semibold text-island-ink">{label}</span>
            {note ? <span className="text-[0.6875rem] text-island-ink-soft">{note}</span> : null}
          </Button>
        ))}
      </div>
    </BlobbiModal>
  );
}
