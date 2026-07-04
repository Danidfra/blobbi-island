/**
 * BlobbiHatchingCeremony — Island first-egg adoption ceremony.
 *
 * Adapted from Ditto's onboarding BlobbiHatchingCeremony: it reproduces the same
 * core interaction feeling (dark screen → breathing egg → click-to-crack with
 * intensifying shakes → burst + screen flash → glowing reveal with sparkles →
 * typewriter birth dialog → naming → fade to white). All presentation is local
 * to the Island and uses the Island design system.
 *
 * What was deliberately NOT copied from Ditto:
 *   - Ditto's evolution-mission / streak seeding and validateAndRepairBlobbiTags.
 *   - Ditto's toast / router / portal orchestration.
 *
 * The egg visual IS adapted from Ditto: the local `EggGraphic` below replicates
 * Ditto's `src/blobbi/egg/components/EggGraphic.tsx` shell proportion (80% width
 * / 100% height inside a square slot), HSL 3D shading, and the exact progressive
 * crack SVG (viewBox 0 0 120 125, preserveAspectRatio="xMidYMid meet"), so the
 * egg keeps Ditto's proportion and the crack overlay stays aligned to the shell.
 *
 * Core publish/tag/state logic lives in useFirstEggAdoption (which uses
 * @blobbi-kit/core helpers). This component only drives the animation and calls
 * that hook at the right moments.
 *
 * No-orphan guarantee: mounting the ceremony publishes NOTHING. On mount it only
 * generates a local, deterministic preview (generatePreview). The single real
 * publish (profile + final baby state) happens exclusively on final naming
 * submit (finalizeAdoption). So refreshing/leaving before naming creates zero
 * real Nostr events, and no egg event is ever published.
 *
 * Layout: the ceremony is container-aware. Its root uses `absolute inset-0`, so
 * it fills its positioning parent — the BlobbiStage inside the game shell —
 * rather than the browser viewport. On desktop (framed) it stays inside the
 * cozy game window; on mobile-landscape/immersive and when the game shell is
 * fullscreen, the stage already fills the screen, so the ceremony naturally
 * fills it too. The dark backdrop, flash, and fade-to-white therefore only
 * cover the game area, never the surrounding browser page.
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { loadBlobbiSvg } from '@/lib/loadBlobbiSvg';
import { useTypewriter } from '@/hooks/useTypewriter';
import { buildRevealGradient } from '@/lib/ceremony-colors';
import { useFirstEggAdoption } from '@/hooks/useFirstEggAdoption';
import type { BlobbiEggPreview } from '@/lib/blobbi-egg-preview';

const BIRTH_DIALOG: string[] = [
  'Something stirs…',
  'A tiny life has chosen you. It knows only warmth, and your presence.',
];

const NAMING_DIALOG = 'Every life deserves a name.\nWhat will you call this one?';

type CeremonyPhase =
  | 'loading'
  | 'egg'
  | 'crack_1'
  | 'crack_2'
  | 'crack_3'
  | 'hatching'
  | 'reveal'
  | 'dialog'
  | 'naming'
  | 'complete';

interface BlobbiHatchingCeremonyProps {
  /** Called once the ceremony is fully complete, with the new Blobbi's d-tag. */
  onComplete: (blobbiId: string) => void;
}

