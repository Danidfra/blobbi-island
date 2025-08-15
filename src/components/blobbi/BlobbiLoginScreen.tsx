import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LoginArea } from "@/components/auth/LoginArea";
import { ExternalLink } from "lucide-react";

interface BlobbiLoginScreenProps {
  className?: string;
}

export function BlobbiLoginScreen({ className }: BlobbiLoginScreenProps) {
  return (
    <div className={`flex flex-col items-center justify-center min-h-full blobbi-gradient-container ${className}`}>
      <Card className="w-full max-w-md mx-auto py-8 blobbi-card-xl shadow-lg border-2 border-purple-300 dark:border-purple-600">
        <CardContent className="blobbi-section text-center space-y-6">
          {/* Blobbi Island Logo/Title */}
          <div className="space-y-2">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-pink-500 bg-clip-text text-transparent">
              🏝️ Blobbi Island
            </h1>
            <p className="blobbi-text-muted text-lg">
              Welcome to your virtual pet adventure!
            </p>
          </div>

          {/* Login Section */}
          <div className="space-y-4">
            <div className="space-y-2">
              <h2 className="text-xl font-semibold blobbi-text">Get Started</h2>
              <p className="text-sm blobbi-text-muted">
                Login with Nostr to access your Blobbis
              </p>
            </div>

            <LoginArea className="w-full" />
          </div>

          {/* Create Account Option */}
          <div className="pt-4 border-t border-purple-200 dark:border-purple-700">
            <p className="text-sm blobbi-text-muted mb-3">
              Don't have a Blobbi yet?
            </p>
            <Button
              variant="outline"
              className="w-full blobbi-button border-purple-200 hover:bg-purple-50 dark:border-purple-700 dark:hover:bg-purple-900/20"
              onClick={() => window.open('https://blobbi.pet', '_blank')}
            >
              <ExternalLink className="w-4 h-4 mr-2 icon-purple" />
              Create Account at blobbi.pet
            </Button>
          </div>

          {/* Footer */}
          <div className="pt-4 text-xs blobbi-text-muted">
            <p>
              Powered by Nostr • Vibed with{" "}
              <span className="bg-gradient-to-r from-purple-600 to-pink-500 bg-clip-text text-transparent font-medium">
                MKStack
              </span>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}