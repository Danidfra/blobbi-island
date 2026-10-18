import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { ExternalEgressContext } from '@/external-egress';
import { FAMILY_POLICY, IslandSafetyPolicyContext, STANDARD_POLICY, type IslandSafetyPolicy } from '@/safety';
import { SOURCE_CODE_URL } from '@/lib/source-code';
import { SourceCodeLink } from './SourceCodeLink';

function renderLink(policy: IslandSafetyPolicy) {
  const requestEgress = vi.fn(async () => true);
  render(
    <IslandSafetyPolicyContext.Provider value={policy}>
      <ExternalEgressContext.Provider value={{ requestEgress }}>
        <SourceCodeLink />
      </ExternalEgressContext.Provider>
    </IslandSafetyPolicyContext.Provider>,
  );
  return requestEgress;
}

describe('SourceCodeLink', () => {
  it('leaves through the egress boundary to the public repository', () => {
    expect(STANDARD_POLICY.externalLinks).toBe(true);
    const requestEgress = renderLink(STANDARD_POLICY);
    fireEvent.click(screen.getByRole('button', { name: 'Source code' }));
    expect(requestEgress).toHaveBeenCalledWith({ class: 'external-link', url: SOURCE_CODE_URL, label: 'Source code' });
  });

  it('shows the address as text where external links are not allowed', () => {
    expect(FAMILY_POLICY.externalLinks).toBe(false);
    const requestEgress = renderLink(FAMILY_POLICY);
    expect(screen.queryByRole('button', { name: 'Source code' })).toBeNull();
    expect(screen.getByTestId('source-code')).toHaveTextContent('github.com/Danidfra/blobbi-island');
    expect(requestEgress).not.toHaveBeenCalled();
  });
});
