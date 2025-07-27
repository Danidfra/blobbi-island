import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { MovementBlockerProvider } from "@/contexts/MovementBlockerContext";

interface BlobbiGameContainerProps {
  children: ReactNode;
  className?: string;
}

export function BlobbiGameContainer({ children, className }: BlobbiGameContainerProps) {
  return (
    <div className={cn(
      "relative mx-auto bg-card border-2 border-border rounded-lg shadow-lg overflow-hidden",
      // Fixed dimensions as specified: 1046x697
      "w-[1046px] h-[697px]",
      className
    )}>
      <MovementBlockerProvider>
        {children}
      </MovementBlockerProvider>
    </div>
  );
}