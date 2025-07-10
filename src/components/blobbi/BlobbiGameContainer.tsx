import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface BlobbiGameContainerProps {
  children: ReactNode;
  className?: string;
}

export function BlobbiGameContainer({ children, className }: BlobbiGameContainerProps) {
  return (
    <div className={cn(
      "mx-auto bg-card border-2 border-border rounded-lg shadow-lg overflow-hidden",
      // Fixed dimensions as specified: 1046x697
      "w-[1046px] h-[697px]",
      // Responsive behavior for smaller screens
      "max-w-[95vw] max-h-[80vh]",
      // Ensure landscape orientation on mobile
      "landscape:max-w-[95vw] landscape:max-h-[90vh]",
      className
    )}>
      {children}
    </div>
  );
}