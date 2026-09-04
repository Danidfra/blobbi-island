// NOTE: This file is stable and usually should not be modified.
// It is important that all functionality in this file is preserved, and should only be modified if explicitly requested.
// Phase 5 polish: presentation only. The wooden plate IS the surface, copy and
// buttons sit directly on the wood; small cream surfaces are used only for the
// secret-key (nsec) block and its warning so that step stays serious and
// readable. No big cream card. On mobile landscape the SAME square board image
// is rotated 90° (board layer only, content is never rotated) and enlarged so
// it reads as a wider, roomier horizontal sign.
// Copy is simplified but the secret key (nsec) stays clearly the credential,
// the save/download step and warnings remain serious. Never called a "passport".
// Key generation / nsec encoding / download / final login / toasts / prop
// signatures / callback timing are unchanged.

import React, { useState } from 'react';
import { Download, Key, X } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { toast } from '@/hooks/useToast.ts';
import { useLoginActions } from '@/hooks/useLoginActions';
import { useFullscreenPortalContainer } from '@/contexts/FullscreenPortalContext';
import { cn, islandCtaButtonClass } from '@/lib/utils';
import { generateSecretKey, nip19 } from 'nostr-tools';

interface SignupDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const SignupDialog: React.FC<SignupDialogProps> = ({ isOpen, onClose }) => {
  const [step, setStep] = useState<'generate' | 'download' | 'done'>('generate');
  const [isLoading, setIsLoading] = useState(false);
  const [nsec, setNsec] = useState('');
  const login = useLoginActions();
  // Render inside the game window (and above the fullscreen layer).
  const portalContainer = useFullscreenPortalContainer();

