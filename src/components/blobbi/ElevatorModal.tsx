import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useLocation } from '@/hooks/useLocation';
import type { LocationId } from '@/lib/location-types';

interface ElevatorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface FloorOption {
  id: string;
  name: string;
  description: string;
  icon: string;
  location: string;
}

const floors: FloorOption[] = [
  {
    id: 'floor-1',
    name: 'Floor 1',
    description: 'Games on upper level',
    icon: '🎮',
    location: 'arcade-1'
  },
  {
    id: 'ground-floor',
    name: 'Ground floor',
    description: 'Entrance with prizes and tickets',
    icon: '🎯',
    location: 'arcade'
  },
  {
    id: 'basement',
    name: 'Basement (-1)',
    description: 'Attractions and surprises',
    icon: '🔍',
    location: 'arcade-minus1'
  }
];

export function ElevatorModal({ isOpen, onClose }: ElevatorModalProps) {
  const { setCurrentLocation } = useLocation();

  const handleFloorSelect = (location: string) => {
    setCurrentLocation(location as LocationId);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md bg-gradient-to-br from-blue-100 to-indigo-100 border-2 border-blue-300 rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-center text-blue-800 mb-4">
            🛗 Select Floor
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-center text-gray-700 mb-6">
            Choose which floor you want to visit:
          </p>

          <div className="space-y-3">
            {floors.map((floor) => (
              <Button
                key={floor.id}
                onClick={() => handleFloorSelect(floor.location)}
                className="flex justify-between w-full p-4 h-auto bg-white hover:bg-blue-50 text-left border-2 border-blue-200 hover:border-blue-400 rounded-xl transition-all duration-200"
                variant="outline"
              >
                  <div className='flex items-center space-x-4'>
                    <div className="text-2xl">{floor.icon}</div>
                    <div className="flex-1">
                      <div className="font-bold text-blue-800">{floor.name}</div>
                      <div className="text-sm text-gray-600">{floor.description}</div>
                    </div>
                  </div>
                  <div className="text-blue-500">→</div>
              </Button>
            ))}
          </div>

          <Button
            variant="outline"
            onClick={onClose}
            className="w-full mt-6 rounded-xl border-2 border-gray-300 hover:bg-gray-50"
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}