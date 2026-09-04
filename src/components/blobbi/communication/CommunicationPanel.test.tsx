/**
 * The composition surface, under both profiles.
 *
 * The Family assertions are about ABSENCE, not disablement: there is no
 * composer in the tree, no textbox to find, and no tab that leads to one. A
 * disabled box telling a child what they may not do is both a worse experience
 * and a weaker guarantee — a mounted composer is one `onSend` away from being
 * reachable.
 *
 * What this file does NOT prove is safety. The panel is presentation; the
 * boundary is `MultiplayerLayer` (see `MultiplayerLayer.chat-policy.test.tsx`)
 * and `admitChatMessage`. These tests only show the surface agrees with them.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

import {
  ACTIVITY_VALUES,
  DESTINATION_VALUES,
  EMOTES,
  QUICK_PHRASES,
  TIME_VALUES,
} from '@/communication';
import { IslandSafetyProvider, type ExperienceProfile } from '@/safety';
import { islandThemes } from '@/lib/island-themes';

import { CommunicationPanel } from './CommunicationPanel';

function mount(profile: ExperienceProfile, onSend = vi.fn(), onClose = vi.fn()) {
  const view = render(
    <IslandSafetyProvider profile={profile}>
      <CommunicationPanel open onClose={onClose} onSend={onSend} />
    </IslandSafetyProvider>,
  );
  return { ...view, onSend, onClose };
}

const tabNames = () =>
  within(screen.getByRole('tablist')).getAllByRole('tab').map((tab) => tab.textContent);

describe('Standard offers every way to talk', () => {
  it('shows Quick, Phrases, Emotes and Message', () => {
    mount('standard');
    expect(tabNames()).toEqual(['Quick', 'Phrases', 'Emotes', 'Message']);
  });

  it('has a free-text composer', () => {
    mount('standard');
    fireEvent.click(screen.getByRole('tab', { name: 'Message' }));
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
  });

  it('sends what was typed', () => {
    const { onSend } = mount('standard');
    fireEvent.click(screen.getByRole('tab', { name: 'Message' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
      target: { value: '  hello   there  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(onSend).toHaveBeenCalledWith({ type: 'text', text: 'hello there' });
  });

  it('stays open after sending text, because typing is a conversation', () => {
    const { onClose } = mount('standard');
    fireEvent.click(screen.getByRole('tab', { name: 'Message' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
      target: { value: 'hi' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('Family offers everything except free text', () => {
  it('shows Quick, Phrases and Emotes, and no Message tab', () => {
    mount('family');
    expect(tabNames()).toEqual(['Quick', 'Phrases', 'Emotes']);
  });

  it('has no text input anywhere in the panel', () => {
    // Absence, not disablement: nothing to focus, nothing to fill, nothing that
    // could be re-enabled by a stray prop.
    mount('family');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Message' })).toBeNull();
  });

  it('says nothing about what the player may not do', () => {
    // A restricted experience that reads as a punishment is one a child works
    // around. The Family panel is three tabs of things they CAN do.
    const { container } = mount('family');
    expect(container.textContent?.toLowerCase()).not.toMatch(/not allowed|disabled|cannot|blocked/);
  });

  it('still offers the full quick-phrase and emote catalogs', () => {
    mount('family');
    for (const phrase of QUICK_PHRASES) {
      expect(screen.getByRole('button', { name: phrase.text })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('tab', { name: 'Emotes' }));
    for (const emote of EMOTES) {
      expect(screen.getByRole('button', { name: emote.label })).toBeInTheDocument();
    }
  });
});

describe('quick phrases', () => {
  it('sends a stable id, never the display text', () => {
    const { onSend } = mount('family');
    fireEvent.click(screen.getByRole('button', { name: 'Want to play?' }));

    expect(onSend).toHaveBeenCalledWith({ type: 'quick', phrase: 'want-to-play' });
  });

  it('closes the panel, because a one-tap message is one-shot', () => {
    const { onClose } = mount('family');
    fireEvent.click(screen.getByRole('button', { name: 'Hi!' }));

    expect(onClose).toHaveBeenCalled();
  });
});

describe('emotes', () => {
  it('sends a stable id, never a glyph', () => {
    const { onSend } = mount('family');
    fireEvent.click(screen.getByRole('tab', { name: 'Emotes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clap' }));

    expect(onSend).toHaveBeenCalledWith({ type: 'emote', emote: 'clap' });
  });

  it('names each control by its label, not by its picture', () => {
    // Without this an emote grid is seven identically-named buttons to a screen
    // reader, and the glyph itself is announced as an unhelpful character name.
    mount('standard');
    fireEvent.click(screen.getByRole('tab', { name: 'Emotes' }));

    const wave = screen.getByRole('button', { name: 'Wave' });
    expect(wave.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});

describe('the phrase builder', () => {
  const openBuilder = (profile: ExperienceProfile = 'family') => {
    const view = mount(profile);
    fireEvent.click(screen.getByRole('tab', { name: 'Phrases' }));
    return view;
  };

  it('lists the templates before asking for values', () => {
    openBuilder();
    expect(screen.getByRole('button', { name: 'Meet me at… in…' })).toBeInTheDocument();
  });

  it('offers only allowed values, as friendly labels', () => {
    openBuilder();
    fireEvent.click(screen.getByRole('button', { name: 'Meet me at… in…' }));

    const where = screen.getByLabelText('Where') as HTMLSelectElement;
    const when = screen.getByLabelText('When') as HTMLSelectElement;

    expect([...where.options].map((option) => option.value)).toEqual(
      DESTINATION_VALUES.map((value) => value.id),
    );
    expect([...where.options].map((option) => option.textContent)).toEqual(
      DESTINATION_VALUES.map((value) => value.label),
    );
    expect([...when.options].map((option) => option.value)).toEqual(
      TIME_VALUES.map((value) => value.id),
    );
  });

  it('has no free-text slot', () => {
    openBuilder();
    fireEvent.click(screen.getByRole('button', { name: 'Meet me at… in…' }));
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('previews the sentence the receiver will reconstruct', () => {
    openBuilder();
    fireEvent.click(screen.getByRole('button', { name: 'Meet me at… in…' }));
    fireEvent.change(screen.getByLabelText('Where'), { target: { value: 'beach' } });
    fireEvent.change(screen.getByLabelText('When'), { target: { value: '15m' } });

    expect(screen.getByTestId('phrase-preview').textContent).toBe(
      'Meet me at the Beach in 15 minutes.',
    );
  });

  it('sends ids, not the sentence it just previewed', () => {
    const { onSend } = openBuilder();
    fireEvent.click(screen.getByRole('button', { name: 'Meet me at… in…' }));
    fireEvent.change(screen.getByLabelText('Where'), { target: { value: 'mine' } });
    fireEvent.change(screen.getByLabelText('When'), { target: { value: '30m' } });
    fireEvent.click(screen.getByRole('button', { name: /^Send: / }));

    expect(onSend).toHaveBeenCalledWith({
      type: 'template',
      template: 'meet-at-in',
      params: { location: 'mine', time: '30m' },
    });
  });

  it('starts every template on a valid value, so Send is never a dead end', () => {
    const { onSend } = openBuilder();
    fireEvent.click(screen.getByRole('button', { name: 'Want to play…?' }));
    fireEvent.click(screen.getByRole('button', { name: /^Send: / }));

    expect(onSend).toHaveBeenCalledWith({
      type: 'template',
      template: 'want-to-play',
      params: { activity: ACTIVITY_VALUES[0].id },
    });
  });

  it('can go back to the template list', () => {
    openBuilder();
    fireEvent.click(screen.getByRole('button', { name: 'Meet me at… in…' }));
    fireEvent.click(screen.getByRole('button', { name: 'All phrases' }));

    expect(screen.getByRole('button', { name: "I'm going to…" })).toBeInTheDocument();
  });
});

describe('accessibility and interaction', () => {
  it('is a labelled dialog with a real tablist', () => {
    mount('standard');
    expect(screen.getByRole('dialog', { name: 'Communication' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Ways to talk' })).toBeInTheDocument();
  });

  it('marks the selected tab and links it to its panel', () => {
    mount('standard');
    const quick = screen.getByRole('tab', { name: 'Quick' });
    expect(quick).toHaveAttribute('aria-selected', 'true');
    expect(quick).toHaveAttribute('aria-controls', 'communication-panel-quick');
  });

  it('offers everything as real buttons rather than clickable divs', () => {
    // Keyboard operability comes from using the right element, not from adding
    // handlers to the wrong one.
    const { container } = mount('standard');
    expect(container.querySelectorAll('div[onclick]')).toHaveLength(0);
    expect(screen.getAllByRole('button').length).toBeGreaterThan(QUICK_PHRASES.length);
  });

  it('closes on Escape', () => {
    const { onClose } = mount('standard');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <IslandSafetyProvider profile="standard">
        <CommunicationPanel open={false} onClose={vi.fn()} onSend={vi.fn()} />
      </IslandSafetyProvider>,
    );
    expect(container.firstChild).toBeNull();
  });
});

/**
 * The tab strip must be legible in EVERY built-in theme. The class assertion
 * pins the token the tabs use; the contrast assertion computes WCAG contrast
 * from the palettes themselves, so a theme edit that pushes ink towards the
 * panel colour fails here rather than on a player's screen.
 */
