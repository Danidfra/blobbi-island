/**
 * The pet card — that it reads like a pet, and still says everything.
 *
 * The redesign moved every fact somewhere new, so the risk is not that it looks
 * wrong but that something quietly stopped being shown. These tests hold the
 * facts, the accessibility of the meters, and the one rule the mood headline
 * exists to enforce: a pet has ONE headline, chosen by a documented precedence,
 * derived entirely from state that already existed.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { MoodHero, NeedMeters, ProgressionStrip, TraitChips, type PetCardStats } from './PetCard';
import { blobbiMood, needLevel } from '@/lib/blobbi-mood';

const STATS: PetCardStats = {
  hunger: 80,
  energy: 40,
  happiness: 95,
  health: 60,
  hygiene: 20,
  experience: 1500,
  careStreak: 5,
  generation: 2,
  stage: 'adult',
  personality: ['Curious', 'Playful'],
  trait: 'Sparkly',
  mood: 'content',
};

describe('the mood headline', () => {
  it('says one thing, chosen by precedence', () => {
    // Asleep outranks everything — telling a sleeping pet it is tired would be
    // a strange thing for the game to do.
    expect(
      blobbiMood({ condition: 'poor', urgency: 'high', urgentNeed: 'rest', sleepState: 'sleeping' })
        .label,
    ).toBe('Fast asleep');

    // An urgent need outranks the general condition.
    expect(
      blobbiMood({ condition: 'good', urgency: 'high', urgentNeed: 'cleaning' }).label,
    ).toBe('Needs a wash');

    // With nothing urgent, the condition speaks.
    expect(blobbiMood({ condition: 'excellent', urgency: 'none' }).label).toBe('Feeling amazing');
  });

  it('gives every need and every condition a phrase', () => {
    // An unmapped key would render `undefined` in the player's face.
    for (const need of ['food', 'play', 'medicine', 'cleaning', 'rest', 'attention'] as const) {
      const mood = blobbiMood({ condition: 'good', urgency: 'high', urgentNeed: need });
      expect(mood.label, need).toBeTruthy();
      expect(mood.emoji, need).toBeTruthy();
      expect(mood.hint, need).toBeTruthy();
    }
    for (const condition of ['excellent', 'good', 'fair', 'poor', 'critical'] as const) {
      expect(blobbiMood({ condition, urgency: 'none' }).label, condition).toBeTruthy();
    }
  });

  it('escalates its tone with urgency, not with colour alone', () => {
    expect(blobbiMood({ condition: 'good', urgency: 'low', urgentNeed: 'food' }).tone).toBe('calm');
    expect(blobbiMood({ condition: 'good', urgency: 'medium', urgentNeed: 'food' }).tone).toBe(
      'notice',
    );
    expect(blobbiMood({ condition: 'good', urgency: 'critical', urgentNeed: 'food' }).tone).toBe(
      'alert',
    );
  });

  it('announces itself, and carries meaning outside the emoji', () => {
    render(
      <MoodHero
        care={{ condition: 'fair', urgency: 'high', urgentNeed: 'cleaning' }}
        stats={{ isSleeping: false }}
      />,
    );

    const hero = screen.getByTestId('mood-hero');
    // A live region, so the headline is heard when the pet's state changes.
    expect(hero).toHaveAttribute('role', 'status');
    expect(hero).toHaveAttribute('data-tone', 'alert');
    // The phrase is text, not just a face.
    expect(hero).toHaveTextContent('Needs a wash');
    expect(hero).toHaveTextContent(/soap/i);
  });
});

describe('the need meters', () => {
  it('shows all five needs as real progress bars', () => {
    render(<NeedMeters stats={STATS} />);

    const bars = screen.getAllByRole('progressbar');
    expect(bars).toHaveLength(5);

    // The bar IS the information, so it carries the full ARIA quartet — a div
    // that merely looks like a meter tells a screen-reader user nothing.
    const clean = screen.getByRole('progressbar', { name: 'Clean' });
    expect(clean).toHaveAttribute('aria-valuenow', '20');
    expect(clean).toHaveAttribute('aria-valuemin', '0');
    expect(clean).toHaveAttribute('aria-valuemax', '100');
  });

  it('labels every need in words', () => {
    render(<NeedMeters stats={STATS} />);
    for (const label of ['Fed', 'Rested', 'Happy', 'Healthy', 'Clean']) {
      expect(screen.getByRole('progressbar', { name: label })).toBeInTheDocument();
    }
  });

  it('agrees with the urgency thresholds the model already uses', () => {
    // `getStatUrgency` treats <=25 as high/critical and <=50 as medium. A meter
    // that looked fine while the headline said "Hungry" would be a lie.
    expect(needLevel(10)).toBe('critical');
    expect(needLevel(25)).toBe('critical');
    expect(needLevel(26)).toBe('low');
    expect(needLevel(50)).toBe('low');
    expect(needLevel(51)).toBe('good');
  });
});

describe('progression', () => {
  it('shows XP, streak and generation without inventing a level', () => {
    render(<ProgressionStrip stats={STATS} />);

    const strip = screen.getByTestId('progression');
    expect(strip).toHaveTextContent('1,500');
    expect(strip).toHaveTextContent('5');
    expect(strip).toHaveTextContent('Gen 2');
    expect(strip).toHaveTextContent('adult');

    // The game has raw XP and no thresholds. A progress bar would need a
    // ceiling, and inventing one would be a fake level system.
    expect(strip.querySelector('[role="progressbar"]')).toBeNull();
  });
});

describe('character', () => {
  it('renders each personality and trait as its own chip', () => {
    render(<TraitChips stats={STATS} />);

    const chips = screen.getByTestId('trait-chips');
    // The model stores `string | string[]`; the old card joined arrays with
    // commas, printing a database field verbatim.
    expect(chips).toHaveTextContent('Curious');
    expect(chips).toHaveTextContent('Playful');
    expect(chips).toHaveTextContent('Sparkly');
    expect(chips).toHaveTextContent('content');
    expect(chips.textContent).not.toContain(',');
  });

  it('renders nothing at all when the Blobbi has no character data', () => {
    const { container } = render(
      <TraitChips stats={{ ...STATS, personality: undefined, trait: undefined, mood: undefined }} />,
    );
    // An empty chip row would be a labelled box with nothing in it.
    expect(container).toBeEmptyDOMElement();
  });
});