  // Generate a proper nsec key using nostr-tools
  const generateKey = () => {
    setIsLoading(true);

    try {
      // Generate a new secret key
      const sk = generateSecretKey();

      // Convert to nsec format
      setNsec(nip19.nsecEncode(sk));
      setStep('download');
    } catch (error) {
      console.error('Failed to generate key:', error);
      toast({
        title: 'Error',
        description: 'Failed to generate key. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const downloadKey = () => {
    // Create a blob with the key text
    const blob = new Blob([nsec], { type: 'text/plain' });
    const url = globalThis.URL.createObjectURL(blob);

    // Create a temporary link element and trigger download
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nsec.txt';
    document.body.appendChild(a);
    a.click();

    // Clean up
    globalThis.URL.revokeObjectURL(url);
    document.body.removeChild(a);

    toast({
      title: 'Key downloaded',
      description: 'Your key has been downloaded. Keep it safe!',
    });
  };

  const finishSignup = () => {
    login.nsec(nsec);

    setStep('done');
    onClose();

    toast({
      title: 'Account created',
      description: 'You are now logged in.',
    });
  };

  const title =
    step === 'generate'
      ? 'Create account'
      : step === 'download'
        ? 'Save your secret key'
        : 'Welcome';

  // Secondary action: warm wood/cream pill, readable on the plate.
  const secondaryButtonClass =
    'w-full rounded-full border-2 border-island-wood/40 bg-island-cream-2 text-island-ink shadow-cozy-soft hover:bg-island-sand';

  // Text printed directly on the wood. The block keeps the cream color + a
  // soft shadow for crisp glyph edges; the actual marker/highlighter band is
  // applied to an inline span (woodMarkClass) so it hugs the words instead of
  // filling the whole block like a strip.
  const woodTextClass =
    'text-island-cream [text-shadow:0_1px_2px_rgba(20,14,8,0.7)]';

  // Marker/highlighter band that sits right behind the text. Kept very subtle:
  // low-opacity dark wash so it only nudges readability without reading as a
  // badge/pill. Inline + box-decoration-clone so wrapped lines each get the
  // band; tiny horizontal padding + negative vertical margin keep it tight to
  // the text and add no layout height (so it never introduces scroll). No
  // border-radius: a rounded shape would make the bounds noticeable.
  const woodMarkClass =
    'box-decoration-clone bg-[rgba(20,14,8,0.16)] px-[0.12em] [margin-block:-0.04em]';

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        inFrame
        container={portalContainer}
        data-block-move
        onPointerDown={(e) => e.stopPropagation()}
        // Desktop/tablet/portrait: square board. Mobile landscape: the
        // already-horizontal mobile board (~1.64:1). Bounds fill most of the
        // landscape viewport: roomy but no longer oversized; object-contain
        // on the image keeps the true aspect ratio.
        className='aspect-square h-auto w-[min(92vw,29rem)] max-w-[29rem] border-0 bg-transparent p-0 shadow-none landscape:max-md:aspect-[1381/842] landscape:max-md:h-[90svh] landscape:max-md:max-h-[90svh] landscape:max-md:w-[95vw] landscape:max-md:max-w-[95vw]'
      >
        <DialogTitle className='sr-only'>{title}</DialogTitle>
        <DialogDescription className='sr-only'>
          Create a Nostr account for Blobbi Island.
        </DialogDescription>

        {/* Wooden modal frame: BOARD LAYER ONLY. Desktop/tablet/portrait use
            the square modal asset. Mobile landscape swaps to the dedicated
            horizontal mobile board (already rotated in the asset itself; no
            CSS rotation). The content layer below is never rotated. */}
        <div className='pointer-events-none absolute inset-0 flex items-center justify-center'>
          <img
            src='/assets/ui/branding/blobbi-island-login-modal.png'
            alt=''
            aria-hidden='true'
            className='h-full w-full select-none object-contain drop-shadow-[0_18px_30px_rgba(58,42,26,0.45)] landscape:max-md:hidden'
            draggable={false}
          />
          {/* Mobile-landscape board: the already-horizontal mobile asset
              (~1.64:1). Filling the full container width/height with
              object-contain keeps its aspect ratio without distortion or
              rotation. */}
          <img
            src='/assets/ui/branding/blobbi-island-login-wood-mobile.png'
            alt=''
            aria-hidden='true'
            className='hidden h-full w-full select-none object-contain drop-shadow-[0_18px_30px_rgba(58,42,26,0.45)] landscape:max-md:block'
            draggable={false}
          />
        </div>

        {/* Close: kept inside the safe area, clear of the corner vines. */}
        <DialogClose
          aria-label='Close'
          className='absolute right-[13%] top-[12%] z-10 rounded-full bg-island-ink/40 p-1.5 text-island-cream transition-colors hover:bg-island-ink/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-island-cream landscape:max-md:right-[10%] landscape:max-md:top-[10%]'
        >
          <X className='size-5' />
        </DialogClose>

        {/* Content sits directly on the wood, tracking the BOARD's footprint.
            On desktop/portrait that's the centered square; on mobile landscape
            the board fills the whole DialogContent box, so padding (clearing
            vines/bolts) is all that's needed. Content is NOT rotated. */}
        <div className='absolute inset-0 flex items-center justify-center'>
          <div className='flex h-full w-full flex-col p-[14%] text-center landscape:max-md:px-[12%] landscape:max-md:py-[8%]'>
            {/* Header printed on the wood: cream text lifted by a stronger
                layered text-shadow (no background pill, text only). */}
            <div className='shrink-0 px-1'>
              <h2 className={cn(woodTextClass, 'text-xl font-bold landscape:max-md:text-lg')}>
                <span className={woodMarkClass}>{title}</span>
              </h2>
              {step === 'generate' && (
                <p className={cn(woodTextClass, 'mt-0.5 text-sm text-island-cream/90 landscape:max-md:text-xs')}>
                  <span className={woodMarkClass}>We'll create a Nostr account for Blobbi Island.</span>
                </p>
              )}
            </div>

          {/* Step content sits directly on the wood (no wrapping cream card).
              Overflow-visible on desktop/portrait and mobile landscape now that
              the board/content area is tuned (content fits, no internal
              scroll); a scroll fallback is kept ONLY for very short
              portrait/phone viewports. */}
          <div className='mx-auto mt-3 flex min-h-0 w-full max-w-[19rem] flex-1 flex-col justify-center overflow-visible portrait:max-md:overflow-y-auto landscape:max-md:mt-2 landscape:max-md:max-w-[32rem]'>
            {step === 'generate' && (
              <div className='flex flex-col items-center justify-center space-y-4 text-center'>
                <span className='flex items-center justify-center rounded-2xl border-2 border-island-wood/30 bg-island-cream-2/90 p-4 shadow-cozy-soft landscape:max-md:p-3'>
                  <Key className='h-12 w-12 text-island-wood-dark landscape:max-md:h-9 landscape:max-md:w-9' />
                </span>
                <Button
                  className={cn(islandCtaButtonClass, 'landscape:max-md:h-8 landscape:max-md:py-1.5 landscape:max-md:text-xs')}
                  onClick={generateKey}
                  disabled={isLoading}
                >
                  {isLoading ? 'Creating…' : 'Create account'}
                </Button>
              </div>
            )}

            {step === 'download' && (
              <div className='space-y-2.5 text-left'>
                {/* Serious warning: high contrast cream strip so it can't be
                    missed. Kept compact, not a giant card. */}
                <p className='rounded-xl border-2 border-island-wood/40 bg-island-cream px-3 py-2 text-xs font-semibold text-island-ink shadow-cozy-soft'>
                  This key is the only way to access your account again. Save it somewhere safe and
                  never share it.
                </p>

                {/* The nsec itself in a readable cream code box. */}
                <div className='overflow-auto rounded-xl border-2 border-island-wood/40 bg-island-cream-2 p-2.5 shadow-cozy-inset'>
                  <code className='break-all text-xs text-island-ink'>{nsec}</code>
                </div>

                <ul className={cn(woodTextClass, 'list-disc space-y-1 pl-5 text-left text-xs font-medium')}>
                  <li><span className={woodMarkClass}>You need it to sign in again</span></li>
                  <li><span className={woodMarkClass}>Store it somewhere safe</span></li>
                  <li><span className={woodMarkClass}>Never share it</span></li>
                </ul>

                <Button className={cn(islandCtaButtonClass, 'landscape:max-md:h-8 landscape:max-md:py-1.5 landscape:max-md:text-xs')} onClick={finishSignup}>
                  I've saved it
                </Button>

                <Button
                  variant='outline'
                  className={cn(secondaryButtonClass, 'landscape:max-md:h-8 landscape:max-md:py-1.5 landscape:max-md:text-xs')}
                  onClick={downloadKey}
                >
                  <Download className='mr-2 h-4 w-4 landscape:max-md:mr-1.5' />
                  Download secret key
                </Button>
              </div>
            )}

            {step === 'done' && (
              <div className='flex items-center justify-center py-8'>
                <div className='h-12 w-12 animate-spin rounded-full border-b-2 border-island-cream' />
              </div>
            )}
          </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SignupDialog;
