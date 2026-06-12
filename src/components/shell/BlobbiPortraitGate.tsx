import { RotateCw } from "lucide-react";
import { MascotBlobbi } from "@/components/blobbi/MascotBlobbi";

/**
 * BlobbiPortraitGate — cozy, in-world screen shown on mobile portrait.
 *
 * Replaces the old technical "Rotate Your Device" warning with the purple
 * mascot inviting the player to turn their device. Feels like part of the game.
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
        <h1 className="text-2xl font-bold text-island-ink">Turn your island sideways!</h1>
        <p className="text-island-ink-soft">
          Blobbi Island is best explored in landscape. Rotate your device to enter the island.
        </p>
      </div>
    </div>
  );
}
