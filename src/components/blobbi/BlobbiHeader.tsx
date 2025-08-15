import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoginArea } from "@/components/auth/LoginArea";
import { RelaySelector } from "@/components/RelaySelector";
import { CurrentBlobbiDisplay } from "./CurrentBlobbiDisplay";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export function BlobbiHeader() {
  const { user } = useCurrentUser();

  return (
    <header className="w-full bg-card border-b border-border px-6 py-4">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center space-x-3">
          <h1 className="text-2xl font-bold text-primary">🏝️ Blobbi Island</h1>
        </div>

        {/* Right side controls */}
        <div className="flex items-center space-x-4">
          {/* Current Blobbi Display - only show when logged in */}
          {user && (
            <CurrentBlobbiDisplay
              size="md"
              showFallback={false}
              className="transition-all duration-200 hover:scale-105"
            />
          )}

          {/* Login Area */}
          <LoginArea className="max-w-60" />

          {/* Relay Settings */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="icon" className="h-9 w-9">
                <Settings className="h-4 w-4" />
                <span className="sr-only">Relay Settings</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80" align="end">
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-sm">Nostr Relay Settings</h3>
                  <p className="text-xs text-muted-foreground">
                    Configure your connection to the Nostr network
                  </p>
                </div>
                <RelaySelector className="w-full" />
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </header>
  );
}