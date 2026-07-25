import { useState } from "react";
import LoginDialog from "@/components/auth/LoginDialog";
import SignupDialog from "@/components/auth/SignupDialog";
import { Button } from "@/components/ui/button";

interface BlobbiLoginScreenProps {
  className?: string;
}

/**
 * BlobbiLoginScreen — the "arrive at Blobbi Island" entry scene.
 *
 * The game frame becomes the island (blobbi-island-login.png), and a cozy wooden
 * sign (blobbi-island-login-wood.png) is centered on top, acting as the login
 * container. The content sits directly on the wood (no translucent card) so the
 * screen reads like a game start screen rather than an explanation card.
 *
 * Title: the "Blobbi Island" game logo image (blobbi-island-title.png) is used as
 * the title/wordmark, centered on the plate and scaled to fit without stretching.
 *
 * The main plate is deliberately minimal — just the logo, the "Enter Island" CTA,
 * and the "Get started" link. Any explanation of Nostr/login happens later inside
 * <LoginDialog /> / <SignupDialog />. Layout intent on the plate: logo near the
 * top, the CTA at the visual center, the secondary link just below it.
 *
 * Wording is deliberate: the plate is a cozy wooden sign, but the credential is
 * described plainly as a Nostr account/login — the private key is never called a
 * passport here.
 *
 * Auth is NOT rewritten: this reuses the stable <LoginDialog /> and
 * <SignupDialog /> (the same flow used by the account menu). The "Create a Nostr
 * account" link opens the in-app signup modal — no external redirect.
 *
 * Layout:
 *   - Desktop / portrait: scene fills the frame; the wood sign is centered both
 *     axes and sized to fit (object-contain, never stretched).
 *   - Mobile landscape (short): the same sign, kept centered with a small
 *     downward nudge so it stays fully visible (no clipping) and compact.
 */
export function BlobbiLoginScreen({ className }: BlobbiLoginScreenProps) {
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [signupDialogOpen, setSignupDialogOpen] = useState(false);

  // While an auth modal is open it presents its OWN wooden plate, so hide the
  // initial plate to avoid two competing wooden signs. The island background
  // stays visible; the plate fades back in when the modal closes.
  const authModalOpen = loginDialogOpen || signupDialogOpen;

  return (
    <div
      className={`relative flex h-full min-h-full w-full items-center justify-center overflow-hidden bg-island-ocean p-3 sm:p-6 ${className ?? ""}`}
    >
      {/* ── Island scene (full-bleed) ───────────────────────────────────── */}
      <img
        src="/assets/ui/branding/blobbi-island-login.png"
        alt="Blobbi Island"
        className="absolute inset-0 h-full w-full object-cover object-center select-none"
        draggable={false}
      />
      {/* Soft wash to gently focus the center and lift the sign off the scene. */}
      <div className="pointer-events-none absolute inset-0 bg-island-ink/15" />

      {/* ── Centered wooden sign (the login container) ──────────────────── */}
      {/* Height-driven + width-capped so the fixed-aspect plate fits inside the
          frame on both axes without ever stretching (desktop & landscape). A
          small downward nudge on mobile landscape sits it slightly lower.
          Hidden (faded out, non-interactive) while an auth modal is open so the
          modal's own wooden plate is the single visual focus. */}
      <div
        aria-hidden={authModalOpen}
        className={`relative z-10 aspect-[1536/1024] h-full max-h-[27rem] w-auto max-w-full transition-opacity duration-200 landscape:max-md:max-h-full landscape:max-md:translate-y-[3%] ${
          authModalOpen ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        {/* The wooden plate art — never stretched. */}
        <img
          src="/assets/ui/branding/blobbi-island-login-wood.png"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-contain drop-shadow-[0_18px_30px_rgba(58,42,26,0.45)] select-none"
          draggable={false}
        />

        {/* Login content sits in the flat central area of the sign, inset to
            clear the vines and curved edges. No translucent card — the wood is
            the container. Intentional plate layout: logo near the TOP, the
            "Enter Island" button at the visual CENTER, the link just below. */}
        <div className="absolute inset-x-[12%] inset-y-[15%] flex flex-col items-center text-center">
          {/* Title/logo near the top of the plate, like a title printed on the
              sign. Aspect preserved (object-contain), never stretched, capped so
              it never overflows or touches the vines.
              The asset ships with transparent padding, so a small negative top
              margin + slight upscale visually compensate to seat it nearer the
              top edge — see report: the proper long-term fix is to crop the
              transparent padding in the image asset itself. */}
          <img
            src="/assets/ui/branding/blobbi-island-title.png"
            alt="Blobbi Island"
            className="-mt-[6%] h-auto w-full max-w-[21rem] scale-110 object-contain drop-shadow-[0_6px_10px_rgba(58,42,26,0.45)] select-none landscape:max-md:max-w-[16rem]"
            draggable={false}
          />

          {/* Button (visual center) + secondary link (below) share the remaining
              space and are centered within it. */}
          <div className="flex w-full max-w-[19rem] flex-1 flex-col items-center justify-center gap-3 landscape:max-md:max-w-[16rem] landscape:max-md:gap-2">
            {/* Enter (opens the stable login dialog). Cozy, game-like pill with a
                warm vertical gradient, cream border and layered depth shadow. */}
            <Button
              onClick={() => setLoginDialogOpen(true)}
              className="w-full rounded-full border-2 border-island-cream/80 bg-gradient-to-b from-[#A07EF0] to-island-purple px-5 py-2.5 text-base font-bold tracking-wide text-white [text-shadow:0_1px_2px_rgba(58,42,26,0.45)] shadow-[0_6px_0_#6B4FC4,0_10px_18px_rgba(58,42,26,0.35)] transition-all duration-150 ease-cozy hover:-translate-y-0.5 hover:from-[#AB8BF3] hover:to-[#9476EC] active:translate-y-0.5 active:shadow-[0_3px_0_#6B4FC4,0_6px_12px_rgba(58,42,26,0.3)] landscape:max-md:py-2 landscape:max-md:text-sm">
              <span className="truncate">Enter Island</span>
            </Button>

            {/* First time here — opens the in-app signup modal (no redirect).
                Cream text with a dark shadow so it stays readable on the wood. */}
            <Button
              variant="link"
              className="h-auto p-0 text-sm font-bold text-island-cream underline decoration-island-cream/50 underline-offset-4 [text-shadow:0_1px_3px_rgba(58,42,26,0.85)] transition-colors hover:text-white hover:decoration-white/70 landscape:max-md:text-xs"
              onClick={() => setSignupDialogOpen(true)}
            >
              New here? Get started
            </Button>
          </div>
        </div>
      </div>

      {/* Stable auth dialogs (logic unchanged) */}
      <LoginDialog
        isOpen={loginDialogOpen}
        onClose={() => setLoginDialogOpen(false)}
        onLogin={() => {
          setLoginDialogOpen(false);
          setSignupDialogOpen(false);
        }}
        onSignup={() => setSignupDialogOpen(true)}
      />
      <SignupDialog
        isOpen={signupDialogOpen}
        onClose={() => setSignupDialogOpen(false)}
      />
    </div>
  );
}
