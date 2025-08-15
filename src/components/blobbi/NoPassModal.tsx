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
      <DialogContent className="max-w-md blobbi-card-xl border-2 border-red-300 dark:border-red-600 rounded-2xl theme-transition">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-center text-red-600 dark:text-red-400 mb-4">
            🚫 Access Denied
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 p-4">
          <div className="text-center">
            <div className="blobbi-card rounded-xl p-6 mb-4">
              <div className="text-6xl mb-4">🛗</div>
              <p className="text-lg font-semibold blobbi-text mb-2">
                You don't have an arcade pass!
              </p>
              <p className="text-sm blobbi-text-muted">
                Please purchase a ticket at the counter to use the elevator.
              </p>
            </div>

            <div className="blobbi-card rounded-lg p-3 mb-4 border-yellow-200 dark:border-yellow-700">
              <p className="text-sm blobbi-text">
                💡 Look for the ticket counter in the arcade to purchase an Arcade Pass for 20 coins.
              </p>
            </div>
          </div>

          <Button
            onClick={onClose}
            className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white rounded-xl border-0 font-bold theme-transition"
          >
            Got it!
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}