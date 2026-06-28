import { Skeleton } from "@/components/ui/skeleton";
import { MascotBlobbi } from "./MascotBlobbi";

interface BlobbiLoadingScreenProps {
  className?: string;
}

/**
 * BlobbiLoadingScreen — the cozy "peeking into the nest" loader.
 *
 * Used while the player's Blobbis are being fetched (and as the game's initial
 * loading state). The mascot greets the player and a soft grid of card-shaped
 * skeletons hints at the collection that's about to appear, matching the
 * warm island palette.
 */
export function BlobbiLoadingScreen({ className }: BlobbiLoadingScreenProps) {
  return (
    <div
      className={`flex min-h-full flex-col items-center justify-center bg-gradient-to-b from-island-sky/55 via-island-cream to-island-sand/60 p-4 sm:p-6 ${className ?? ""}`}
    >
      {/* Mascot greeter (hidden on short landscape to save height) */}
      <div className="mb-2 flex justify-center landscape:max-md:hidden">
        <MascotBlobbi size="md" />
      </div>

      <div className="space-y-1 text-center">
        <h2 className="text-xl font-bold text-island-ink">Peeking into your nest…</h2>
        <p className="text-sm text-island-ink-soft">
          Gathering your Blobbis from the island
        </p>
      </div>

      {/* Card-shaped skeletons that echo the collection grid */}
      <div className="mt-5 grid w-full max-w-md grid-cols-3 gap-3 sm:gap-4 landscape:max-md:max-w-lg landscape:max-md:grid-cols-4">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex flex-col items-center rounded-3xl border-2 border-island-wood/20 bg-island-cream p-3 shadow-cozy-soft"
          >
            <Skeleton className="aspect-square w-full rounded-2xl bg-island-cream-2" />
            <Skeleton className="mt-2.5 h-4 w-3/4 rounded-full bg-island-cream-2" />
            <Skeleton className="mt-2 h-3 w-1/2 rounded-full bg-island-cream-2" />
          </div>
        ))}
      </div>
    </div>
  );
}
