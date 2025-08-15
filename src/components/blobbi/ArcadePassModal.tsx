import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useOptimizedStatus } from '@/hooks/useOptimizedStatus';
import { useToast } from '@/hooks/useToast';

interface ArcadePassModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ArcadePassModal({ isOpen, onClose }: ArcadePassModalProps) {
  const { status, updateOwnerCoins } = useOptimizedStatus();
  const { toast } = useToast();

  const handlePurchasePass = () => {
    const currentCoins = status.owner?.coins || 0;

    if (currentCoins < 20) {
      toast({
        title: "Insufficient Coins",
        description: "You need 20 coins to purchase an Arcade Pass.",
        variant: "destructive",
      });
      return;
    }

    // Deduct 20 coins
    updateOwnerCoins(currentCoins - 20);

    // Set the arcade pass in sessionStorage
    sessionStorage.setItem('has-arcade-pass', 'true');

    toast({
      title: "Arcade Pass Purchased!",
      description: "You can now use the elevator to explore different floors.",
    });

    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md blobbi-card-xl blobbi-gradient-container border-2 border-purple-300 dark:border-purple-600 rounded-2xl theme-transition">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-center bg-gradient-to-r from-purple-600 to-pink-500 bg-clip-text text-transparent mb-4">
            🎟️ Arcade Pass
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 p-4">
          <div className="text-center">
            <div className="blobbi-card rounded-xl p-4 mb-4">
              <img
                src="/assets/interactive/arcade-ticket.png"
                alt="Arcade Pass"
                className="w-20 h-20 mx-auto mb-2"
              />
              <p className="text-lg font-semibold blobbi-text">
                Purchase an Arcade Pass for <span className="icon-yellow font-bold">20 coins</span>
              </p>
            </div>

            <div className="blobbi-card rounded-lg p-3 mb-4 border-blue-200 dark:border-blue-700">
              <p className="text-sm blobbi-text">
                🎮 Access all arcade floors<br/>
                🏢 Use the elevator freely<br/>
                ⏰ Valid until you leave the arcade
              </p>
            </div>

            <p className="text-sm blobbi-text-muted mb-4">
              Your current coins: <span className="font-bold icon-yellow">{status.owner?.coins || 0}</span>
            </p>
          </div>

          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1 blobbi-button rounded-xl border-2 border-purple-200 hover:bg-purple-50 dark:border-purple-700 dark:hover:bg-purple-900/20"
            >
              Cancel
            </Button>
            <Button
              onClick={handlePurchasePass}
              disabled={(status.owner?.coins || 0) < 20}
              className="flex-1 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white rounded-xl border-0 font-bold theme-transition"
            >
              Buy Ticket
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}