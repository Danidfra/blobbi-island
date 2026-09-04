/**
 * Where a native arcade game is actually rendered, and the only place the
 * room reaches for the Token turnstile.
 *
 * The turnstile reads the player's inventory, so acquiring it needs the
 * relay/query context. Doing that at the top of `ArcadeRoom` would make the
 * whole room: walking around, opening a cabinet, reading a catalogue,
 * depend on being inside those providers, for a capability only a running
 * game uses. This component keeps that dependency where the cost is paid.
 */

import { useArcadeGameEntry } from '@/hooks/useArcadeGameEntry';

import type { NativeArcadeGameProps, NativeArcadeGameRenderer } from './native-games';

interface NativeGameHostProps {
  readonly render: NativeArcadeGameRenderer;
  /** Everything the game needs except the turnstile, which is acquired here. */
  readonly props: Omit<NativeArcadeGameProps, 'gameEntry'>;
}

export function NativeGameHost({ render, props }: NativeGameHostProps) {
  const gameEntry = useArcadeGameEntry();
  return <>{render({ ...props, gameEntry })}</>;
}
