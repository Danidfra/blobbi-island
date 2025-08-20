import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useLocation } from '@/hooks/useLocation';

const GEM_VALUES = {
  'stone.png': 1,
  'gem-1.png': 10,
  'gem-2.png': 25,
  'gem-3.png': 50,
};

type Gem = keyof typeof GEM_VALUES;

interface MinedItem {
  id: number;
  type: Gem;
  position: { x: number; y: number };
}

export function MiningGame() {
  const { setCurrentLocation } = useLocation();
  const [gameState, setGameState] = useState<'instructions' | 'playing' | 'results'>('instructions');
  const [energy, setEnergy] = useState(100);
  const [clicks, setClicks] = useState(0);
  const [minedItems, setMinedItems] = useState<MinedItem[]>([]);
  const [holes, setHoles] = useState<{ x: number; y: number }[]>([]);
  const miningAreaRef = useRef<HTMLDivElement>(null);

  const startGame = () => {
    setGameState('playing');
  };

  const finishMining = () => {
    setGameState('results');
  };

  const handleMineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (energy <= 20) {
      finishMining();
      return;
    }

    const rect = miningAreaRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setHoles(prev => [...prev, { x, y }]);
    setEnergy(prev => prev - 10);
    setClicks(prev => prev + 1);

    const random = Math.random();
    let gem: Gem;
    if (random < 0.05) {
      gem = 'gem-3.png';
    } else if (random < 0.15) {
      gem = 'gem-2.png';
    } else if (random < 0.3) {
      gem = 'gem-1.png';
    } else {
      gem = 'stone.png';
    }

    setMinedItems(prev => [...prev, { id: Date.now(), type: gem, position: { x, y } }]);
  };

  const renderInstructions = () => (
    <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Mining Game</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p>Objective: Click the wall to find gems and earn coins.</p>
          <p>Energy: Each click consumes 10 energy. The game ends if energy is 20 or less.</p>
          <p>Click the wall to start mining!</p>
          <Button onClick={startGame}>Start</Button>
        </CardContent>
      </Card>
    </div>
  );

  const renderResults = () => {
    const results = minedItems.reduce((acc, item) => {
      acc[item.type] = (acc[item.type] || 0) + 1;
      return acc;
    }, {} as Record<Gem, number>);

    const totalCoins = Object.entries(results).reduce((acc, [gem, count]) => {
      return acc + (GEM_VALUES[gem as Gem] * count);
    }, 0);

    return (
      <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Mining Results</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>Total Clicks: {clicks}</p>
            <ul>
              {Object.entries(results).map(([gem, count]) => (
                <li key={gem}>{gem}: {count}</li>
              ))}
            </ul>
            <p>Total Coins: {totalCoins}</p>
            <Button onClick={() => setCurrentLocation('mine')}>Exit Cave</Button>
          </CardContent>
        </Card>
      </div>
    );
  };

  return (
    <div className="relative w-full h-full">
      {gameState === 'instructions' && renderInstructions()}
      {gameState === 'results' && renderResults()}

      <div
        ref={miningAreaRef}
        className="absolute top-[22%] left-[27%] w-[46%] h-[46%] hover:cursor-pickaxe"
        onClick={handleMineClick}
      >
        {holes.map((hole, i) => (
          <img
            key={i}
            src="/assets/interactive/games/mine-wall-hole.png"
            className="absolute"
            style={{ left: hole.x - 15, top: hole.y - 15, width: 40, height: 40 }}
          />
        ))}
        {minedItems.map(item => (
          <img
            key={item.id}
            src={`/assets/interactive/games/${item.type}`}
            className="absolute"
            style={{ left: item.position.x - 5, top: item.position.y - 5, width: 20, height: 20 }}
          />
        ))}
      </div>

      <div className="absolute top-4 right-4 w-32 space-y-2 text-white">
        <p>Energy</p>
        <Progress value={energy} />
        <Button onClick={finishMining}>Finish Mining</Button>
      </div>
    </div>
  );
}
