import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface NoPassModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function NoPassModal({ isOpen, onClose }: NoPassModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md bg-gradient-to-br from-red-100 to-orange-100 border-2 border-red-300 rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-center text-red-800 mb-4">
            🚫 Access Denied
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6 p-4">
          <div className="text-center">
            <div className="bg-white/80 rounded-xl p-6 mb-4">
              <div className="text-6xl mb-4">🛗</div>
              <p className="text-lg font-semibold text-gray-800 mb-2">
                You don't have an arcade pass!
              </p>
              <p className="text-sm text-gray-600">
                Please purchase a ticket at the counter to use the elevator.
              </p>
            </div>
            
            <div className="bg-yellow-50 rounded-lg p-3 mb-4">
              <p className="text-sm text-yellow-800">
                💡 Look for the ticket counter in the arcade to purchase an Arcade Pass for 20 coins.
              </p>
            </div>
          </div>
          
          <Button 
            onClick={onClose}
            className="w-full bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white rounded-xl border-0 font-bold"
          >
            Got it!
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}