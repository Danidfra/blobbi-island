import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2 } from "lucide-react";

interface BlobbiLoadingScreenProps {
  className?: string;
}

export function BlobbiLoadingScreen({ className }: BlobbiLoadingScreenProps) {
  return (
    <div className={`flex flex-col items-center justify-center min-h-full bg-gradient-to-b from-blue-100 to-green-100 p-6 ${className}`}>
      <Card className="w-full max-w-md mx-auto shadow-lg border-2">
        <CardContent className="p-8 text-center space-y-6">
          {/* Loading Animation */}
          <div className="flex justify-center">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
          </div>

          {/* Loading Text */}
          <div className="space-y-2">
            <h2 className="text-xl font-semibold">Loading Your Blobbis...</h2>
            <p className="text-muted-foreground text-sm">
              Fetching your companions from the Nostr network
            </p>
          </div>

          {/* Loading Skeleton Cards */}
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Preparing your island...
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              {[1, 2].map((i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-16 w-full rounded-lg" />
                  <Skeleton className="h-3 w-3/4 mx-auto" />
                </div>
              ))}
            </div>
          </div>

          {/* Progress Indicator */}
          <div className="space-y-2">
            <div className="w-full bg-muted rounded-full h-2">
              <div className="bg-primary h-2 rounded-full animate-pulse" style={{ width: '60%' }} />
            </div>
            <p className="text-xs text-muted-foreground">
              This may take a few moments...
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}