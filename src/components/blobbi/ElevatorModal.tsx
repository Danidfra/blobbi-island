import React from 'react';
import { BlobbiModal } from '@/components/ui/blobbi-modal';
import { SettingsRow } from '@/components/ui/settings-row';
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
  const { setCurrentLocation, currentLocation } = useLocation();

  const handleFloorSelect = (location: string) => {
    setCurrentLocation(location as LocationId);
    onClose();
  };

  return (
    <BlobbiModal
      open={isOpen}
      onOpenChange={(next) => !next && onClose()}
      presentation="in-frame"
      size="sm"
      title="Select floor"
      description="Choose which floor you want to visit."
      icon="🛗"
    >
      {/*
        A plain list of actions, deliberately not a radiogroup: choosing a
        floor travels and closes the window, so nothing here stays "selected"
        for the player to change their mind about. The floor they are already
        on is marked with `aria-current` by the row itself.
      */}
      <div className="space-y-1">
        {floors.map((floor) => (
          <SettingsRow
            key={floor.id}
            icon={floor.icon}
            label={floor.name}
            description={floor.description}
            selected={floor.location === currentLocation}
            onClick={() => handleFloorSelect(floor.location)}
          />
        ))}
      </div>
    </BlobbiModal>
  );
}
