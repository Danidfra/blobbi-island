/**
 * The capability matrix, pinned.
 *
 * Two distinct jobs, and the first matters more than the second:
 *
 *  1. **Standard must keep describing what ships today.** Every assertion in
 *     `the Standard experience` corresponds to behaviour that exists in the
 *     application right now, cited to where it lives. If a future Family
 *     restriction is written into the wrong literal, or Standard is quietly
 *     tightened during a refactor, these fail — which is the whole reason the
 *     policy foundation can be added without a product change.
 *  2. **Family must keep its shape.** Especially the parts that are easy to
 *     over-restrict: a Family island still has multiplayer, still has shared
 *     activities, and still has a way to speak.
 */
import { describe, expect, it } from 'vitest';

import { EXPERIENCE_PROFILES } from './experience-profile';
import { assertPolicyInvariants, type IslandSafetyPolicy } from './island-safety-policy';
import { FAMILY_POLICY, STANDARD_POLICY } from './policies';
import { resolveSafetyPolicy } from './resolve';

const ALL_POLICIES: readonly IslandSafetyPolicy[] = [STANDARD_POLICY, FAMILY_POLICY];

describe('the Standard experience describes what ships today', () => {
  it('allows free-text chat, which is live as kind 21201', () => {
    expect(STANDARD_POLICY.freeTextChat).toBe(true);
  });

  it('shows names other players chose for their Blobbis', () => {
    expect(STANDARD_POLICY.strangerAuthoredNames).toBe(true);
    expect(STANDARD_POLICY.ownFreeTextNaming).toBe(true);
  });

  it('lets a player leave the island, by link, platform share or OS sheet', () => {
    // The audit recommends adding a confirmation step for Standard too. That is
    // a visible product change and belongs to the phase that implements it; a
    // policy literal is not the place to smuggle one in.
    expect(STANDARD_POLICY.externalLinks).toBe(true);
    expect(STANDARD_POLICY.socialPlatformSharing).toBe(true);
    expect(STANDARD_POLICY.nativeShareSheet).toBe(true);
  });

  it('accepts any embeddable YouTube reference in the theater', () => {
    expect(STANDARD_POLICY.openMediaEntry).toBe(true);
  });

  it('keeps the PhotoBooth publish path, the relay selector and the item tools', () => {
    expect(STANDARD_POLICY.mediaUploads).toBe(true);
    expect(STANDARD_POLICY.publicNotePublishing).toBe(true);
    expect(STANDARD_POLICY.relaySelection).toBe(true);
    expect(STANDARD_POLICY.authoringTools).toBe(true);
  });

  it('publishes presence at full detail', () => {
    expect(STANDARD_POLICY.multiplayerPresence).toBe(true);
    expect(STANDARD_POLICY.sharedActivities).toBe(true);
    expect(STANDARD_POLICY.detailedPresence).toBe(true);
  });

  it('restricts nothing that is not already absent from the island', () => {
    // A Standard policy field may only be false where the island has no such
    // capability in ANY profile. Anything else would be a silent tightening.
    const falseFields = Object.entries(STANDARD_POLICY)
      .filter(([, value]) => value === false)
      .map(([key]) => key);

    expect(falseFields.sort()).toEqual(
      ['arbitraryRemoteMedia', 'directMessages', 'strangerProfileMetadata'].sort(),
    );
  });
});

