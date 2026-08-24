// NOTE: This file should normally not be modified unless you are adding a new provider.
// To add new routes, edit the AppRouter.tsx file.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createHead, UnheadProvider } from '@unhead/react/client';
import { InferSeoMetaPlugin } from '@unhead/addons';
import { Suspense } from 'react';
import NostrProvider from '@/components/NostrProvider';
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NostrLoginProvider } from '@nostrify/react/login';
import { AppProvider } from '@/components/AppProvider';
import { CharacterEquipmentProvider } from '@/components/CharacterEquipmentProvider';
import { EconomyEntryController } from '@/components/EconomyEntryController';
import { IslandThemeSync } from '@/components/IslandThemeSync';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AppConfig } from '@/contexts/AppContext';
import { DEFAULT_ISLAND_THEME_ID } from '@/lib/island-themes';
import { PhotoBoothProvider } from '@/contexts/PhotoBoothContext';
import { DebugOverlaysProvider } from '@/contexts/DebugOverlaysContext';
import AppRouter from './AppRouter';

const head = createHead({
  plugins: [
    InferSeoMetaPlugin(),
  ],
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 60000, // 60 seconds - longer cache to reduce refetches
      gcTime: 300000, // 5 minutes
      retry: 1, // Reduce retry attempts to minimize blocking
      retryDelay: 1000, // 1 second retry delay
    },
  },
});

const defaultConfig: AppConfig = {
  // Island theme id — see src/lib/island-themes.ts.
  theme: DEFAULT_ISLAND_THEME_ID,
  relayUrl: "wss://relay.ditto.pub",
};

const presetRelays = [
  { url: 'wss://relay.ditto.pub', name: 'Ditto' },
  { url: 'wss://relay.primal.net', name: 'Primal' },
];

export function App() {
  return (
    <ErrorBoundary>
      <UnheadProvider head={head}>
        <AppProvider storageKey="nostr:app-config" defaultConfig={defaultConfig} presetRelays={presetRelays}>
          <QueryClientProvider client={queryClient}>
            <NostrLoginProvider storageKey='nostr:login'>
              <NostrProvider>
              {/* Renders nothing. Refreshes the selected theme's cached palette
                  and adopts a selection made on another device. It has to be
                  BELOW NostrProvider — AppProvider, which paints the theme, sits
                  above it and must never wait on a relay. */}
              <IslandThemeSync />
              <EconomyEntryController />
              <CharacterEquipmentProvider>
              <PhotoBoothProvider>
                <DebugOverlaysProvider>
                  <TooltipProvider>
                    <Toaster />
                    <Sonner />
                    <Suspense fallback={
                    <div className="min-h-screen bg-background flex items-center justify-center">
                      <div className="text-center space-y-4">
                        <div className="animate-spin motion-reduce:animate-none rounded-full h-8 w-8 border-2 border-island-wood/25 border-t-island-ocean mx-auto"></div>
                        <p className="text-island-ink-soft">Loading Blobbi Island...</p>
                      </div>
                    </div>
                  }>
                      <AppRouter />
                    </Suspense>
                  </TooltipProvider>
                </DebugOverlaysProvider>
              </PhotoBoothProvider>
              </CharacterEquipmentProvider>
              </NostrProvider>
            </NostrLoginProvider>
          </QueryClientProvider>
        </AppProvider>
      </UnheadProvider>
    </ErrorBoundary>
  );
}

export default App;
