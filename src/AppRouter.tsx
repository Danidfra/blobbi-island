import { BrowserRouter, Route, Routes } from "react-router-dom";
import { lazy, Suspense } from "react";
import { ScrollToTop } from "./components/ScrollToTop";

// Lazy load pages for better performance with loading states
const BlobbiIsland = lazy(() => import("./pages/BlobbiIsland").then(m => ({ default: m.BlobbiIsland })));
const MultiplayerDemo = lazy(() => import("./pages/MultiplayerDemo").then(m => ({ default: m.MultiplayerDemo })));
const NotFound = lazy(() => import("./pages/NotFound"));

/**
 * Internal Game Item authoring tools (`/tools/game-items`).
 *
 * Unlike the `/dev/*` harnesses below, this route SHIPS in production builds.
 * It is unlinked from the game's navigation, but that is discoverability rather
 * than a boundary — publishing an item definition requires a signature from an
 * account the user already controls, and the catalog rejects definitions from
 * any issuer but the official one regardless of which client produced them.
 * Gating the route on `import.meta.env.DEV` would only stop the issuer from
 * publishing from the deployed site. See `docs/game-item-tools.md`.
 */
const GameItemTools = lazy(() =>
  import("./pages/GameItemTools").then(m => ({ default: m.GameItemTools }))
);

/**
 * Development-only harnesses.
 *
 * `import.meta.env.DEV` is replaced by a literal `false` in a production build,
 * so each ternary below collapses to `null` and the dynamic import inside the
 * dead branch is dropped along with it — the pages are not merely unrouted in
 * production, their chunks are never emitted. `npm run build` is the check: no
 * `DevTheater` or `DevArcade` chunk may appear in `dist/`, which
 * `src/dev-routes.test.ts` asserts against the built output.
 */
const DevTheater = import.meta.env.DEV
  ? lazy(() => import("./pages/DevTheater").then(m => ({ default: m.DevTheater })))
  : null;

const DevArcade = import.meta.env.DEV
  ? lazy(() => import("./pages/DevArcade").then(m => ({ default: m.DevArcade })))
  : null;

// Ground-anchor room verification harness (Phase 2 diagnostics).
const DevRooms = import.meta.env.DEV
  ? lazy(() => import("./pages/DevRooms").then(m => ({ default: m.DevRooms })))
  : null;

// Item / inventory / placement inspector. Drives the REAL 31632, 31633 and
// 31634 service boundaries — see the module doc for why it has no local state.
const DevEquipment = import.meta.env.DEV
  ? lazy(() => import("./pages/DevEquipment").then(m => ({ default: m.DevEquipment })))
  : null;

// Visual-effect preview (Phase 8). Drives the PURE renderer with literal effect
// data — no signer, relay, inventory or equip state — so it also serves as the
// standing proof that drawing an effect needs none of them.
const DevBlobbiEffects = import.meta.env.DEV
  ? lazy(() => import("./pages/DevBlobbiEffects").then(m => ({ default: m.DevBlobbiEffects })))
  : null;

// Beach Treasure Hunt harness (Beach 1B). Simulation-only: drives the pure
// seeded model and the real UI with overlays and forced policies — no signer,
// no relay, no inventory or profile writes.
const DevTreasureHunt = import.meta.env.DEV
  ? lazy(() => import("./pages/DevTreasureHunt").then(m => ({ default: m.DevTreasureHunt })))
  : null;

// Loading component for lazy-loaded routes
const PageLoading = () => (
  <div className="min-h-screen bg-background flex items-center justify-center">
    <div className="text-center space-y-4">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
      <p className="text-muted-foreground">Loading page...</p>
    </div>
  </div>
);

export function AppRouter() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={
          <Suspense fallback={<PageLoading />}>
            <BlobbiIsland />
          </Suspense>
        } />
        <Route path="/multiplayer-demo" element={
          <Suspense fallback={<PageLoading />}>
            <MultiplayerDemo />
          </Suspense>
        } />
        <Route path="/tools/game-items" element={
          <Suspense fallback={<PageLoading />}>
            <GameItemTools />
          </Suspense>
        } />
        {DevTheater && (
          <Route path="/dev/theater" element={
            <Suspense fallback={<PageLoading />}>
              <DevTheater />
            </Suspense>
          } />
        )}
        {DevArcade && (
          <Route path="/dev/arcade" element={
            <Suspense fallback={<PageLoading />}>
              <DevArcade />
            </Suspense>
          } />
        )}
        {DevRooms && (
          <Route path="/dev/rooms" element={
            <Suspense fallback={<PageLoading />}>
              <DevRooms />
            </Suspense>
          } />
        )}
        {DevEquipment && (
          <Route path="/dev/equipment" element={
            <Suspense fallback={<PageLoading />}>
              <DevEquipment />
            </Suspense>
          } />
        )}
        {DevBlobbiEffects && (
          <Route path="/dev/blobbi-effects" element={
            <Suspense fallback={<PageLoading />}>
              <DevBlobbiEffects />
            </Suspense>
          } />
        )}
        {DevTreasureHunt && (
          <Route path="/dev/treasure-hunt" element={
            <Suspense fallback={<PageLoading />}>
              <DevTreasureHunt />
            </Suspense>
          } />
        )}
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={
          <Suspense fallback={<PageLoading />}>
            <NotFound />
          </Suspense>
        } />
      </Routes>
    </BrowserRouter>
  );
}
export default AppRouter;