describe('the Talk tabs are legible in every theme', () => {
  it('draws inactive tabs in ink and the selected tab in cream on wood', () => {
    mount('standard');
    const tabs = within(screen.getByRole('tablist')).getAllByRole('tab');
    const selected = tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true');
    const inactive = tabs.filter((tab) => tab.getAttribute('aria-selected') !== 'true');
    expect(selected).toHaveLength(1);
    expect(inactive.length).toBeGreaterThan(0);
    expect(selected[0].className).toContain('bg-island-wood-dark');
    expect(selected[0].className).toContain('text-island-cream');
    expect(selected[0].className).not.toContain('bg-island-ocean');
    for (const tab of inactive) {
      expect(tab.className).toContain('text-island-ink');
      expect(tab.className).not.toContain('text-island-wood-dark');
    }
  });

  it.each(islandThemes.map((theme) => [theme.name, theme] as const))(
    'both tab states clear WCAG AA in %s',
    (_name, theme) => {
      expect(contrastRatio(theme.palette.ink, theme.palette['cream-2'])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.palette.cream, theme.palette['wood-dark'])).toBeGreaterThanOrEqual(4.5);
    },
  );
});

/** `"h s% l%"` (the palette's CSS-variable form) → WCAG relative luminance. */
function luminance(hsl: string): number {
  const [h, s, l] = hsl.split(/\s+/).map((part) => parseFloat(part));
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = light - c / 2;
  const sector = Math.floor(h / 60) % 6;
  const [r1, g1, b1] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][sector];
  const channel = (v: number) => {
    const srgb = v + m;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r1) + 0.7152 * channel(g1) + 0.0722 * channel(b1);
}

function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