export function BlobbiHatchingCeremony({ onComplete }: BlobbiHatchingCeremonyProps) {
  const { generatePreview, finalizeAdoption } = useFirstEggAdoption();

  const [phase, setPhase] = useState<CeremonyPhase>('loading');
  const [preview, setPreview] = useState<BlobbiEggPreview | null>(null);
  const [name, setName] = useState('');
  const [isNaming, setIsNaming] = useState(false);
  const [eggVisible, setEggVisible] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Inline error shown during the naming step when the authoritative baby
  // publish fails. The player stays on the naming screen and can retry; the
  // ceremony does NOT enter the island until the baby publish succeeds.
  const [hatchError, setHatchError] = useState<string | null>(null);

  const [blobbiVisible, setBlobbiVisible] = useState(false);
  const [showFlash, setShowFlash] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);

  const [dialogLineIndex, setDialogLineIndex] = useState(0);
  const [dialogActive, setDialogActive] = useState(false);
  const [namingVisible, setNamingVisible] = useState(false);

  const setupAttempted = useRef(false);
  const eggContainerRef = useRef<HTMLDivElement>(null);
  const entrancePlayed = useRef(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  // Keep the latest generatePreview without making it a re-trigger for the
  // one-shot setup effect (its identity can change across renders).
  const generatePreviewRef = useRef(generatePreview);
  generatePreviewRef.current = generatePreview;

  const eggColor = preview?.visualTraits.baseColor ?? '#f59e0b';
  const eggSecondary = preview?.visualTraits.secondaryColor ?? '#fcd34d';
  const revealBg = useMemo(() => buildRevealGradient(eggColor), [eggColor]);

  // Baby SVG for the reveal (Island renders eggs as baby — see task decision).
  const babySvg = useMemo(() => {
    if (!preview) return '';
    return loadBlobbiSvg(
      'baby',
      undefined,
      preview.visualTraits.baseColor,
      preview.visualTraits.secondaryColor,
      preview.visualTraits.eyeColor,
      false,
      preview.d,
    );
  }, [preview]);

  const currentDialogText = phase === 'dialog' ? (BIRTH_DIALOG[dialogLineIndex] ?? '') : '';
  const dialogTypewriter = useTypewriter(currentDialogText, dialogActive);
  const namingTypewriter = useTypewriter(NAMING_DIALOG, namingVisible);

  // ── Local-only setup: generate a deterministic preview. NO real Nostr event
  //    is published here. Refreshing/abandoning before naming creates zero
  //    events. The real publish happens only on final naming submit. ──
  useEffect(() => {
    if (setupAttempted.current) return;
    setupAttempted.current = true;

    let cancelled = false;
    // Small delay preserves the original dark "loading" beat before the egg
    // appears — purely cosmetic; nothing is published.
    const timer = setTimeout(() => {
      if (cancelled) return;
      try {
        const created = generatePreviewRef.current();
        setPreview(created);
        setPhase('egg');
        setTimeout(() => setEggVisible(true), 200);
      } catch (error) {
        console.error('[HatchingCeremony] Preview generation failed:', error);
        setErrorMessage('We could not prepare your Blobbi. Please try again.');
      }
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  // Play the entrance animation once.
  useEffect(() => {
    if (eggVisible && !entrancePlayed.current && eggContainerRef.current) {
      entrancePlayed.current = true;
      const el = eggContainerRef.current;
      el.classList.add('animate-egg-onboard-entrance');
      const onEnd = () => {
        el.classList.remove('animate-egg-onboard-entrance');
        el.removeEventListener('animationend', onEnd);
      };
      el.addEventListener('animationend', onEnd);
    }
  }, [eggVisible]);

  const triggerShake = useCallback((cls: string) => {
    const el = eggContainerRef.current;
    if (!el) return;
    el.classList.remove(
      'animate-egg-onboard-shake-light',
      'animate-egg-onboard-shake-medium',
      'animate-egg-onboard-shake-heavy',
    );
    void el.offsetWidth; // reflow so the animation can replay
    el.classList.add(cls);
  }, []);

  // ── Egg click: crack progression, then hatch on the final click ──
  const handleEggClick = useCallback(() => {
    if (phase === 'egg') {
      triggerShake('animate-egg-onboard-shake-light');
      setPhase('crack_1');
    } else if (phase === 'crack_1') {
      triggerShake('animate-egg-onboard-shake-medium');
      setPhase('crack_2');
    } else if (phase === 'crack_2') {
      triggerShake('animate-egg-onboard-shake-heavy');
      setPhase('crack_3');
    } else if (phase === 'crack_3') {
      setPhase('hatching');
      setShowFlash(true);

      // NOTE: We deliberately do NOT publish the baby here. The Island filters
      // out eggs from the collection, so the baby publish must be the single
      // authoritative step that gates entering the island — and it must carry
      // the player-chosen name. Publishing here (with the placeholder name)
      // would be a duplicate publish that could also mask failures. The one and
      // only baby publish happens on naming submit (handleNameSubmit).

      setTimeout(() => {
        setShowFlash(false);
        setPhase('reveal');
        setTimeout(() => setBlobbiVisible(true), 400);
        setTimeout(() => {
          setPhase('dialog');
          setDialogLineIndex(0);
          setDialogActive(true);
        }, 2200);
      }, 1400);
    }
  }, [phase, triggerShake]);

  // ── Dialog click: complete the current line, or advance ──
  const handleDialogClick = useCallback(() => {
    if (phase !== 'dialog') return;
    if (!dialogTypewriter.done) {
      dialogTypewriter.complete();
      return;
    }
    const nextIndex = dialogLineIndex + 1;
    if (nextIndex < BIRTH_DIALOG.length) {
      setDialogActive(false);
      setDialogLineIndex(nextIndex);
      setTimeout(() => setDialogActive(true), 150);
    } else {
      setDialogActive(false);
      setTimeout(() => {
        setPhase('naming');
        setTimeout(() => {
          setNamingVisible(true);
          setTimeout(() => nameInputRef.current?.focus(), 600);
        }, 200);
      }, 400);
    }
  }, [phase, dialogTypewriter, dialogLineIndex]);

  const finishCeremony = useCallback(
    (blobbiId: string) => {
      setNamingVisible(false);
      setTimeout(() => {
        setFadeOut(true);
        setTimeout(() => {
          setPhase('complete');
          onComplete(blobbiId);
        }, 2000);
      }, 500);
    },
    [onComplete],
  );

  // ── Naming submit: the ONLY real publish path ──
  // This is where the profile + final baby (kind 31124) are actually published.
  // Nothing was published before this point, so abandoning the ceremony earlier
  // leaves zero events. Entering the island is gated on this succeeding:
  //   - success → finish the ceremony and enter the island
  //   - failure → surface an inline retry error and stay on the naming screen
  //     (never call onComplete, so the player can't land on an invisible egg).
  const handleNameSubmit = useCallback(async () => {
    if (isNaming || !name.trim() || !preview) return;
    setIsNaming(true);
    setHatchError(null);
    try {
      const blobbiId = await finalizeAdoption(preview, name.trim());
      // Only finish once the baby + profile are really published.
      finishCeremony(blobbiId);
    } catch (error) {
      console.error('[HatchingCeremony] Adoption publish failed:', error);
      setHatchError("We couldn't wake your Blobbi. Please try again.");
    } finally {
      setIsNaming(false);
    }
  }, [name, isNaming, preview, finalizeAdoption, finishCeremony]);

  const isEggPhase =
    phase === 'egg' || phase === 'crack_1' || phase === 'crack_2' || phase === 'crack_3';
  const isHatching = phase === 'hatching';
  const showBaby = phase === 'reveal' || phase === 'dialog' || phase === 'naming';

  // Crack level 0–3 drives the crack overlay, matching Ditto's tourCrackLevel:
  // crack_1→1, crack_2→2, crack_3→3, and 'hatching' (Ditto's 'opening') keeps
  // the level-3 crack so the shell fades out WITH its cracks intact. The plain
  // 'egg' phase shows no crack yet (level -1 → crack hidden) so the first tap is
  // what visibly cracks the shell.
  const crackLevel =
    phase === 'crack_1'
      ? 1
      : phase === 'crack_2'
        ? 2
        : phase === 'crack_3' || phase === 'hatching'
          ? 3
          : -1;

  const darkBg =
    'radial-gradient(ellipse at center, #0a1a2a 0%, #081520 50%, #060f18 100%)';

  // ── Error state ──
  if (errorMessage) {
    return (
      <div
        className="absolute inset-0 z-40 flex items-center justify-center p-6"
        style={{ background: darkBg }}
      >
        <div className="w-full max-w-sm rounded-3xl border-4 border-island-wood bg-island-cream p-6 text-center shadow-cozy-frame">
          <h3 className="text-lg font-bold text-island-ink">The nest went quiet</h3>
          <p className="mt-1 text-sm text-island-ink-soft">{errorMessage}</p>
          <Button
            onClick={() => window.location.reload()}
            className="mt-5 w-full rounded-full bg-island-purple font-bold text-white shadow-cozy-raised hover:bg-island-purple/90"
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (phase === 'loading') {
    return (
      <div
        className="absolute inset-0 z-40 flex items-center justify-center"
        style={{ background: darkBg }}
      >
        <div
          className="absolute size-32 rounded-full opacity-20 animate-pulse"
          style={{ background: `radial-gradient(circle, ${eggColor}40 0%, transparent 70%)` }}
        />
      </div>
    );
  }

  return (
    <div
      className="absolute inset-0 z-40 overflow-hidden select-none"
      style={{
        background: showBaby ? revealBg : darkBg,
        transition: 'background 2s ease-out',
      }}
      onClick={phase === 'dialog' ? handleDialogClick : undefined}
    >
      {/* Ambient background glow (egg phase) */}
      {!showBaby && (
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(ellipse at 50% 50%, ${eggColor}30 0%, transparent 60%)`,
            opacity: isEggPhase || isHatching ? 0.09 : 0.05,
            transition: 'opacity 3s ease-out',
          }}
        />
      )}

      {/* Reveal vignette */}
      {showBaby && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse at 50% 45%, transparent 30%, rgba(0,0,0,0.12) 70%, rgba(0,0,0,0.25) 100%)',
          }}
        />
      )}

      {/* Floating particles (egg phase) */}
      {isEggPhase && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="absolute rounded-full"
              style={{
                width: 2 + (i % 3),
                height: 2 + (i % 3),
                left: `${20 + ((i * 12) % 60)}%`,
                bottom: '40%',
                backgroundColor: `${eggColor}66`,
                animation: `onboard-particle-rise ${4 + i * 0.7}s ease-out ${i * 0.8}s infinite`,
              }}
            />
          ))}
        </div>
      )}

      {/* The Egg (Island-local egg graphic adapted from Ditto's EggGraphic) */}
      {(isEggPhase || isHatching) && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            ref={eggContainerRef}
            className={cn(
              'relative cursor-pointer',
              // Square slot (Ditto uses size-56/64/72). We run a slightly
              // smaller responsive scale so the egg sits comfortably inside the
              // game window rather than feeling oversized. The egg graphic still
              // fits INSIDE this slot at a fixed egg aspect (80% width / 100%
              // height), so the shell keeps its Ditto proportion and never
              // stretches — only the slot size changed.
              'size-44 sm:size-52 md:size-60',
              eggVisible ? '' : 'opacity-0',
              eggVisible && isEggPhase && 'animate-egg-onboard-breathe',
              isHatching && 'animate-egg-onboard-burst',
            )}
            onClick={isEggPhase ? handleEggClick : undefined}
            role="button"
            aria-label="Tap the egg to hatch it"
          >
            {/* Aura */}
            <div
              className="absolute -inset-12 rounded-full blur-2xl transition-opacity duration-1000"
              style={{
                background: `radial-gradient(circle, ${eggColor}80 0%, transparent 70%)`,
                opacity:
                  phase === 'crack_3' ? 0.5 : phase === 'crack_2' ? 0.35 : phase === 'crack_1' ? 0.25 : 0.15,
              }}
            />
            <EggGraphic
              baseColor={eggColor}
              secondaryColor={eggSecondary}
              crackLevel={crackLevel}
              opening={isHatching}
            />
          </div>
        </div>
      )}

      {/* Screen flash */}
      {showFlash && (
        <div
          className="absolute inset-0 bg-white animate-onboard-screen-flash pointer-events-none"
          style={{ zIndex: 80 }}
        />
      )}

      {/* Hatched baby with golden incandescence + sparkles */}
      {showBaby && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ paddingBottom: '14%' }}
        >
          {/* Rotating golden incandescence */}
          <div className={cn('absolute animate-onboard-golden-fadein', blobbiVisible ? '' : 'opacity-0')}>
            <div
              className="animate-onboard-golden-rotate"
              style={{
                width: 640,
                height: 640,
                background: `conic-gradient(
                  from 0deg,
                  rgba(255, 250, 230, 0.18) 0deg,
                  rgba(255, 245, 210, 0.50) 50deg,
                  rgba(255, 250, 235, 0.22) 100deg,
                  rgba(255, 248, 220, 0.15) 150deg,
                  rgba(255, 245, 210, 0.48) 210deg,
                  rgba(255, 250, 230, 0.20) 270deg,
                  rgba(255, 248, 220, 0.15) 320deg,
                  rgba(255, 250, 230, 0.18) 360deg
                )`,
                borderRadius: '50%',
                filter: 'blur(30px)',
              }}
            />
          </div>

          {/* Bright shine behind blobbi */}
          <div
            className={cn('absolute rounded-full transition-opacity duration-1000', blobbiVisible ? 'opacity-100' : 'opacity-0')}
            style={{
              width: 240,
              height: 240,
              background:
                'radial-gradient(circle, rgba(255,255,245,0.70) 0%, rgba(255,250,225,0.30) 40%, transparent 70%)',
            }}
          />

          {/* Sparkles — inner ring */}
          {Array.from({ length: 20 }).map((_, i) => {
            const angle = (i / 20) * Math.PI * 2;
            const r = 60 + (i % 4) * 26;
            const size = 4 + (i % 3) * 3;
            return (
              <div
                key={`inner-${i}`}
                className="absolute"
                style={{
                  width: size,
                  height: size,
                  left: `calc(50% + ${Math.cos(angle) * r}px - ${size / 2}px)`,
                  top: `calc(50% + ${Math.sin(angle) * r}px - ${size / 2}px)`,
                  borderRadius: '50%',
                  background:
                    i % 2 === 0
                      ? 'radial-gradient(circle, rgba(255,255,255,1) 0%, rgba(255,255,255,0.4) 40%, transparent 70%)'
                      : 'radial-gradient(circle, rgba(255,240,130,1) 0%, rgba(255,220,80,0.3) 50%, transparent 70%)',
                  animation: `onboard-sparkle-twinkle ${1.5 + (i % 6) * 0.5}s ease-in-out ${i * 0.15}s infinite`,
                }}
              />
            );
          })}

          {/* Sparkles — outer ring */}
          {Array.from({ length: 16 }).map((_, i) => {
            const angle = (i / 16) * Math.PI * 2 + 0.3;
            const r = 128 + (i % 3) * 38;
            const size = 5 + (i % 4) * 3;
            return (
              <div
                key={`outer-${i}`}
                className="absolute"
                style={{
                  width: size,
                  height: size,
                  left: `calc(50% + ${Math.cos(angle) * r}px - ${size / 2}px)`,
                  top: `calc(50% + ${Math.sin(angle) * r}px - ${size / 2}px)`,
                  borderRadius: '50%',
                  background:
                    i % 3 === 0
                      ? 'radial-gradient(circle, rgba(255,255,255,0.9) 0%, transparent 60%)'
                      : 'radial-gradient(circle, rgba(255,235,120,0.85) 0%, transparent 60%)',
                  animation: `onboard-sparkle-twinkle ${2.5 + (i % 5) * 0.7}s ease-in-out ${i * 0.25}s infinite`,
                }}
              />
            );
          })}

          {/* Drifting light motes */}
          {Array.from({ length: 10 }).map((_, i) => {
            const x = (Math.sin(i * 1.9) * 0.5 + 0.5) * 70 + 15;
            return (
              <div
                key={`drift-${i}`}
                className="absolute"
                style={{
                  width: 5 + (i % 3) * 3,
                  height: 5 + (i % 3) * 3,
                  left: `${x}%`,
                  bottom: '20%',
                  borderRadius: '50%',
                  background:
                    'radial-gradient(circle, rgba(255,250,200,0.9) 0%, rgba(255,230,120,0.3) 50%, transparent 100%)',
                  animation: `onboard-sparkle-drift ${4 + i * 0.5}s ease-out ${i * 0.5}s infinite`,
                }}
              />
            );
          })}

          {/* The baby blobbi — sized relative to the ceremony container (which
              fills the game window/stage) rather than the browser viewport, so
              it scales correctly inside the framed desktop canvas as well as in
              mobile/fullscreen. Kept comfortably framed (not oversized): a touch
              larger on mobile, tighter on desktop. */}
          <div
            className={cn(
              'relative aspect-square w-[48%] sm:w-[42%] max-w-[20rem] transition-opacity duration-1000',
              blobbiVisible ? 'opacity-100' : 'opacity-0',
            )}
            dangerouslySetInnerHTML={{ __html: babySvg }}
          />
        </div>
      )}

      {/* Dialog text */}
      {phase === 'dialog' && (
        <div className="absolute inset-x-0 bottom-0 flex justify-center pb-28 sm:pb-36 px-8">
          <div className="relative max-w-md w-full text-center">
            <div
              className="absolute -inset-32"
              style={{
                background:
                  'radial-gradient(ellipse at center, rgba(0,30,50,0.40) 0%, rgba(0,30,50,0.18) 35%, transparent 65%)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                mask: 'radial-gradient(ellipse at center, black 25%, transparent 65%)',
                WebkitMask: 'radial-gradient(ellipse at center, black 25%, transparent 65%)',
              }}
            />
            <div className="relative">
              <p className="text-[11px] text-white/50 tracking-[0.2em] uppercase mb-3">???</p>
              <p className="text-base sm:text-lg text-white leading-relaxed font-light min-h-[3em]">
                {dialogTypewriter.displayed}
                {!dialogTypewriter.done && (
                  <span className="inline-block w-[2px] h-[1em] bg-white/50 ml-0.5 animate-pulse align-text-bottom" />
                )}
              </p>
              {dialogTypewriter.done && (
                <div className="mt-4 animate-onboard-continue-pulse">
                  <span className="text-xs text-white/30">&#9660;</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Naming */}
      {phase === 'naming' && (
        <div className="absolute inset-x-0 bottom-0 flex justify-center pb-28 sm:pb-36 px-8">
          <div
            className={cn('relative max-w-md w-full text-center', namingVisible ? 'animate-onboard-soft-fade-in' : 'opacity-0')}
          >
            <div
              className="absolute -inset-32"
              style={{
                background:
                  'radial-gradient(ellipse at center, rgba(0,30,50,0.40) 0%, rgba(0,30,50,0.18) 35%, transparent 65%)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                mask: 'radial-gradient(ellipse at center, black 25%, transparent 65%)',
                WebkitMask: 'radial-gradient(ellipse at center, black 25%, transparent 65%)',
              }}
            />
            <div className="relative">
              <p className="text-[11px] text-white/50 tracking-[0.2em] uppercase mb-3">???</p>
              <p className="text-base sm:text-lg text-white/85 leading-relaxed font-light mb-6 min-h-[1.5em] whitespace-pre-line">
                {namingTypewriter.displayed}
                {!namingTypewriter.done && (
                  <span className="inline-block w-[2px] h-[1em] bg-white/50 ml-0.5 animate-pulse align-text-bottom" />
                )}
              </p>
              {namingTypewriter.done && (
                <div className="space-y-3 animate-onboard-soft-fade-in">
                  <Input
                    ref={nameInputRef}
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="…"
                    maxLength={32}
                    autoFocus
                    className={cn(
                      'text-center text-lg font-light h-12',
                      'bg-white/10 border-transparent text-white placeholder:text-white/30',
                      'focus:bg-white/[0.25] focus-visible:ring-0 focus-visible:ring-offset-0',
                      'rounded-full transition-all duration-300',
                    )}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && name.trim()) handleNameSubmit();
                    }}
                  />
                  {name.trim() && (
                    <Button
                      onClick={handleNameSubmit}
                      disabled={isNaming}
                      variant="ghost"
                      className={cn(
                        'max-w-[12rem] mx-auto h-10 px-8 text-sm font-light tracking-wide',
                        'bg-white/15 hover:bg-white/25 text-white/80 border-transparent',
                        'rounded-full transition-all duration-300 focus-visible:ring-0 focus-visible:ring-offset-0',
                      )}
                    >
                      {isNaming
                        ? 'Waking them up…'
                        : hatchError
                          ? 'Try again'
                          : "That's the one."}
                    </Button>
                  )}
                  {hatchError && (
                    <p
                      role="alert"
                      className="text-xs text-white/70 leading-relaxed pt-1"
                    >
                      {hatchError}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Fade to white on completion */}
      {fadeOut && (
        <div
          className="absolute inset-0 bg-white pointer-events-none"
          style={{ zIndex: 90, animation: 'blobbi-fade-to-white 2s ease-in forwards' }}
        />
      )}
    </div>
  );
}

/**
 * EggGraphic — Island-local egg, adapted directly from Ditto's
 * `src/blobbi/egg/components/EggGraphic.tsx` so the shell keeps Ditto's exact
 * proportion and hatching feel. Only the pure presentation was copied; all
 * Island publish/router/toast logic stays out of here.
 *
 * What was replicated from Ditto (do NOT "simplify" back into a bespoke CSS
 * egg — that regressed the shape/cracks last time):
 *   - The egg shell is `width: 80%; height: 100%` inside a SQUARE slot, with
 *     `borderRadius: '50% 50% 50% 50% / 60% 60% 40% 40%'`. That fixed 80%/100%
 *     ratio is what gives the correct egg proportion and keeps it from
 *     stretching when the (container-aware) parent slot changes size.
 *   - The 3D shading uses HSL-derived highlight/shadow variants of the base
 *     color (Ditto's createColorVariants) rather than flat overlays.
 *   - The crack overlay is an SVG with `viewBox="0 0 120 125"` and
 *     `preserveAspectRatio="xMidYMid meet"` (NOT "none"), centered near (60,62),
 *     using Ditto's progressive level-0→3 crack paths that grow OUTWARD from the
 *     egg center. `meet` keeps the crack aligned to the shell and never squashed.
 *   - `opening` fades/scales the shell out (Ditto's egg-tour-open) while the
 *     crack stays inside and fades with it.
 *
 * Island adaptation: Ditto reads visual traits off a Blobbi model; here we take
 * baseColor/secondaryColor from the seed-derived preview and a numeric
 * crackLevel (-1 = no crack yet, 0–3 = Ditto's crack stages) driven by the
 * ceremony phase. There is a single crack progression (no random
 * horizontal/vertical variant) — Ditto's ceremony egg likewise uses one
 * progressive crack path set, so none is invented here.
 */

/** Convert a #rrggbb hex color to HSL (Ditto's hexToHsl). */
function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const diff = max - min;

  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (diff !== 0) {
    s = l > 0.5 ? diff / (2 - max - min) : diff / (max + min);
    switch (max) {
      case r:
        h = (g - b) / diff + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / diff + 2;
        break;
      case b:
        h = (r - g) / diff + 4;
        break;
    }
    h /= 6;
  }

  return [h * 360, s * 100, l * 100];
}

/** Convert HSL back to a #rrggbb hex color (Ditto's hslToHex). */
function hslToHex(h: number, s: number, l: number): string {
  h /= 360;
  s /= 100;
  l /= 100;

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  let r: number;
  let g: number;
  let b: number;
  if (s === 0) {
    r = g = b = l; // achromatic
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  const toHex = (c: number) => {
    const hex = Math.round(c * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Lighter/darker variants of a base color for the 3D egg (Ditto's helper). */
function createColorVariants(baseColor: string) {
  try {
    const [h, s, l] = hexToHsl(baseColor);
    const shadowL = Math.max(l - 25, 10);
    const highlightL = Math.min(l + 20, 90);
    const highlightS = l < 30 ? Math.min(s + 15, 100) : s;
    return {
      shadow: hslToHex(h, s, shadowL),
      base: baseColor,
      highlight: hslToHex(h, highlightS, highlightL),
    };
  } catch {
    return { shadow: baseColor, base: baseColor, highlight: baseColor };
  }
}

function EggGraphic({
  baseColor,
  secondaryColor,
  crackLevel,
  opening,
}: {
  baseColor: string;
  secondaryColor: string;
  /** -1 = crack hidden (plain egg), 0–3 = Ditto crack stages. */
  crackLevel: number;
  /** True during the final burst/hatch (Ditto's 'opening'): shell fades out. */
  opening: boolean;
}) {
  const colors = createColorVariants(baseColor);
  const { shadow, highlight } = colors;

  // Base color dominates; secondary is only a subtle accent, matching Ditto's
  // gradient composition so the egg reads as one tinted shell (no white areas).
  const eggGradient = secondaryColor
    ? `radial-gradient(circle at 35% 25%, ${colors.highlight} 0%, ${colors.base} 30%, ${colors.shadow} 70%),
       radial-gradient(circle at 65% 75%, ${createColorVariants(secondaryColor).highlight}40 0%, transparent 50%)`
    : `radial-gradient(circle at 30% 25%, ${colors.highlight} 0%, ${colors.base} 40%, ${colors.shadow} 100%)`;

  const showCrack = crackLevel >= 0 || opening;
  // During 'opening' Ditto keeps the crack at level 3 as the shell fades.
  const level = opening ? 3 : crackLevel;

  return (
    <div className="relative flex size-full items-center justify-center">
      {/* Main egg shape — fixed 80% width / 100% height keeps Ditto's egg
          proportion regardless of the square slot's rendered size. During the
          burst the OUTER container (animate-egg-onboard-burst) fades/scales the
          whole egg — shell + cracks — out together, so we don't run a second
          shell-open animation here; `opening` only holds the crack at level 3. */}
      <div
        className="relative z-10 transition-all duration-500"
        style={{
          width: '80%',
          height: '100%',
          background: eggGradient,
          borderRadius: '50% 50% 50% 50% / 60% 60% 40% 40%',
          boxShadow: `inset -0.5em -0.5em 1em ${shadow}33, inset 0.5em 0.5em 1em ${highlight}26`,
          filter: level >= 1 ? 'brightness(1.1)' : 'brightness(1)',
        }}
      >
        {/* Soft highlight, tinted (no white) — matches Ditto. */}
        <div
          className="absolute"
          style={{
            top: '20%',
            left: '25%',
            width: '30%',
            height: '25%',
            background: `linear-gradient(135deg, ${highlight}80 0%, transparent 100%)`,
            borderRadius: '50%',
            filter: 'blur(2px)',
          }}
        />

        {/* Crack overlay — Ditto's viewBox / preserveAspectRatio and progressive
            paths, copied verbatim so the cracks align with the shell. */}
        {showCrack && (
          <svg
            className="absolute inset-0 pointer-events-none w-full h-full transition-opacity duration-300"
            viewBox="0 0 120 125"
            preserveAspectRatio="xMidYMid meet"
            style={{ height: '100%' }}
            aria-hidden
          >
            {/* ── Level 0: small central crack ── */}
            {level === 0 && (
              <>
                <path d="M53 63 L57 60 L63 64 L67 61" stroke="rgba(0,0,0,0.5)" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M57 60 L56 57" stroke="rgba(0,0,0,0.35)" strokeWidth="0.8" fill="none" strokeLinecap="round" />
                <path d="M63 64 L65 67" stroke="rgba(0,0,0,0.35)" strokeWidth="0.8" fill="none" strokeLinecap="round" />
                <path d="M54 64 L58 61 L64 65" stroke="rgba(255,255,255,0.12)" strokeWidth="0.6" fill="none" strokeLinecap="round" />
              </>
            )}

            {/* ── Level 1: medium crack expanding from center ── */}
            {level === 1 && (
              <>
                <path d="M42 61 L48 64 L53 60 L60 65 L67 59 L73 63 L78 60" stroke="rgba(0,0,0,0.55)" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M43 62 L49 65 L54 61 L61 66 L68 60 L74 64" stroke="rgba(255,255,255,0.12)" strokeWidth="0.6" fill="none" strokeLinecap="round" />
                <path d="M48 64 L46 69" stroke="rgba(0,0,0,0.4)" strokeWidth="1" strokeLinecap="round" />
                <path d="M67 59 L65 54" stroke="rgba(0,0,0,0.4)" strokeWidth="1" strokeLinecap="round" />
                <path d="M73 63 L76 68" stroke="rgba(0,0,0,0.35)" strokeWidth="0.9" strokeLinecap="round" />
                <path d="M53 60 L51 56" stroke="rgba(0,0,0,0.3)" strokeWidth="0.7" strokeLinecap="round" />
              </>
            )}

            {/* ── Level 2: larger crack reaching toward sides ── */}
            {level === 2 && (
              <>
                <path d="M30 63 L37 60 L44 65 L52 59 L60 64 L68 58 L76 63 L83 59 L90 64" stroke="rgba(0,0,0,0.6)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M31 64 L38 61 L45 66 L53 60 L61 65 L69 59 L77 64 L84 60" stroke="rgba(255,255,255,0.12)" strokeWidth="0.7" fill="none" strokeLinecap="round" />
                <path d="M37 60 L34 55" stroke="rgba(0,0,0,0.45)" strokeWidth="1.1" strokeLinecap="round" />
                <path d="M44 65 L41 71" stroke="rgba(0,0,0,0.4)" strokeWidth="1" strokeLinecap="round" />
                <path d="M52 59 L50 53" stroke="rgba(0,0,0,0.4)" strokeWidth="1" strokeLinecap="round" />
                <path d="M60 64 L63 70" stroke="rgba(0,0,0,0.4)" strokeWidth="1" strokeLinecap="round" />
                <path d="M68 58 L66 52" stroke="rgba(0,0,0,0.45)" strokeWidth="1.1" strokeLinecap="round" />
                <path d="M76 63 L79 69" stroke="rgba(0,0,0,0.4)" strokeWidth="1" strokeLinecap="round" />
                <path d="M83 59 L86 54" stroke="rgba(0,0,0,0.35)" strokeWidth="0.9" strokeLinecap="round" />
                <path d="M50 53 L48 50" stroke="rgba(0,0,0,0.25)" strokeWidth="0.7" strokeLinecap="round" />
                <path d="M63 70 L66 73" stroke="rgba(0,0,0,0.25)" strokeWidth="0.7" strokeLinecap="round" />
              </>
            )}

            {/* ── Level 3: full crack reaching shell edges ── */}
            {level >= 3 && (
              <>
                <path d="M15 62 L23 59 L32 64 L40 58 L50 65 L60 57 L70 64 L80 58 L88 63 L96 59 L105 64" stroke="rgba(0,0,0,0.65)" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M16 63 L24 60 L33 65 L41 59 L51 66 L61 58 L71 65 L81 59 L89 64 L97 60" stroke="rgba(255,255,255,0.13)" strokeWidth="0.8" fill="none" strokeLinecap="round" />
                <path d="M23 59 L19 53" stroke="rgba(0,0,0,0.5)" strokeWidth="1.3" strokeLinecap="round" />
                <path d="M32 64 L28 72" stroke="rgba(0,0,0,0.45)" strokeWidth="1.2" strokeLinecap="round" />
                <path d="M28 72 L25 76" stroke="rgba(0,0,0,0.3)" strokeWidth="0.9" strokeLinecap="round" />
                <path d="M40 58 L37 51" stroke="rgba(0,0,0,0.5)" strokeWidth="1.2" strokeLinecap="round" />
                <path d="M50 65 L47 73" stroke="rgba(0,0,0,0.45)" strokeWidth="1.2" strokeLinecap="round" />
                <path d="M37 51 L35 47" stroke="rgba(0,0,0,0.3)" strokeWidth="0.8" strokeLinecap="round" />
                <path d="M60 57 L58 50" stroke="rgba(0,0,0,0.5)" strokeWidth="1.3" strokeLinecap="round" />
                <path d="M60 57 L63 68" stroke="rgba(0,0,0,0.4)" strokeWidth="1.1" strokeLinecap="round" />
                <path d="M70 64 L73 71" stroke="rgba(0,0,0,0.45)" strokeWidth="1.2" strokeLinecap="round" />
                <path d="M80 58 L83 50" stroke="rgba(0,0,0,0.5)" strokeWidth="1.3" strokeLinecap="round" />
                <path d="M83 50 L86 46" stroke="rgba(0,0,0,0.3)" strokeWidth="0.8" strokeLinecap="round" />
                <path d="M88 63 L91 70" stroke="rgba(0,0,0,0.45)" strokeWidth="1.2" strokeLinecap="round" />
                <path d="M96 59 L99 52" stroke="rgba(0,0,0,0.5)" strokeWidth="1.2" strokeLinecap="round" />
                <path d="M105 64 L109 70" stroke="rgba(0,0,0,0.4)" strokeWidth="1.1" strokeLinecap="round" />
                <path d="M47 73 L44 77" stroke="rgba(0,0,0,0.25)" strokeWidth="0.7" strokeLinecap="round" />
                <path d="M73 71 L76 75" stroke="rgba(0,0,0,0.25)" strokeWidth="0.7" strokeLinecap="round" />
                <path d="M58 50 L55 46" stroke="rgba(0,0,0,0.25)" strokeWidth="0.7" strokeLinecap="round" />
                <path d="M19 53 L17 49" stroke="rgba(0,0,0,0.2)" strokeWidth="0.6" strokeLinecap="round" />
                <path d="M99 52 L102 48" stroke="rgba(0,0,0,0.2)" strokeWidth="0.6" strokeLinecap="round" />
              </>
            )}
          </svg>
        )}
      </div>
    </div>
  );
}
