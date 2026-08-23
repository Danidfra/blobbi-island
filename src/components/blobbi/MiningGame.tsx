import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { BlobbiModal } from '@/components/ui/blobbi-modal';
import { PriceTag } from '@/components/ui/item-tile';
import { Progress } from '@/components/ui/progress';
import { useLocation } from '@/hooks/useLocation';
import { useOptimizedStatus } from '@/hooks/useOptimizedStatus';
import { useMineSettlement } from '@/hooks/useMineSettlement';
import { miningItemPath } from '@/lib/asset-paths';

/**
 * Settlement boundary.
 *
 * A mining run is now entirely LOCAL while it is played: energy comes down in
 * component state and NOTHING is published per click. Both value-bearing
 * writes happen once, at the end, through a durable session:
 *
 * ```
 *   Start   → mint a durable session (no publish)
 *   Play    → local energy + local loot, ZERO kind:31124 writes
 *   Finish  → freeze {energyDelta, coinReward} → settle Coins → settle energy
 * ```
 *
 * The previous shape published energy on every click, so an interruption left
 * the cost paid and the reward unearned. Now an interrupted run costs nothing:
 * the session is abandoned on recovery. Gameplay, the drop table and the
 * energy cost per click are unchanged.
 *
 * See `docs/mine-session-settlement.md`.
 */
