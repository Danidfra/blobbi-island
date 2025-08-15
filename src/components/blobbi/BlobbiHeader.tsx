import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoginArea } from "@/components/auth/LoginArea";
import { RelaySelector } from "@/components/RelaySelector";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CurrentBlobbiDisplay } from "./CurrentBlobbiDisplay";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface BlobbiHeaderProps {
  onSwitchBlobbi?: () => void;
}

export function BlobbiHeader({ onSwitchBlobbi }: BlobbiHeaderProps) {
  const { user } = useCurrentUser();

  return (
    <header className="w-full blobbi-card border-b border-purple-200 dark:border-purple-700 px-6 py-4 theme-transition">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center space-x-3">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-600 to-pink-500 bg-clip-text text-transparent">
            🏝️ Blobbi Island
          </h1>
        </div>

        {/* Right side controls */}
        <div className="flex items-center space-x-3">
          {/* Current Blobbi Display - only show when logged in and clickable */}
          {user && onSwitchBlobbi && (
            <CurrentBlobbiDisplay
              size="md"
              showFallback={false}
              interactive={true}
              onClick={onSwitchBlobbi}
              className="transition-all duration-200 hover:scale-105 blobbi-gradient-frame p-2 cursor-pointer"
            />
          )}

          {/* Theme Toggle */}
          <ThemeToggle />

          {/* Relay Settings */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9 blobbi-button border-purple-200 hover:bg-purple-50 dark:border-purple-700 dark:hover:bg-purple-900/20"
              >
                <Settings className="h-4 w-4 icon-purple" />
                <span className="sr-only">Relay Settings</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 blobbi-card border-purple-200 dark:border-purple-700" align="end">
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-sm blobbi-text">Nostr Relay Settings</h3>
                  <p className="text-xs blobbi-text-muted">
                    Configure your connection to the Nostr network
                  </p>
                </div>
                <RelaySelector className="w-full" />
              </div>
            </PopoverContent>
          </Popover>

          {/* Login Area */}
          <LoginArea className="max-w-60" />
        </div>
      </div>
    </header>
  );
}