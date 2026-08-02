/**
 * Treasure Hunt — the PRODUCTION modal: binds the real reward service to the
 * view layer. Everything else lives in `TreasureHuntModalView.tsx`, which
 * deliberately imports no wallet/ledger/relay code (the dev harness and the
 * tests inject a mock service there instead).
 */

import { useTreasureHuntRewards } from '@/hooks/useTreasureHuntRewards';
import { TreasureHuntModalView } from './TreasureHuntModalView';
import type { TreasureHuntDevOptions } from './TreasureHuntModalView';

export {
  TreasureHuntModalView,
  type TreasureHuntDevOptions,
  type TreasureHuntRewardView,
} from './TreasureHuntModalView';

interface TreasureHuntModalProps {
  open: boolean;
  onClose: () => void;
  /** See the view module: LOCAL-ONLY actor suppression, never presence. */
  onActorSuppressionChange?: (suppressed: boolean) => void;
  dev?: TreasureHuntDevOptions;
}

export function TreasureHuntModal(props: TreasureHuntModalProps) {
  const rewards = useTreasureHuntRewards();
  return <TreasureHuntModalView {...props} rewards={rewards} />;
}
