import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { SettingsRow, SettingsSection } from '@/components/ui/settings-row';
import { Switch } from '@/components/ui/switch';

/**
 * The row's contract, asserted as semantics rather than as classes.
 *
 * The one that matters most is the last: a row whose trailing slot holds a
 * control must NOT itself be a button. Getting that wrong nests an interactive
 * element inside another, which makes the toggle unreachable by keyboard in
 * some readers and gives the row two conflicting hit targets.
 */

describe('SettingsRow', () => {
  it('is a button when it has a handler', () => {
    const onClick = vi.fn();
    render(<SettingsRow label="Theme" onClick={onClick} />);

    fireEvent.click(screen.getByRole('button', { name: /Theme/ }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('is a link when it has an href', () => {
    render(<SettingsRow label="Docs" href="/docs" />);
    expect(screen.getByRole('link', { name: /Docs/ })).toHaveAttribute('href', '/docs');
  });

  it('is not interactive without a handler', () => {
    // The identity row in the account menu: a row that displays, not acts.
    render(<SettingsRow label="Signed in as Sam" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('does not nest a control inside a button', () => {
    // A row carrying a Switch puts the interaction on the Switch. If the row
    // were also a button, the two would fight for the same tap.
    render(
      <SettingsRow
        label="Debug overlays"
        trailing={<Switch aria-label="Toggle debug overlays" />}
      />,
    );

    const toggle = screen.getByRole('switch', { name: 'Toggle debug overlays' });
    expect(toggle.closest('button[type="button"]')).toBe(toggle);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('marks the current row for assistive tech, not only with a tint', () => {
    render(<SettingsRow label="Ground floor" selected onClick={() => {}} />);
    expect(screen.getByRole('button', { name: /Ground floor/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('does not fire when disabled', () => {
    const onClick = vi.fn();
    render(<SettingsRow label="Log out" onClick={onClick} disabled />);

    fireEvent.click(screen.getByRole('button', { name: /Log out/ }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('keeps the icon out of the accessible name', () => {
    render(<SettingsRow icon="🎨" label="Theme" description="Cozy Day" onClick={() => {}} />);

    // Asserted on the ACCESSIBLE NAME, not on `textContent`: the emoji is still
    // in the DOM (that is what draws it), and `aria-hidden` is precisely the
    // thing that keeps it out of what a screen reader announces.
    expect(screen.getByRole('button')).toHaveAccessibleName('Theme Cozy Day');
  });
});

describe('SettingsSection', () => {
  it('labels its group with a heading', () => {
    render(
      <SettingsSection label="Appearance">
        <SettingsRow label="Theme" onClick={() => {}} />
      </SettingsSection>,
    );
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument();
  });

  it('renders an unlabelled group without an empty heading', () => {
    render(
      <SettingsSection>
        <SettingsRow label="Theme" onClick={() => {}} />
      </SettingsSection>,
    );
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });
});
