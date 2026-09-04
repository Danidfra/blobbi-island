import { RotateCw } from "lucide-react";
import { MascotBlobbi } from "@/components/blobbi/MascotBlobbi";

/**
 * BlobbiPortraitGate: cozy, welcoming screen shown on mobile portrait.
 *
 * Frames the landscape-first requirement as a friendly invitation rather than a
 * technical warning: the mascot greets the player, then a gentle rotate hint
 * shows how to come on in. Feels like part of the game.
 */
export function BlobbiPortraitGate() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-gradient-to-b from-island-sky to-island-cream p-6 text-center">
      <div className="relative">
        <MascotBlobbi size="lg" />
        <div className="absolute -right-2 top-2 animate-cozy-wiggle">
          <RotateCw className="size-8 text-island-wood-dark" />
        </div>
      </div>

      <div className="space-y-2 max-w-xs">
        <h1 className="text-2xl font-bold text-island-ink">Welcome to Blobbi Island</h1>
        <p className="text-island-ink-soft">
          This island is best explored sideways. Turn your device to landscape to
          come on in.
        </p>
        <p className="inline-flex items-center gap-1.5 rounded-full bg-island-cream-2/80 px-3 py-1 text-sm font-medium text-island-wood-dark shadow-cozy-soft">
          <RotateCw className="size-4" />
          Rotate to enter
        </p>
      </div>
    </div>
  );
}
