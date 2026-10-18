import { useExternalEgress } from '@/external-egress';
import { SOURCE_CODE_LABEL, SOURCE_CODE_URL } from '@/lib/source-code';
import { useIslandSafetyPolicy } from '@/safety';
import { cn } from '@/lib/utils';

/**
 * "Free software · Source code": the offer of the source the AGPL asks for.
 *
 * Leaving the island goes through the egress boundary like every other link
 * (capability check, confirmation, opener isolation). Where this experience
 * does not allow external links, the address is shown as plain text instead, so
 * the offer is still there to read.
 */
export function SourceCodeLink({ className }: { className?: string }) {
  const { requestEgress } = useExternalEgress();
  const policy = useIslandSafetyPolicy();

  return (
    <p className={cn('text-xs', className)} data-testid="source-code">
      Free software (AGPL).{' '}
      {policy.externalLinks ? (
        <button
          type="button"
          onClick={() => void requestEgress({ class: 'external-link', url: SOURCE_CODE_URL, label: 'Source code' })}
          className="underline underline-offset-2"
          data-testid="source-code-link"
        >
          Source code
        </button>
      ) : (
        <span>Source code: {SOURCE_CODE_LABEL}</span>
      )}
    </p>
  );
}
