/**
 * Bounded, paged collection browsing.
 *
 * The point of this component is a promise about HEIGHT: owning more things
 * must not make the window taller. Everything below is a way that promise, or
 * the navigation that makes it usable, could quietly break.
 *
 * The clamping cases matter most. A page index is state that outlives the
 * collection it indexes — an item is used up, a filter changes, a cosmetic
 * stops fitting — and a stale index renders an empty grid with working arrows.
 */

import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import { CollectionGrid, COLLECTION_PAGE_SIZE } from './CollectionGrid';

function items(count: number) {
  return Array.from({ length: count }, (_, i) => ({ id: `i${i}`, name: `Item ${i}` }));
}

function renderGrid(count: number, resetKey?: string) {
  return render(
    <CollectionGrid
      items={items(count)}
      keyOf={(i) => i.id}
      resetKey={resetKey}
      label="your items"
      renderItem={(i) => <button type="button" data-testid={`tile-${i.id}`}>{i.name}</button>}
    />,
  );
}

const tiles = () =>
  Array.from(screen.getByTestId('collection-grid').querySelectorAll('[data-testid^="tile-"]'));

describe('paging', () => {
  it('shows one page at a time', () => {
    renderGrid(20);
    expect(tiles()).toHaveLength(COLLECTION_PAGE_SIZE);
    expect(screen.getByTestId('collection-grid')).toHaveAttribute('data-page', '1');
    expect(screen.getByTestId('collection-grid')).toHaveAttribute('data-page-count', '3');
  });

  it('moves forward and back', () => {
    renderGrid(20);
    expect(screen.getByTestId('page-status')).toHaveTextContent('1–9 of 20');

    fireEvent.click(screen.getByTestId('page-next'));
    expect(screen.getByTestId('page-status')).toHaveTextContent('10–18 of 20');
    expect(screen.getByTestId('tile-i9')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('page-previous'));
    expect(screen.getByTestId('page-status')).toHaveTextContent('1–9 of 20');
  });

  it('shows a short last page rather than padding it', () => {
    renderGrid(20);
    fireEvent.click(screen.getByTestId('page-next'));
    fireEvent.click(screen.getByTestId('page-next'));
    expect(tiles()).toHaveLength(2);
    expect(screen.getByTestId('page-status')).toHaveTextContent('19–20 of 20');
  });

  it('stops at both ends rather than wrapping', () => {
    // Silently looping is disorienting when you cannot see the collection size.
    renderGrid(20);
    expect(screen.getByTestId('page-previous')).toBeDisabled();
    expect(screen.getByTestId('page-next')).not.toBeDisabled();

    fireEvent.click(screen.getByTestId('page-next'));
    fireEvent.click(screen.getByTestId('page-next'));
    expect(screen.getByTestId('page-next')).toBeDisabled();
    expect(screen.getByTestId('page-previous')).not.toBeDisabled();
  });
});

describe('when there is only one page', () => {
  it('shows no controls at all', () => {
    // A player with four items should never see pagination chrome.
    renderGrid(4);
    expect(screen.queryByTestId('page-controls')).toBeNull();
    expect(tiles()).toHaveLength(4);
  });

  it('shows none for an exactly-full page either', () => {
    renderGrid(COLLECTION_PAGE_SIZE);
    expect(screen.queryByTestId('page-controls')).toBeNull();
  });

  it('shows them for one item more than a page', () => {
    renderGrid(COLLECTION_PAGE_SIZE + 1);
    expect(screen.getByTestId('page-controls')).toBeInTheDocument();
    expect(screen.getByTestId('collection-grid')).toHaveAttribute('data-page-count', '2');
  });
});

describe('the page index survives the collection changing', () => {
  it('resets to the first page when the collection is a new one', () => {
    function Harness() {
      const [key, setKey] = useState('food');
      return (
        <>
          <button type="button" onClick={() => setKey('toys')}>
            switch
          </button>
          <CollectionGrid
            items={items(20)}
            keyOf={(i) => i.id}
            resetKey={key}
            label="items"
            renderItem={(i) => <span data-testid={`tile-${i.id}`}>{i.name}</span>}
          />
        </>
      );
    }
    render(<Harness />);

    fireEvent.click(screen.getByTestId('page-next'));
    expect(screen.getByTestId('page-status')).toHaveTextContent('10–18 of 20');

    // Landing on page 2 of something you just opened is disorienting.
    fireEvent.click(screen.getByText('switch'));
    expect(screen.getByTestId('page-status')).toHaveTextContent('1–9 of 20');
  });

  it('clamps to the last real page when the collection shrinks', () => {
    function Harness() {
      const [count, setCount] = useState(20);
      return (
        <>
          <button type="button" onClick={() => setCount(4)}>
            consume
          </button>
          <CollectionGrid
            items={items(count)}
            keyOf={(i) => i.id}
            label="items"
            renderItem={(i) => <span data-testid={`tile-${i.id}`}>{i.name}</span>}
          />
        </>
      );
    }
    render(<Harness />);

    fireEvent.click(screen.getByTestId('page-next'));
    fireEvent.click(screen.getByTestId('page-next'));
    expect(screen.getByTestId('collection-grid')).toHaveAttribute('data-page', '3');

    // Using up the last of something must not leave an empty grid with working
    // arrows pointing at nothing.
    fireEvent.click(screen.getByText('consume'));
    expect(screen.getByTestId('collection-grid')).toHaveAttribute('data-page', '1');
    expect(tiles()).toHaveLength(4);
    expect(screen.queryByTestId('page-controls')).toBeNull();
  });
});

describe('accessibility', () => {
  it('names the grid and both arrows', () => {
    renderGrid(20);
    expect(screen.getByRole('listbox', { name: 'your items' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Previous page of your items' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page of your items' })).toBeInTheDocument();
  });

  it('announces the page politely', () => {
    // The grid's contents change without focus moving, which a screen reader
    // would otherwise not mention.
    renderGrid(20);
    expect(screen.getByTestId('page-status')).toHaveAttribute('aria-live', 'polite');
  });

  it('keeps the arrows keyboard-reachable buttons', () => {
    renderGrid(20);
    const next = screen.getByTestId('page-next');
    expect(next.tagName).toBe('BUTTON');
    expect(next).toHaveAttribute('type', 'button');
  });
});
