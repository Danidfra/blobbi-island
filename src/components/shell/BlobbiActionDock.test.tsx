import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LocationContext } from '@/contexts/LocationContextValue';
import type { LocationId } from '@/lib/location-types';
import { clearFirstSessionPreferences } from '@/lib/first-session';
import { BlobbiActionDock } from './BlobbiActionDock';

function Dock({ location }: { location: LocationId }) {
  return (
    <LocationContext.Provider
      value={{
        currentLocation: location,
        setCurrentLocation: vi.fn(),
        previousLocation: null,
        isMapModalOpen: false,
        setIsMapModalOpen: vi.fn(),
        isTransitioning: false,
      }}
    >
      <BlobbiActionDock />
    </LocationContext.Provider>
  );
}

const expandedControl = () => screen.queryByRole('button', { name: 'Collapse action dock' });
const collapsedControl = () => screen.queryByRole('button', { name: 'Open action dock' });

beforeEach(() => clearFirstSessionPreferences());

describe('the action dock', () => {
  it('starts OPEN so the available actions are discoverable', () => {
    render(<Dock location="town" />);
    expect(expandedControl()).not.toBeNull();
    expect(collapsedControl()).toBeNull();
    expect(screen.getByText('Talk')).toBeInTheDocument();
  });

  it('does not fold itself when the player changes room', () => {
    const { rerender } = render(<Dock location="town" />);
    rerender(<Dock location="beach" />);
    rerender(<Dock location="arcade" />);
    expect(expandedControl()).not.toBeNull();
  });

  it('folds only when the player says so, and remembers that across a remount this visit', () => {
    const first = render(<Dock location="town" />);
    fireEvent.click(expandedControl()!);
    expect(collapsedControl()).not.toBeNull();
    first.unmount();

    render(<Dock location="beach" />);
    expect(collapsedControl()).not.toBeNull();
    expect(expandedControl()).toBeNull();

    // And opening it again is remembered too.
    fireEvent.click(collapsedControl()!);
    expect(expandedControl()).not.toBeNull();
  });
});
