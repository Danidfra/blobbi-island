import { ExternalLink, Heart, ShieldCheck } from "lucide-react";
import { LoginArea } from "@/components/auth/LoginArea";
import { MascotBlobbi } from "@/components/blobbi/MascotBlobbi";
import { Button } from "@/components/ui/button";

interface BlobbiLoginScreenProps {
  className?: string;
}

/**
 * BlobbiLoginScreen — the cozy "enter the island" gate.
 *
 * Frames signing in as arriving at Blobbi Island with your passport. The mascot
 * greets the player and the copy is friendly. Kept compact so it fits inside the
 * game frame on small laptops and in mobile landscape without being clipped.
 *
 * The actual auth flow is unchanged: it still uses the stable <LoginArea />.
 */
export function BlobbiLoginScreen({ className }: BlobbiLoginScreenProps) {
  return (
    <div
      className={`flex min-h-full flex-col items-center justify-center overflow-y-auto bg-gradient-to-b from-island-sky/70 via-island-cream to-island-sand/60 p-3 sm:p-6 ${className ?? ""}`}
    >
      <div className="w-full max-w-sm rounded-3xl border-island-wood bg-island-cream p-4 text-center landscape:max-md:rounded-2xl landscape:max-md:border-0 landscape:max-md:bg-transparent landscape:max-md:p-2 landscape:max-md:shadow-none sm:max-w-md sm:border-4 sm:p-6 sm:shadow-cozy-frame">
        {/* Mascot greeter (hidden on short landscape to save height) */}
        <div className="mb-1 flex justify-center landscape:max-md:hidden">
          <MascotBlobbi size="md" />
        </div>

        {/* Welcome */}
        <div className="space-y-0.5">
          <h1 className="text-2xl font-bold text-island-ink sm:text-3xl">
            Welcome to Blobbi Island
          </h1>
          <p className="text-sm text-island-ink-soft">
            A cozy world where your Blobbi lives, plays, and waits for you.
          </p>
        </div>

        {/* Passport explainer */}
        <div className="mt-4 flex items-center gap-2.5 rounded-2xl border-2 border-island-wood/20 bg-island-cream-2/70 p-3 text-left">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-island-sand text-island-wood-dark shadow-cozy-soft">
            <ShieldCheck className="size-4" />
          </span>
          <p className="text-xs leading-relaxed text-island-ink-soft">
            Your passport keeps your Blobbi safe and lets you return any time —
            no email, no password.
          </p>
        </div>

        {/* Enter (uses the existing, stable auth flow) */}
        <div className="mt-4">
          <LoginArea className="w-full" />
        </div>

        {/* First time here */}
        <div className="mt-4 border-t-2 border-dashed border-island-wood/20 pt-3">
          <p className="mb-2 text-xs text-island-ink-soft">
            New to the island? Hatch your first Blobbi.
          </p>
          <Button
            variant="outline"
            className="w-full rounded-full border-2 border-island-wood/40 bg-island-cream-2 text-island-ink shadow-cozy-soft transition-transform duration-150 ease-cozy hover:scale-[1.02] hover:bg-island-sand"
            onClick={() => window.open("https://blobbi.pet", "_blank")}
          >
            <Heart className="mr-2 size-4 text-island-purple" />
            Start at blobbi.pet
            <ExternalLink className="ml-2 size-3.5 opacity-60" />
          </Button>
        </div>
      </div>
    </div>
  );
}
