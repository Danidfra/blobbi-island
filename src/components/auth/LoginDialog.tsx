// NOTE: This file is stable and usually should not be modified.
// It is important that all functionality in this file is preserved, and should only be modified if explicitly requested.
// Phase 5 polish: presentation only. The wooden plate IS the surface, tabs,
// inputs and buttons sit directly on the wood (small cream surfaces only where
// readability needs it), like the pre-login "Enter Island" plate. No big cream
// card. On mobile landscape the SAME square board image is rotated 90° (board
// layer only: content is never rotated) and enlarged so it reads as a wider,
// roomier horizontal sign.
// Copy stays simplified and the credential stays clearly a Nostr secret key
// (nsec), never a "passport".
// Authentication logic, hooks, login methods, tab values, prop signatures and
// callback timing are unchanged.

import React, { useRef, useState } from 'react';
import { Shield, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.tsx';
import { useLoginActions } from '@/hooks/useLoginActions';
import { useFullscreenPortalContainer } from '@/contexts/FullscreenPortalContext';
import { cn, islandCtaButtonClass } from '@/lib/utils';

interface LoginDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onLogin: () => void;
  onSignup?: () => void;
}

const LoginDialog: React.FC<LoginDialogProps> = ({ isOpen, onClose, onLogin, onSignup }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [nsec, setNsec] = useState('');
  const [bunkerUri, setBunkerUri] = useState('');
  // Default to the Secret key tab: most players paste/upload their nsec here.
  // Extension and Bunker remain available; tab `value`s are unchanged.
  const [tab, setTab] = useState('key');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const login = useLoginActions();
  // Render inside the game window (and above the fullscreen layer) rather than
  // over the whole browser page.
  const portalContainer = useFullscreenPortalContainer();

  const handleExtensionLogin = () => {
    setIsLoading(true);
    try {
      if (!('nostr' in window)) {
        throw new Error('Nostr extension not found. Please install a NIP-07 extension.');
      }
      login.extension();
      onLogin();
      onClose();
    } catch (error) {
      console.error('Extension login failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyLogin = () => {
    if (!nsec.trim()) return;
    setIsLoading(true);

    try {
      login.nsec(nsec);
      onLogin();
      onClose();
    } catch (error) {
      console.error('Nsec login failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleBunkerLogin = () => {
    if (!bunkerUri.trim() || !bunkerUri.startsWith('bunker://')) return;
    setIsLoading(true);

    try {
      login.bunker(bunkerUri);
      onLogin();
      onClose();
    } catch (error) {
      console.error('Bunker login failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setNsec(content.trim());
    };
    reader.readAsText(file);
  };

  const handleSignupClick = () => {
    onClose();
    if (onSignup) {
      onSignup();
    }
  };

  // Small cream input surface (only the field itself is cream, not a whole card).
  const inputClass =
    'h-10 rounded-xl border-2 border-island-wood/40 bg-island-cream text-island-ink placeholder:text-island-ink-soft/60 shadow-cozy-soft focus-visible:ring-island-purple';

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

  // FUTURE/EXPERIMENT: a wood/brown primary CTA could look like:
  //   'bg-gradient-to-b from-island-wood to-island-wood-dark border-island-cream/70 text-island-cream'
  // Not used now, the purple CTA stays (clearer action color, matches Blobbi).

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
        <DialogTitle className='sr-only'>Sign in</DialogTitle>
        <DialogDescription className='sr-only'>
          Use your Nostr account to enter Blobbi Island.
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
          <div className='relative flex h-full w-full flex-col p-[14%] text-center landscape:max-md:px-[12%] landscape:max-md:py-[8%]'>
            {/* Header printed on the wood: cream text lifted by a stronger
                layered text-shadow (no background pill, text only). */}
            <div className='shrink-0 px-1'>
              <h2 className={cn(woodTextClass, 'text-xl font-bold landscape:max-md:text-lg')}>
                <span className={woodMarkClass}>Sign in</span>
              </h2>
              <p className={cn(woodTextClass, 'mt-0.5 text-sm text-island-cream/90 landscape:max-md:text-xs')}>
                <span className={woodMarkClass}>Use your Nostr account to enter Blobbi Island.</span>
              </p>
            </div>

          {/* Tabs + fields sit DIRECTLY on the wood (no wrapping cream card). */}
          <Tabs
            value={tab}
            onValueChange={setTab}
            className='mt-3 flex min-h-0 flex-1 flex-col landscape:max-md:mt-2'
          >
            {/* Tab strip as small cream/wood pills on the plate. */}
            <TabsList className='mx-auto grid w-full max-w-[18rem] shrink-0 grid-cols-3 gap-1 rounded-full border-2 border-island-wood/30 bg-island-cream-2/90 p-1 shadow-cozy-soft landscape:max-md:max-w-[30rem]'>
              <TabsTrigger value='extension' className='rounded-full text-xs data-[state=active]:bg-island-cream'>
                Extension
              </TabsTrigger>
              <TabsTrigger value='key' className='rounded-full text-xs data-[state=active]:bg-island-cream'>
                Secret key
              </TabsTrigger>
              <TabsTrigger value='bunker' className='rounded-full text-xs data-[state=active]:bg-island-cream'>
                Bunker
              </TabsTrigger>
            </TabsList>

            {/* Re-keyed by active tab so each switch replays a quick wooden
                "sign turn" (rotateY) flip. Inputs live in component state, not
                in this subtree, so remounting never loses their values.
                The flip is disabled on mobile landscape (cramped) and for
                motion-reduce users. Overflow stays visible everywhere now that
                the board/content area is tuned, content fits on both desktop
                and mobile landscape, so there's no internal scroll. A scroll
                fallback is kept ONLY for very short portrait/phone viewports. */}
            <div
              key={tab}
              data-tab={tab}
              className='mx-auto mt-3 flex min-h-0 w-full max-w-[18rem] flex-1 origin-center transform-gpu animate-sign-flip flex-col justify-start overflow-visible pt-1 portrait:max-md:overflow-y-auto motion-reduce:animate-none data-[tab=key]:justify-center data-[tab=key]:pt-0 landscape:max-md:mt-2 landscape:max-md:max-w-[30rem] landscape:max-md:animate-none landscape:max-md:justify-center'
            >
              <TabsContent value='extension' forceMount className='space-y-3 data-[state=inactive]:hidden landscape:max-md:-translate-y-2 landscape:max-md:space-y-2'>
                <p className={cn(woodTextClass, 'text-sm text-island-cream/95')}>
                  <span className={woodMarkClass}>
                    <Shield className='mr-1.5 inline h-4 w-4 align-text-bottom' />
                    One-tap sign-in with your browser extension.
                  </span>
                </p>
                <Button
                  className={cn(islandCtaButtonClass, 'landscape:max-md:h-8 landscape:max-md:py-1.5 landscape:max-md:text-xs')}
                  onClick={handleExtensionLogin}
                  disabled={isLoading}
                >
                  {isLoading ? 'Signing in…' : 'Login with Extension'}
                </Button>
              </TabsContent>

              <TabsContent value='key' forceMount className='space-y-2 data-[state=inactive]:hidden landscape:max-md:space-y-2'>
                <div className='space-y-1 text-left'>
                  <label htmlFor='nsec' className={cn(woodTextClass, 'block px-1 text-sm font-bold')}>
                    <span className={woodMarkClass}>Nostr secret key</span>
                  </label>
                  <Input
                    type='password'
                    id='nsec'
                    value={nsec}
                    onChange={(e) => setNsec(e.target.value)}
                    className={inputClass}
                    placeholder='nsec1…'
                  />
                  <p className={cn(woodTextClass, 'px-1 text-xs text-island-cream/90')}>
                    <span className={woodMarkClass}>Never share your secret key.</span>
                  </p>
                </div>

                <input
                  type='file'
                  accept='.txt'
                  className='hidden'
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                />

                {/* Primary + upload actions. Stacked on desktop/portrait; on
                    mobile landscape they sit side by side (Enter Island left,
                    Upload key file right) to keep the panel compact. */}
                <div className='flex flex-col gap-2 landscape:max-md:flex-row landscape:max-md:items-stretch landscape:max-md:gap-2'>
                  <Button
                    className={cn(islandCtaButtonClass, 'py-2 text-sm shadow-[0_4px_0_#6B4FC4,0_8px_14px_rgba(58,42,26,0.3)] landscape:max-md:h-8 landscape:max-md:flex-1 landscape:max-md:py-1.5 landscape:max-md:text-xs')}
                    onClick={handleKeyLogin}
                    disabled={isLoading || !nsec.trim()}
                  >
                    {isLoading ? 'Signing in…' : 'Enter Island'}
                  </Button>

                  <Button
                    variant='outline'
                    className={cn(secondaryButtonClass, 'h-9 text-sm landscape:max-md:h-8 landscape:max-md:flex-1 landscape:max-md:py-1.5 landscape:max-md:text-xs')}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className='mr-2 h-4 w-4 landscape:max-md:mr-1.5 landscape:max-md:h-3.5 landscape:max-md:w-3.5' />
                    Upload key file
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value='bunker' forceMount className='space-y-2.5 data-[state=inactive]:hidden landscape:max-md:space-y-2'>
                <div className='space-y-1.5 text-left'>
                  <label htmlFor='bunkerUri' className={cn(woodTextClass, 'block px-1 text-sm font-bold')}>
                    <span className={woodMarkClass}>Bunker URI</span>
                  </label>
                  <Input
                    id='bunkerUri'
                    value={bunkerUri}
                    onChange={(e) => setBunkerUri(e.target.value)}
                    className={inputClass}
                    placeholder='bunker://'
                  />
                  {bunkerUri && !bunkerUri.startsWith('bunker://') && (
                    <p className='px-1 text-xs font-medium text-red-200 [text-shadow:0_1px_3px_rgba(58,42,26,0.9)]'>
                      URI must start with bunker://
                    </p>
                  )}
                </div>

                <Button
                  className={cn(islandCtaButtonClass, 'landscape:max-md:h-8 landscape:max-md:py-1.5 landscape:max-md:text-xs')}
                  onClick={handleBunkerLogin}
                  disabled={isLoading || !bunkerUri.trim() || !bunkerUri.startsWith('bunker://')}
                >
                  {isLoading ? 'Connecting…' : 'Login with Bunker'}
                </Button>
              </TabsContent>
            </div>
          </Tabs>

          {/* Secondary signup action, visible but secondary, on the wood.
              On mobile landscape it's absolutely anchored to the bottom of the
              content area (just inside the board's safe padding) so it reads as
              a footer link and never competes with the login controls. Desktop
              /portrait keep it in normal flow. */}
          <div className='shrink-0 pt-2 text-center text-sm landscape:max-md:absolute landscape:max-md:inset-x-0 landscape:max-md:bottom-[9%] landscape:max-md:pt-0'>
            <button
              onClick={handleSignupClick}
              className='font-bold text-island-cream underline decoration-island-cream/50 underline-offset-4 [text-shadow:0_1px_3px_rgba(58,42,26,0.85)] transition-colors hover:text-white landscape:max-md:text-xs'
            >
              New here? Get started
            </button>
          </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default LoginDialog;
