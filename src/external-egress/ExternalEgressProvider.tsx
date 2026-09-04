/**
 * The provider that owns the decision, the confirmation and the browser call.
 *
 * Mounted once, near the top of `App.tsx`. It is the seam that lets a feature
 * say *share with Telegram* and await an answer without knowing that a policy
 * was consulted, a URL was parsed, a dialog was shown, or a window was opened.
 *
 * ## Why the dialog lives here rather than in each feature
 *
 * Six components used to open windows; putting a confirmation in each would have
 * meant six dialogs to keep consistent and six chances to skip one. One dialog,
 * mounted once, cannot be skipped, the only path to `performEgress` runs
 * through it.
 *
 * ## The pending promise
 *
 * A confirmation makes egress asynchronous, so the request's resolver is held
 * until the player answers. Cancel resolves `false`; so does unmounting, so a
 * caller awaiting the answer is never left hanging.
 */

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';

import { BlobbiModal } from '@/components/ui/blobbi-modal';
import { Button } from '@/components/ui/button';
import { useIslandSafetyPolicy } from '@/safety';

import { ExternalEgressContext, type ExternalEgressApi } from './external-egress-context';
import { decideEgress, performEgress, type EgressDestination, type EgressRequest } from './egress';

interface Pending {
  readonly request: EgressRequest;
  readonly destination: EgressDestination;
  readonly resolve: (went: boolean) => void;
}

export function ExternalEgressProvider({ children }: { children: ReactNode }) {
  const policy = useIslandSafetyPolicy();
  const [pending, setPending] = useState<Pending | null>(null);
  // Read at call time so a request decided while the policy is changing uses the
  // value in force at the moment the player acted.
  const policyRef = useRef(policy);
  policyRef.current = policy;

  const requestEgress = useCallback<ExternalEgressApi['requestEgress']>(async (request) => {
    const decision = decideEgress(policyRef.current, request);

    if (decision.outcome === 'denied') return false;

    if (decision.outcome === 'allowed') {
      return performEgress(request, decision.destination?.url);
    }

    return new Promise<boolean>((resolve) => {
      setPending({ request, destination: decision.destination, resolve });
    });
  }, []);

  const settle = useCallback((went: boolean) => {
    setPending((current) => {
      current?.resolve(went);
      return null;
    });
  }, []);

  const confirm = useCallback(async () => {
    // Capture before clearing: `settle` drops the pending record.
    const current = pending;
    if (!current) return;
    const went = await performEgress(current.request, current.destination.url);
    settle(went);
  }, [pending, settle]);

  const api = useMemo<ExternalEgressApi>(() => ({ requestEgress }), [requestEgress]);

  return (
    <ExternalEgressContext.Provider value={api}>
      {children}
      {pending ? (
        <BlobbiModal
          open
          onOpenChange={(next) => !next && settle(false)}
          title={
            pending.destination.egressClass === 'social-share'
              ? `Share with ${pending.destination.label ?? pending.destination.host}?`
              : 'Leaving Blobbi Island'
          }
          icon={<ExternalLink />}
          size="sm"
          footer={
            <>
              <Button variant="soft" onClick={() => settle(false)}>
                Cancel
              </Button>
              {/* Named, not merely coloured: "Continue" next to "Cancel" is the
                  distinction, so the choice survives a monochrome display. */}
              <Button variant="playful" onClick={confirm}>
                Continue
              </Button>
            </>
          }
        >
          <p className="text-sm text-island-ink">
            This will open{' '}
            {/* The HOST, parsed from the URL that is about to be opened; never a
                label a caller passed in. A wrong label can mislabel a button; it
                must never be able to mis-state where the player is going. */}
            <span className="font-semibold" data-testid="egress-destination">
              {pending.destination.host}
            </span>{' '}
            outside Blobbi Island.
          </p>
        </BlobbiModal>
      ) : null}
    </ExternalEgressContext.Provider>
  );
}