type MineRewardState =
  | { phase: 'idle' }
  | { phase: 'settling'; amount: number }
  | { phase: 'settled'; amount: number }
  | { phase: 'coin-pending'; amount: number }
  | { phase: 'energy-pending'; amount: number }
  | { phase: 'unresolved'; amount: number };

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
  const { status, refreshFromRelay } = useOptimizedStatus();
  const { settlement, settle } = useMineSettlement();
  const currentPet = status.currentPet;

  const [gameState, setGameState] = useState<'instructions' | 'playing' | 'results' | 'low-energy'>('instructions');
  const [clicks, setClicks] = useState(0);
  const [minedItems, setMinedItems] = useState<MinedItem[]>([]);
  const [holes, setHoles] = useState<{ x: number; y: number }[]>([]);
  // LOCAL session energy. Deliberately not pushed into global pet state: the
  // rest of the app must not show a reduced energy until settlement lands.
  const [currentEnergy, setCurrentEnergy] = useState(currentPet?.energy || 100);
  const [reward, setReward] = useState<MineRewardState>({ phase: 'idle' });
  const miningAreaRef = useRef<HTMLDivElement>(null);
  // The durable session identity, minted at Start. Both settlement operation
  // ids derive from it deterministically, so a retry never mints a new one.
  const sessionIdRef = useRef<string | null>(null);
  // Energy the run began from, for the local delta. Never a write base.
  const startEnergyRef = useRef<number>(0);
  const finishedRef = useRef(false);

  // Track the Blobbi's energy for the pre-run display. Once a run is under way
  // the local value is authoritative for gameplay — a background refetch must
  // not rewind the player's progress mid-session.
  useEffect(() => {
    if (currentPet && gameState === 'instructions') {
      setCurrentEnergy(currentPet.energy);
    }
  }, [currentPet?.energy, gameState]);

  // A stale cached energy value is free mining; re-read the authoritative
  // state when the cave opens. (Client-trusted like everything here, but the
  // honest client no longer mines against a 30-second-old snapshot.)
  useEffect(() => {
    refreshFromRelay();
    // `refreshFromRelay` is genuinely stable now — it depends on React Query's
    // referentially-stable `refetch` functions rather than on the whole query
    // result objects, so this runs ONCE per mount. It previously re-fired on
    // every render (measured: 11 calls / 22 relay reads in one session).
  }, [refreshFromRelay]);

  const [startError, setStartError] = useState<string | null>(null);

  const startGame = () => {
    if (!currentPet) return;
    // A durable session id BEFORE any gameplay: no durable operation identity,
    // no value-bearing run. This is the same rule the Coin wallet applies
    // before it publishes.
    const started = settlement?.startSession({
      petId: currentPet.id,
      startEnergy: currentEnergy,
    });
    if (settlement && (!started || !started.ok)) {
      setStartError(
        "We couldn't set up this mining trip. Please check your browser storage settings and try again.",
      );
      return;
    }
    sessionIdRef.current = started?.ok ? started.sessionId : null;
    startEnergyRef.current = currentEnergy;
    finishedRef.current = false;
    setStartError(null);
    setReward({ phase: 'idle' });
    setGameState('playing');
  };

  /**
   * Freeze the run's numbers, then settle: Coins first, energy second. Both
   * live in the durable session, so an unmount here does not lose them — the
   * next visit resumes under the same operation ids.
   */
  const settleRun = async (totalCoins: number, energyDelta: number) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId || !settlement) return; // practice run (logged out)
    if (!settlement.finalizeSession(sessionId, { energyDelta, coinReward: totalCoins })) {
      setReward({ phase: 'unresolved', amount: totalCoins });
      return;
    }
    setReward({ phase: 'settling', amount: totalCoins });
    const outcome = await settle(sessionId);
    setReward({ phase: outcome.phase, amount: totalCoins });
  };

  /**
   * `finalEnergy` is passed explicitly by the auto-finish path, because that
   * runs inside the same click handler that just lowered the energy — the
   * `currentEnergy` in this closure is still the PRE-click value, and reading
   * it would silently drop the last click from the delta.
   */
  const finishMining = (finalEnergy: number = currentEnergy) => {
    if (finishedRef.current) return;
    finishedRef.current = true;

    const totalCoins = minedItems.reduce((acc, item) => {
      return acc + GEM_VALUES[item.type];
    }, 0);
    // The whole run's energy cost, as one delta. Settlement subtracts it from
    // the FRESH authoritative energy, never from `startEnergyRef`.
    const energyDelta = Math.max(0, startEnergyRef.current - finalEnergy);

    setGameState('results');
    void settleRun(totalCoins, energyDelta);
  };

  // An unmount before the run finished owes nothing: no reward was frozen and
  // no energy was ever published. Mark it abandoned so recovery stays quiet.
  //
  // Deliberately depends on NOTHING: this must fire on real unmount only. A
  // dependency on `settlement` would abandon the live session every time that
  // identity changed, which is exactly the kind of accidental teardown this
  // whole phase exists to remove.
  const settlementRef = useRef(settlement);
  settlementRef.current = settlement;
  useEffect(() => {
    return () => {
      const sessionId = sessionIdRef.current;
      if (sessionId && !finishedRef.current) {
        settlementRef.current?.abandonSession(sessionId);
      }
    };
  }, []);

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

    // Energy is spent LOCALLY. No kind:31124 publish, no pet-query
    // invalidation, no optimistic global pet update — the whole run's cost is
    // settled once at the end as a single delta. Cost per click is unchanged.
    const newEnergy = Math.max(0, currentEnergy - 10);
    setCurrentEnergy(newEnergy);

    // End game if energy is too low after this click
    if (newEnergy <= 20) {
      finishMining(newEnergy);
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
    <BlobbiModal
      open
      onOpenChange={() => {}}
      presentation="in-frame"
      size="sm"
      title="The Mine"
      description="Swing at the wall, find gems, earn coins."
      icon="⛏️"
      hideClose
      footer={
        <Button variant="accent" onClick={startGame} disabled={!currentPet} className="min-h-[44px]">
          Start
        </Button>
      }
    >
      <dl className="space-y-2 text-sm">
        <div className="flex gap-2 rounded-xl border border-island-wood/20 bg-island-cream-2/60 p-3">
          <dt aria-hidden className="text-lg leading-none">⛏️</dt>
          <dd className="text-island-ink">
            Objective: Click the wall to find gems and earn coins.
          </dd>
        </div>
        <div className="flex gap-2 rounded-xl border border-island-wood/20 bg-island-cream-2/60 p-3">
          <dt aria-hidden className="text-lg leading-none">⚡</dt>
          <dd className="text-island-ink">
            Energy: Each click consumes 10 energy. The game ends if energy is 20 or less.
          </dd>
        </div>
      </dl>
      {startError && (
        <p className="mt-3 text-sm text-island-danger" role="alert">
          {startError}
        </p>
      )}
    </BlobbiModal>
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
      <BlobbiModal
        open
        onOpenChange={() => {}}
        presentation="in-frame"
        size="sm"
        title="Mining results"
        description={finalEnergyStatus}
        icon="💎"
        hideClose
        footer={
          <Button
            variant="accent"
            onClick={() => setCurrentLocation('mine')}
            className="min-h-[44px]"
          >
            Exit cave
          </Button>
        }
      >
        <div className="space-y-3">
          <div className="rounded-panel border border-island-wood/20 bg-island-cream-2/60 p-3">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-island-ink-soft">Swings</span>
              <span className="font-bold tabular-nums text-island-ink">{clicks}</span>
            </div>
          </div>

          <div className="rounded-panel border border-island-wood/20 bg-island-cream-2/60 p-3">
            <h4 className="mb-1.5 text-[0.6875rem] font-bold uppercase tracking-wider text-island-ink-soft">
              Items found
            </h4>
            <ul className="space-y-1 text-sm">
              {Object.entries(results).map(([gem, count]) => (
                <li key={gem} className="flex items-baseline justify-between gap-2">
                  <span className="capitalize text-island-ink">
                    {gem.replace('.png', '').replace('-', ' ')} × {count}
                  </span>
                  <PriceTag amount={GEM_VALUES[gem as Gem] * count} />
                </li>
              ))}
            </ul>
          </div>

          {/*
            `data-mine-reward-status` is the settlement state, read by
            MiningGame.session.test.tsx. The phase values and every line of
            copy below are unchanged — this pass restyles the panel and does
            not touch what settlement says or when.
          */}
          <div
            className="rounded-panel border border-island-wood/25 bg-island-cream p-3"
            data-mine-reward-status={reward.phase}
          >
            <div className="flex items-baseline justify-between gap-2 border-b border-island-wood/20 pb-2">
              <span className="text-sm font-bold text-island-ink">Total earned</span>
              <PriceTag amount={totalCoins} className="text-base" />
            </div>
            <div className="pt-2">
              {reward.phase === 'settling' && (
                <p className="text-sm text-island-ink-soft">Saving your mining trip…</p>
              )}
              {reward.phase === 'settled' && (
                <p className="text-sm font-semibold text-island-grass-dark">
                  {reward.amount} Blobbi Coins added to your balance!
                </p>
              )}
              {reward.phase === 'energy-pending' && (
                <p className="text-sm text-island-ink-soft">
                  Reward saved — we're still finishing your Blobbi's energy
                  update. It's safe to leave.
                </p>
              )}
              {reward.phase === 'coin-pending' && (
                <p className="text-sm text-island-ink-soft">
                  We're still confirming your mining trip. It's safe to leave —
                  nothing will be lost or counted twice.
                </p>
              )}
              {reward.phase === 'unresolved' && (
                <p className="text-sm text-island-ink-soft">
                  We couldn't finish saving your mining trip just yet. It's safe
                  to leave — we'll pick it up next time.
                </p>
              )}
            </div>
          </div>
        </div>
      </BlobbiModal>
    );
  };

  const renderLowEnergy = () => (
    <BlobbiModal
      open
      onOpenChange={() => {}}
      presentation="in-frame"
      size="sm"
      title="Not enough energy"
      description="Your Blobbi is too tired to swing a pickaxe."
      icon="😴"
      hideClose
      footer={
        <Button
          variant="accent"
          onClick={() => setCurrentLocation('mine')}
          className="min-h-[44px]"
        >
          Exit cave
        </Button>
      }
    >
      <div className="space-y-2 rounded-panel border border-island-wood/20 bg-island-cream-2/60 p-3">
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-island-ink-soft">Current energy</span>
          <span className="font-bold tabular-nums text-island-ink">{currentEnergy}/100</span>
        </div>
        <Progress value={currentEnergy} />
        <p className="text-xs text-island-ink-soft">Mining needs more than 20 energy.</p>
      </div>
    </BlobbiModal>
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

      {/*
        The in-cave status panel. It used to be bare `text-white` directly over
        the cave artwork, which is unreadable against a lit gem and follows no
        theme; it is now a HUD card on the panel surface.
      */}
      <div className="absolute left-3 top-3 w-40 space-y-2 rounded-panel border border-island-wood/25 bg-island-cream/90 p-2.5 shadow-cozy-raised backdrop-blur-sm">
        <div className="flex items-baseline justify-between text-xs">
          <span className="font-semibold text-island-ink-soft">Energy</span>
          <span className="font-bold tabular-nums text-island-ink">{currentEnergy}/100</span>
        </div>
        <Progress value={currentEnergy} />
        <Button variant="soft" size="sm" onClick={() => finishMining()} className="w-full">
          Finish mining
        </Button>
      </div>
    </div>
  );
}
