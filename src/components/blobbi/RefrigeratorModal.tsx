
import React from 'react';
import { Dialog, DialogContent, DialogClose } from '@/components/ui/dialog';
import { X } from 'lucide-react';

interface RefrigeratorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function RefrigeratorModal({ isOpen, onClose }: RefrigeratorModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="p-0 bg-transparent border-none max-w-md w-full">
        <div className="relative">
          <img
            src="/assets/interactive/furniture/refrigerator-open.png"
            alt="Refrigerator open"
            className="w-full h-auto"
          />
          <DialogClose asChild /> 
        </div>
      </DialogContent>
    </Dialog>
  );
}
