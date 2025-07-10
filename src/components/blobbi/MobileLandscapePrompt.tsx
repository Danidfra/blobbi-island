import { RotateCcw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function MobileLandscapePrompt() {
  return (
    <div className="fixed inset-0 bg-background flex items-center justify-center p-4 z-50">
      <Card className="max-w-sm">
        <CardContent className="p-6 text-center space-y-4">
          <div className="flex justify-center">
            <RotateCcw className="h-12 w-12 text-primary animate-pulse" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold">Rotate Your Device</h2>
            <p className="text-muted-foreground">
              Blobbi Island works best in landscape mode. Please rotate your device to continue.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}