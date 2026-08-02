import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useLocation } from '@/hooks/useLocation';
import { useOptimizedStatus } from '@/hooks/useOptimizedStatus';
import { useUpdatePetState } from '@/hooks/useBlobbiEvents';
import { useCoinWallet } from '@/inventory/useCoinWallet';
import { mintCoinOpId, CoinWalletError } from '@/inventory/coin-wallet';
import { miningItemPath } from '@/lib/asset-paths';

/**
 * Reward boundary (Coin cutover): the payout is a canonical Coin wallet
 * grant — one durable operation per mining session, minted at Start. The old
 * path (an absolute `coins` republish of kind:11125 from the React cache,
 * fire-and-forget) is gone; the wallet gives the session fresh reads, strict
 * publish, exactly-once application and honest ambiguous states. The game
 * design and the drop table are unchanged.
 */
type MineRewardState =
  | { phase: 'idle' }
  | { phase: 'granting'; amount: number }
  | { phase: 'applied'; amount: number }
  | { phase: 'ambiguous'; amount: number }
  | { phase: 'failed'; amount: number; message: string };

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
  const { status, updatePetStats, refreshFromRelay } = useOptimizedStatus();
  const { mutate: updatePetState } = useUpdatePetState();
  const { grantCoins } = useCoinWallet();
  const currentPet = status.currentPet;

  const [gameState, setGameState] = useState<'instructions' | 'playing' | 'results' | 'low-energy'>('instructions');
  const [clicks, setClicks] = useState(0);
  const [minedItems, setMinedItems] = useState<MinedItem[]>([]);
  const [holes, setHoles] = useState<{ x: number; y: number }[]>([]);
  const [currentEnergy, setCurrentEnergy] = useState(currentPet?.energy || 100);
  const [reward, setReward] = useState<MineRewardState>({ phase: 'idle' });
  const miningAreaRef = useRef<HTMLDivElement>(null);
  // One reward operation per session, minted at Start; the wallet ledger
  // makes it exactly-once even across the two finish paths (auto + button).
  const rewardOpIdRef = useRef<string | null>(null);
  const finishedRef = useRef(false);

  // Update local energy state when currentPet changes
  useEffect(() => {
    if (currentPet) {
      setCurrentEnergy(currentPet.energy);
    }
  }, [currentPet?.energy]);

  // A stale cached energy value is free mining; re-read the authoritative
  // state when the cave opens. (Client-trusted like everything here, but the
  // honest client no longer mines against a 30-second-old snapshot.)
  useEffect(() => {
    refreshFromRelay();
    // eslint intentionally satisfied: refreshFromRelay is stable per hook.
  }, [refreshFromRelay]);

  const startGame = () => {
    rewardOpIdRef.current = mintCoinOpId('mine-reward');
    finishedRef.current = false;
    setReward({ phase: 'idle' });
    setGameState('playing');
  };

  const grantReward = async (totalCoins: number) => {
    const opId = rewardOpIdRef.current;
    if (!opId || totalCoins <= 0) return;
    setReward({ phase: 'granting', amount: totalCoins });
    try {
      const outcome = await grantCoins({ opId, amount: totalCoins, label: 'mine-reward' });
      if (outcome.status === 'applied' || outcome.status === 'already-applied') {
        setReward({ phase: 'applied', amount: totalCoins });
      } else {
        // ambiguous / blocked: the grant MAY have landed. Recorded durably;
        // reconciliation happens on the next wallet touch — never a blind
        // second grant.
        setReward({ phase: 'ambiguous', amount: totalCoins });
      }
    } catch (error) {
      const message =
        error instanceof CoinWalletError ? error.reason : 'the reward could not be published';
      setReward({ phase: 'failed', amount: totalCoins, message });
    }
  };

  const finishMining = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;

    const totalCoins = minedItems.reduce((acc, item) => {
      return acc + GEM_VALUES[item.type];
    }, 0);

    setGameState('results');
    void grantReward(totalCoins);
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
            <div className="border-t pt-2 space-y-1" data-mine-reward-status={reward.phase}>
              <p className="font-bold">Total Coins Earned: {totalCoins}</p>
              {reward.phase === 'granting' && (
                <p className="text-sm text-muted-foreground">Adding your Coins…</p>
              )}
              {reward.phase === 'applied' && (
                <p className="text-sm text-green-600">
                  {reward.amount} Blobbi Coins added to your balance!
                </p>
              )}
              {reward.phase === 'ambiguous' && (
                <p className="text-sm text-amber-600">
                  Your reward is being confirmed — it will appear in your balance
                  once we can verify it. It will not be lost or doubled.
                </p>
              )}
              {reward.phase === 'failed' && (
                <div className="space-y-1">
                  <p className="text-sm text-red-600">
                    The reward could not be sent ({reward.message}). Nothing was
                    published.
                  </p>
                  <Button size="sm" variant="outline" onClick={() => void grantReward(reward.amount)}>
                    Try again
                  </Button>
                </div>
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
            src={miningItemPath('mine-wall-hole.png')}
            className="absolute"
            style={{ left: hole.x - 15, top: hole.y - 15, width: 40, height: 40 }}
          />
        ))}
        {minedItems.map(item => (
          <img
            key={item.id}
            src={miningItemPath(item.type)}
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
