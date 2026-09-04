/**
 * A route that only exists when the experience permits it.
 *
 * ## Why the guard is on the route and not on the menu entry
 *
 * The authoring tools are unlinked from the game's navigation, which is
 * discoverability rather than a boundary, anyone can type the path. Removing a
 * menu item leaves the route mounted and one URL away; guarding the route means
 * the surface is not reachable at all, however it is addressed.
 *
 * ## What a denied route shows
 *
 * A short, neutral sentence and a way back. Deliberately NOT:
 *
 *  - an explanation involving the player's age. A profile is an experience
 *    configuration, not an age assertion (`docs/family-safety-policy.md` §1), and
 *    saying otherwise would both be wrong and make the restriction feel like a
 *    judgement about the person;
 *  - a stack trace, a capability name, a policy dump, or anything else that
 *    tells a curious visitor what to go looking for. A denied view is not a
 *    debugging surface.
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { StateCard } from '@/components/ui/state-card';
import { useIslandSafetyPolicy } from '@/safety';

import { isEgressAllowed, type EgressClass } from './classes';

interface EgressRouteGuardProps {
  /** Which capability decides whether this route exists. */
  egressClass: EgressClass;
  /** What the player is told, in plain words. */
  message: string;
  children: ReactNode;
}

export function EgressRouteGuard({ egressClass, message, children }: EgressRouteGuardProps) {
  const policy = useIslandSafetyPolicy();

  if (isEgressAllowed(policy, egressClass)) return <>{children}</>;

  return (
    <div className="flex min-h-screen items-center justify-center bg-island-page p-6">
      <div className="w-full max-w-sm space-y-4">
        <StateCard kind="empty" title="Not available" message={message} />
        <p className="text-center text-sm">
          <Link to="/" className="underline">
            Back to Blobbi Island
          </Link>
        </p>
      </div>
    </div>
  );
}
