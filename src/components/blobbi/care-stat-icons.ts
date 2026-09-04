import { Droplets, Heart, Sparkles, Zap, type LucideIcon } from 'lucide-react';

import type { CareStats } from '@/inventory';

/**
 * One icon per care stat, shared by every surface that names a stat change:
 * the consume dialog's effect readout and the in-world reaction after a
 * successful feed. One table, so the two can never disagree.
 */
export const CARE_STAT_ICONS: Readonly<Record<keyof CareStats, LucideIcon>> = {
  hunger: Heart,
  energy: Zap,
  hygiene: Droplets,
  happiness: Sparkles,
  health: Heart,
};
