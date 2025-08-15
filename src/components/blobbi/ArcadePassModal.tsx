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
      <DialogContent className="max-w-md bg-gradient-to-br from-purple-100 to-pink-100 border-2 border-purple-300 rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-center text-purple-800 mb-4">
            🎟️ Arcade Pass
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6 p-4">
          <div className="text-center">
            <div className="bg-white/80 rounded-xl p-4 mb-4">
              <img 
                src="/assets/interactive/arcade-ticket.png" 
                alt="Arcade Pass" 
                className="w-20 h-20 mx-auto mb-2"
              />
              <p className="text-lg font-semibold text-gray-800">
                Purchase an Arcade Pass for <span className="text-yellow-600 font-bold">20 coins</span>
              </p>
            </div>
            
            <div className="bg-blue-50 rounded-lg p-3 mb-4">
              <p className="text-sm text-blue-800">
                🎮 Access all arcade floors<br/>
                🏢 Use the elevator freely<br/>
                ⏰ Valid until you leave the arcade
              </p>
            </div>
            
            <p className="text-sm text-gray-600 mb-4">
              Your current coins: <span className="font-bold text-yellow-600">{status.owner?.coins || 0}</span>
            </p>
          </div>
          
          <div className="flex gap-3">
            <Button 
              variant="outline" 
              onClick={onClose}
              className="flex-1 rounded-xl border-2 border-gray-300 hover:bg-gray-50"
            >
              Cancel
            </Button>
            <Button 
              onClick={handlePurchasePass}
              disabled={(status.owner?.coins || 0) < 20}
              className="flex-1 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white rounded-xl border-0 font-bold"
            >
              Buy Ticket
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}