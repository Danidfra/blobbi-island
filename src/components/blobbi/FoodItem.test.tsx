import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TestApp } from '@/test/TestApp';
import { FoodItem } from './FoodItem';
import { useRef } from 'react';

// Mock component to provide container ref
function TestFoodItem() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mockOnPositionChange = vi.fn();

  return (
    <div ref={containerRef} style={{ width: 400, height: 600 }}>
      <FoodItem
        imageUrl="/assets/items/food/apple.png"
        position={{ x: 100, y: 200 }}
        onPositionChange={mockOnPositionChange}
        containerRef={containerRef}
        shelves={[170, 270, 370]}
        size={64}
      />
    </div>
  );
}

describe('FoodItem', () => {
  it('renders food item with correct image', async () => {
    render(
      <TestApp>
        <TestFoodItem />
      </TestApp>
    );

    const foodImage = await screen.findByAltText('Food item');
    expect(foodImage).toBeInTheDocument();
    expect(foodImage).toHaveAttribute('src', '/assets/items/food/apple.png');
  });

  it('applies correct positioning styles', async () => {
    render(
      <TestApp>
        <TestFoodItem />
      </TestApp>
    );

    const foodContainer = (await screen.findByAltText('Food item')).parentElement;
    expect(foodContainer).toHaveStyle({
      left: '68px', // 100 - 64/2
      top: '168px', // 200 - 64/2
      width: '64px',
      height: '64px',
    });
  });
});