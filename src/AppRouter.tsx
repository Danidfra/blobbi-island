import { BrowserRouter, Route, Routes } from "react-router-dom";
import { lazy } from "react";
import { ScrollToTop } from "./components/ScrollToTop";

// Lazy load pages for better performance
const BlobbiIsland = lazy(() => import("./pages/BlobbiIsland").then(m => ({ default: m.BlobbiIsland })));
const Index = lazy(() => import("./pages/Index"));
const NotFound = lazy(() => import("./pages/NotFound"));

export function AppRouter() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<BlobbiIsland />} />
        <Route path="/original" element={<Index />} />
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
export default AppRouter;