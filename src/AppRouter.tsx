import { BrowserRouter, Route, Routes } from "react-router-dom";
import { lazy, Suspense } from "react";
import { ScrollToTop } from "./components/ScrollToTop";

// Lazy load pages for better performance with loading states
const BlobbiIsland = lazy(() => import("./pages/BlobbiIsland").then(m => ({ default: m.BlobbiIsland })));
const MultiplayerDemo = lazy(() => import("./pages/MultiplayerDemo").then(m => ({ default: m.MultiplayerDemo })));
const NotFound = lazy(() => import("./pages/NotFound"));

/**
 * Development-only theater harness.
 *
 * `import.meta.env.DEV` is replaced by a literal `false` in a production build,
 * so the ternary below collapses to `null` and the dynamic import inside the
 * dead branch is dropped along with it — the page is not merely unrouted in
 * production, its chunk is never emitted. `npm run build` is the check: no
 * `DevTheater` chunk may appear in `dist/`.
 */
const DevTheater = import.meta.env.DEV
  ? lazy(() => import("./pages/DevTheater").then(m => ({ default: m.DevTheater })))
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
        {DevTheater && (
          <Route path="/dev/theater" element={
            <Suspense fallback={<PageLoading />}>
              <DevTheater />
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