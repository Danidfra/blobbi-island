/**
 * The curated composer, and the ceremony branch that chooses it.
 *
 * Phase F.1 changed one naming capability (`strangerAuthoredNames`) and left
 * the other alone. That is easy to say and worth proving: the composer is the
 * only naming surface a curated experience offers, and its output is the only
 * thing the writer will accept.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

import { FAMILY_POLICY, STANDARD_POLICY } from '@/safety';
import {
  CURATED_ADJECTIVES,
  CURATED_NOUNS,
  admitOwnBlobbiName,
  composeCuratedName,
  isCuratedBlobbiName,
} from '@/blobbi-names';

import { CuratedNameComposer } from './CuratedNameComposer';

/** The ceremony's own wiring: two pieces of state and the composed name. */
function Harness({ onSubmit }: { onSubmit: (name: string) => void }) {
  const [adjective, setAdjective] = useState(CURATED_ADJECTIVES[0]);
  const [noun, setNoun] = useState(CURATED_NOUNS[0]);
  return (
    <CuratedNameComposer
      adjective={adjective}
      noun={noun}
      onAdjectiveChange={setAdjective}
      onNounChange={setNoun}
      onSubmit={() => onSubmit(composeCuratedName(adjective, noun) ?? '')}
      submitLabel="Name my Blobbi"
    />
  );
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: /name my blobbi/i }));

describe('the composer offers only approved names', () => {
  it('submits a name the writer accepts', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    submit();

    const name = onSubmit.mock.calls[0][0] as string;
    expect(isCuratedBlobbiName(name)).toBe(true);
    expect(admitOwnBlobbiName(FAMILY_POLICY, name)).toEqual({ ok: true, name });
  });

  it('accepts every combination the two choosers can reach', () => {
    // The composer's whole promise: there is no selection that produces
    // something the writer will refuse.
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    const [adjectives, nouns] = screen.getAllByRole('combobox');

    for (const a of [1, 7, 15]) {
      for (const n of [0, 9, 15]) {
        fireEvent.change(adjectives, { target: { value: CURATED_ADJECTIVES[a] } });
        fireEvent.change(nouns, { target: { value: CURATED_NOUNS[n] } });
        submit();
        const name = onSubmit.mock.calls.at(-1)?.[0] as string;
        expect(name, name).toBe(`${CURATED_ADJECTIVES[a]} ${CURATED_NOUNS[n]}`);
        expect(admitOwnBlobbiName(FAMILY_POLICY, name).ok, name).toBe(true);
      }
    }
  });

  it('shows the assembled name as it changes', () => {
    render(<Harness onSubmit={vi.fn()} />);
    const [adjectives] = screen.getAllByRole('combobox');
    fireEvent.change(adjectives, { target: { value: CURATED_ADJECTIVES[4] } });

    expect(screen.getByTestId('curated-name-preview')).toHaveTextContent(
      `${CURATED_ADJECTIVES[4]} ${CURATED_NOUNS[0]}`,
    );
  });

  it('has no free-text field to type into', () => {
    render(<Harness onSubmit={vi.fn()} />);
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('the ceremony picks its naming surface by capability', () => {
  /*
    Asserted against the source rather than by mounting the ceremony: it is a
    long animated sequence with its own timers and typewriter, and what needs
    proving is one branch, not the sequence. Mounting it would test the
    animation and only incidentally the rule.
  */
  const ceremony = readFileSync(
    join(process.cwd(), 'src/components/blobbi/BlobbiHatchingCeremony.tsx'),
    'utf8',
  );

  it('reads the capability, never a profile name', () => {
    expect(ceremony).toContain('useIslandSafetyPolicy().ownFreeTextNaming');
    expect(ceremony).not.toMatch(/profile\s*===/);
  });

  it('shows the composer exactly where free-text naming is not permitted', () => {
    expect(ceremony).toContain('!allowsFreeTextNaming && (');
    expect(ceremony).toContain('<CuratedNameComposer');
    // ...and the text field only where it is.
    expect(ceremony).toContain('allowsFreeTextNaming && (');
  });

  it('is unaffected by the stranger-name decision', () => {
    // The capability that changed in this pass must not appear here at all:
    // whose words reach YOUR screen and what YOU may type are separate rules.
    expect(ceremony).not.toContain('strangerAuthoredNames');
    expect(FAMILY_POLICY.ownFreeTextNaming).toBe(false);
    expect(STANDARD_POLICY.ownFreeTextNaming).toBe(true);
  });
});
