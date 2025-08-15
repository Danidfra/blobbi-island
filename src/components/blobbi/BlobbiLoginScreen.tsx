import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LoginArea } from "@/components/auth/LoginArea";
import { ExternalLink } from "lucide-react";

interface BlobbiLoginScreenProps {
  className?: string;
}

export function BlobbiLoginScreen({ className }: BlobbiLoginScreenProps) {
  return (
    <div className={`flex flex-col items-center justify-center min-h-full bg-gradient-to-b from-blue-100 to-green-100 ${className}`}>
      <Card className="w-full max-w-md mx-auto shadow-lg border-2">
        <CardContent className="p-8 text-center space-y-6">
          {/* Blobbi Island Logo/Title */}
          <div className="space-y-2">
            <h1 className="text-4xl font-bold text-primary">🏝️ Blobbi Island</h1>
            <p className="text-muted-foreground text-lg">
              Welcome to your virtual pet adventure!
            </p>
          </div>

          {/* Login Section */}
          <div className="space-y-4">
            <div className="space-y-2">
              <h2 className="text-xl font-semibold">Get Started</h2>
              <p className="text-sm text-muted-foreground">
                Login with Nostr to access your Blobbis
              </p>
            </div>
            
            <LoginArea className="w-full" />
          </div>

          {/* Create Account Option */}
          <div className="pt-4 border-t">
            <p className="text-sm text-muted-foreground mb-3">
              Don't have a Blobbi yet?
            </p>
            <Button 
              variant="outline" 
              className="w-full"
              onClick={() => window.open('https://blobbi.pet', '_blank')}
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Create Account at blobbi.pet
            </Button>
          </div>

          {/* Footer */}
          <div className="pt-4 text-xs text-muted-foreground">
            <p>Powered by Nostr • Vibed with MKStack</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}