describe('the Family experience', () => {
  it('refuses arbitrary player-authored text where the player is the author', () => {
    expect(FAMILY_POLICY.freeTextChat).toBe(false);
    expect(FAMILY_POLICY.ownFreeTextNaming).toBe(false);
  });

  it('currently PERMITS stranger-authored names — a deferred product decision', () => {
    // Not an oversight, and not a regression to fix by flipping this back. The
    // substitution mechanism exists and is tested against a hand-built policy;
    // the shipped profile does not select it while the social identity model
    // (friends, nicknames, alias collisions) is undecided.
    //
    // This assertion exists so that changing the shipped answer is a deliberate
    // act with a test to update, rather than a quiet edit to a literal.
    expect(FAMILY_POLICY.strangerAuthoredNames).toBe(true);
  });

  it('substitutes rather than silences: a communication channel remains', () => {
    expect(FAMILY_POLICY.predefinedPhrases || FAMILY_POLICY.emotes).toBe(true);
  });

  it('closes every exit from the island', () => {
    expect(FAMILY_POLICY.externalLinks).toBe(false);
    expect(FAMILY_POLICY.socialPlatformSharing).toBe(false);
    expect(FAMILY_POLICY.nativeShareSheet).toBe(false);
  });

  it('refuses arbitrary media and permanent public publishing', () => {
    expect(FAMILY_POLICY.openMediaEntry).toBe(false);
    expect(FAMILY_POLICY.mediaUploads).toBe(false);
    expect(FAMILY_POLICY.publicNotePublishing).toBe(false);
    expect(FAMILY_POLICY.authoringTools).toBe(false);
  });

  it('pins the relay, because a different relay is a different population', () => {
    expect(FAMILY_POLICY.relaySelection).toBe(false);
  });

  it('is NOT a single-player mode', () => {
    // The load-bearing assertion of this file. Every restriction above is
    // acceptable because the island itself is still shared; a future
    // "simplification" that switches these off changes what the product is.
    expect(FAMILY_POLICY.multiplayerPresence).toBe(true);
    expect(FAMILY_POLICY.sharedActivities).toBe(true);
  });

  it('coarsens presence detail', () => {
    expect(FAMILY_POLICY.detailedPresence).toBe(false);
  });
});

describe('invariants that hold in every profile', () => {
  it.each(ALL_POLICIES.map((p) => [p.profile, p] as const))(
    '%s satisfies the structural rules',
    (_label, policy) => {
      expect(() => assertPolicyInvariants(policy)).not.toThrow();
    },
  );

  it.each(ALL_POLICIES.map((p) => [p.profile, p] as const))(
    '%s has no private messaging, no stranger profile metadata and no arbitrary media',
    (_label, policy) => {
      expect(policy.directMessages).toBe(false);
      expect(policy.strangerProfileMetadata).toBe(false);
      expect(policy.arbitraryRemoteMedia).toBe(false);
    },
  );

  it('rejects a policy that removes speech without replacing it', () => {
    const silenced = { ...FAMILY_POLICY, predefinedPhrases: false, emotes: false };
    expect(() => assertPolicyInvariants(silenced)).toThrow(/substitution, never a removal/);
  });

  it('rejects a policy that turns the island single-player', () => {
    const alone = { ...FAMILY_POLICY, multiplayerPresence: false };
    expect(() => assertPolicyInvariants(alone)).toThrow(/multiplayerPresence must be true/);
  });

  it('rejects a policy that relaxes an island-wide invariant', () => {
    const leaky = { ...STANDARD_POLICY, strangerProfileMetadata: true } as unknown as IslandSafetyPolicy;
    expect(() => assertPolicyInvariants(leaky)).toThrow(/strangerProfileMetadata must be false/);
  });
});

describe('policies cannot be mutated at runtime', () => {
  it.each(ALL_POLICIES.map((p) => [p.profile, p] as const))('%s is frozen', (_label, policy) => {
    expect(Object.isFrozen(policy)).toBe(true);
  });

  it('keeps its value when a consumer tries to write to it', () => {
    const policy = FAMILY_POLICY as unknown as { freeTextChat: boolean };
    // Frozen objects throw in strict mode (ES modules are always strict), which
    // is the behaviour we want: a silent no-op write would leave the caller
    // believing it had relaxed the policy.
    expect(() => {
      policy.freeTextChat = true;
    }).toThrow();
    expect(FAMILY_POLICY.freeTextChat).toBe(false);
  });
});

describe('every profile has a policy', () => {
  it.each(EXPERIENCE_PROFILES.map((profile) => [profile] as const))(
    '%s resolves to a policy that names itself',
    (profile) => {
      const policy = resolveSafetyPolicy(profile);
      expect(policy.profile).toBe(profile);
      expect(() => assertPolicyInvariants(policy)).not.toThrow();
    },
  );

  it('describes the same capabilities in every profile', () => {
    // A field present in one policy and missing from another is how a capability
    // silently becomes `undefined` — which is falsy, and would read as
    // "restricted" at some call sites and "allowed" at others.
    expect(Object.keys(STANDARD_POLICY).sort()).toEqual(Object.keys(FAMILY_POLICY).sort());
  });
});
