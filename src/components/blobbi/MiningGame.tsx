import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useLocation } from '@/hooks/useLocation';
import { useOptimizedStatus } from '@/hooks/useOptimizedStatus';
import { useUpdatePetState, useUpdateOwnerProfile } from '@/hooks/useBlobbiEvents';

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
  const { status, updatePetStats, updateOwnerCoins } = useOptimizedStatus();
  const { mutate: updatePetState } = useUpdatePetState();
  const { mutate: updateOwnerProfile } = useUpdateOwnerProfile();
  const currentPet = status.currentPet;
  const owner = status.owner;

  const [gameState, setGameState] = useState<'instructions' | 'playing' | 'results' | 'low-energy'>('instructions');
  const [clicks, setClicks] = useState(0);
  const [minedItems, setMinedItems] = useState<MinedItem[]>([]);
  const [holes, setHoles] = useState<{ x: number; y: number }[]>([]);
  const [currentEnergy, setCurrentEnergy] = useState(currentPet?.energy || 100);
  const miningAreaRef = useRef<HTMLDivElement>(null);

  // Update local energy state when currentPet changes
  useEffect(() => {
    if (currentPet) {
      setCurrentEnergy(currentPet.energy);
    }
  }, [currentPet?.energy]);



  const startGame = () => {
    setGameState('playing');
  };

  const finishMining = () => {
    // Calculate total coins earned
    const totalCoins = minedItems.reduce((acc, item) => {
      return acc + GEM_VALUES[item.type];
    }, 0);

    // Add coins to user's balance
    if (totalCoins > 0 && owner) {
      const newCoins = (owner.coins || 0) + totalCoins;
      updateOwnerCoins(newCoins);
      updateOwnerProfile({
        coins: newCoins
      });
    }

    setGameState('results');
  };

  const handleMineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!currentPet) {
      return;
    }

    // Check if user has enough energy to start/continue the game
    if (currentEnergy <= 20) {
      setGameState('low-energy');
      return;
    }

    if (gameState !== 'playing') {
      return;
    }

    const rect = miningAreaRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setHoles(prev => [...prev, { x, y }]);
    setClicks(prev => prev + 1);

    // Update the pet's energy by consuming 10 energy
    const newEnergy = Math.max(0, currentEnergy - 10);
    setCurrentEnergy(newEnergy);

    // Apply optimistic update immediately for UI responsiveness
    updatePetStats(currentPet.id, { energy: newEnergy });

    // Publish to Nostr (kind 31124)
    updatePetState({
      petId: currentPet.id,
      updates: { energy: newEnergy }
    });

    // End game if energy is too low after this click
    if (newEnergy <= 20) {
      finishMining();
      return;
    }

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

    const finalEnergyStatus = currentEnergy <= 20 ? 'Your Blobbi is exhausted!' : 'Mining session complete!';

    return (
      <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Mining Results</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{finalEnergyStatus}</p>
            <p>Total Clicks: {clicks}</p>
            <div className="space-y-1">
              <p className="font-semibold">Items Found:</p>
              <ul className="text-sm space-y-1">
                {Object.entries(results).map(([gem, count]) => (
                  <li key={gem} className="flex justify-between">
                    <span>{gem.replace('.png', '').replace('-', ' ')}: {count}</span>
                    <span>{GEM_VALUES[gem as Gem] * count} coins</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="border-t pt-2">
              <p className="font-bold">Total Coins Earned: {totalCoins}</p>
              {totalCoins > 0 && (
                <p className="text-sm text-green-600">Coins added to your balance!</p>
              )}
            </div>
            <Button onClick={() => setCurrentLocation('mine')} className="w-full">Exit Cave</Button>
          </CardContent>
        </Card>
      </div>
    );
  };

  const renderLowEnergy = () => (
    <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Not Enough Energy!</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p>Your Blobbi doesn't have enough energy to mine!</p>
          <p className="text-sm text-muted-foreground">
            Current Energy: {currentEnergy}/100
          </p>
          <p className="text-sm text-muted-foreground">
            You need more than 20 energy to start mining.
          </p>
          <Button onClick={() => setCurrentLocation('mine')} className="w-full">
            Exit Cave
          </Button>
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div className="relative w-full h-full">
      {gameState === 'instructions' && renderInstructions()}
      {gameState === 'results' && renderResults()}
      {gameState === 'low-energy' && renderLowEnergy()}

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

      <div className="absolute top-4 left-4 w-32 space-y-2 text-white">
        <p>Energy: {currentEnergy}/100</p>
        <Progress value={currentEnergy} />
        <Button onClick={finishMining}>Finish Mining</Button>
      </div>
    </div>
  );
}
