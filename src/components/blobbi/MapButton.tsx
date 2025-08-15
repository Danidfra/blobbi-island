import React from 'react';
import { cn } from '@/lib/utils';
import { useLocation } from '@/hooks/useLocation';
import { Map } from 'lucide-react';

interface MapButtonProps {
  className?: string;
}

export function MapButton({ className }: MapButtonProps) {
  const { setIsMapModalOpen } = useLocation();

  const handleOpenMap = () => {
    setIsMapModalOpen(true);
  };

  return (
    <button
      onClick={handleOpenMap}
      className={cn(
        "bg-white/90 backdrop-blur-sm border border-border rounded-full",
        "p-2 sm:p-3 shadow-lg hover:shadow-xl",
        "transition-all duration-300 ease-out",
        "hover:scale-105 active:scale-95",
        "text-foreground hover:text-primary",
        "group",
        className
      )}
      title="Open Map"
      aria-label="Open Map"
    >
      <Map className="w-5 h-5 sm:w-6 sm:h-6 transition-transform duration-300 group-hover:scale-110" />
    </button>
  );
}