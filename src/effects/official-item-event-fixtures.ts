/**
 * Blobbi Island: the CURRENTLY PUBLISHED official kind:31632 events, verbatim.
 *
 * FIXTURE / DIAGNOSTIC DATA ONLY. These are the sixteen issuer-signed events
 * supplied with Phase 9 (four wearable cosmetics, twelve visual-effect items),
 * stored so that:
 *
 *   1. the fixture tests can prove the canonical registry still agrees with
 *      what is actually published (names, images, effect ids, slots, forms,
 *      rarities, arcade-prize topics), through the real package parser and a
 *      real signature check;
 *   2. the dev inspector can show "current published revision" ids next to the
 *      stable addresses.
 *
 * NOTHING AT RUNTIME MAY KEY ON `id` OR `sig`. kind:31632 is addressable: the
 * issuer republishes a definition (new event id, new signature, SAME address)
 * whenever metadata changes, so the ids below describe the current revisions
 * only. Stable identity is always `31632:<issuer>:<d>` and lives in
 * `src/protocol/event-registry.ts`. The production activation path
 * (`official-visual-effect-items.ts`, `active-effects.ts`) does not import
 * this module: a source-level test asserts that.
 *
 * The events are byte-exact as supplied, including the pretty-printed content
 * JSON of Firefly Friends / Love Burst / Bubble Bliss (whitespace is inside
 * the signed content and must not be "cleaned up"). One labelling note: the
 * Phase-9 hand-off text titled Rainbow Dream's event "Rainbow Cream"; the
 * SIGNED EVENT says `Rainbow Dream` / `blobbi:effect:rainbow-dream`, and
 * signed content always outranks a fixture label.
 */

import type { NostrEvent } from '@nostrify/nostrify';

/** One published official definition, as fetched from the wire. */
export interface OfficialItemEventFixture {
  /** The stable `d` tag, duplicated out of the tags for convenient lookup. */
  d: string;
  /** `'wearable'` (image-drawn cosmetic) or `'visual-effect'`. */
  kind: 'wearable' | 'visual-effect';
  /** The signed event, verbatim. `id`/`sig` are CURRENT-REVISION facts only. */
  event: NostrEvent;
}

export const OFFICIAL_ITEM_EVENT_FIXTURES: readonly OfficialItemEventFixture[] = [
  {
    d: 'blobbi:cosmetic:celestial-seraph-necklace',
    kind: 'wearable',
    event: {
      id: '9bdc46cc04b94e98784859ac7a895d0ee93bf74e43f33c6f703fd47bab9bcd8e',
      kind: 31632,
      pubkey:
        '9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9',
      tags: [
        ['d', 'blobbi:cosmetic:celestial-seraph-necklace'],
        ['name', 'Celestial Seraph Necklace'],
        ['type', 'cosmetic'],
        ['category', 'neckwear'],
        [
          'image',
          'https://blossom.primal.net/5f336dd3c25ba80f296bfabcce3a329b4418f9b00901a632e9c0385ca06add35.webp',
        ],
        [
          'image',
          'https://blossom.primal.net/5f336dd3c25ba80f296bfabcce3a329b4418f9b00901a632e9c0385ca06add35.webp',
          'front',
        ],
        [
          'image',
          'https://blossom.primal.net/1abce8c77fcd9acd55ce124119846557170517010113fef1e6f21aa5afd6946e.webp',
          'side-right',
        ],
        [
          'image',
          'https://blossom.primal.net/2263eb42b7e8364878cccd2bcb5b4b5615db8a9d41ec6e46b90755e9bc35848c.webp',
          'back',
        ],
        [
          'image',
          'https://blossom.primal.net/92eca014d92b614a24983e0daa614ab5f621dff7fd0745eeb5e6f1f05d29d53b.webp',
          'side-left',
        ],
        ['symbol', '🪽'],
        ['rarity', 'mythic'],
        ['max_stack', '1'],
        ['version', '1'],
        ['context', 'game:blobbi'],
        ['context', 'game:blobbi-island'],
        ['t', 'equipable'],
        ['t', 'wearable'],
        ['t', 'cosmetic'],
        ['t', 'neckwear'],
        ['t', 'celestial'],
        ['t', 'angelic'],
        ['t', 'seraph'],
        ['t', 'wings'],
        ['t', 'starlight'],
        ['t', 'radiant'],
        ['t', 'mythic'],
        ['alt', 'Game item definition: Celestial Seraph Necklace'],
        ['client', 'blobbi'],
      ],
      content:
        '{"description":"A mythical necklace woven from celestial gold, luminous crystals, and guardian wings, said to shine brightest for Blobbis with a brave and generous heart.","metadata":{"itemId":"celestial-seraph-necklace","stackable":false},"visual":{"slot":"neckwear","forms":["baby","adult"]}}',
      created_at: 1785457227,
      sig: 'b79e620a504db4108c326979eefdc9a1df9bfc67212d823ef8417cac0f2b8503bca6f12ed306470e70aa3e1cbce606e37d0cc9f83d8035a2e5ed4f832b284969',
    },
  },
  {
    d: 'blobbi:cosmetic:starlight-bow-tie',
    kind: 'wearable',
    event: {
      id: 'b9dc4a1318cad9153b5731ac291e384791afb4ae4e061e609725ebbd3971400f',
      kind: 31632,
      pubkey:
        '9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9',
      tags: [
        ['d', 'blobbi:cosmetic:starlight-bow-tie'],
        ['name', 'Starlight Bow Tie'],
        ['type', 'cosmetic'],
        ['category', 'neckwear'],
        [
          'image',
          'https://blossom.primal.net/d82adf8e2004ef4ea93a44ddf3070c8885b961d71ac41eb3c3f8635ab6908448.webp',
        ],
        [
          'image',
          'https://blossom.primal.net/d82adf8e2004ef4ea93a44ddf3070c8885b961d71ac41eb3c3f8635ab6908448.webp',
          'front',
        ],
        [
          'image',
          'https://blossom.primal.net/aa0cd1156cba280f65cc09a0e0f6317d0819693cf82309888987eb401d09e20e.webp',
          'side-left',
        ],
        [
          'image',
          'https://blossom.primal.net/137a7179da57968d9467cb4ccb38b6543f7dc5ce7f4cd6067b8ff3372fee7318.webp',
          'side-right',
        ],
        ['symbol', '🎀'],
        ['rarity', 'epic'],
        ['max_stack', '1'],
        ['version', '1'],
        ['context', 'game:blobbi'],
        ['context', 'game:blobbi-island'],
        ['t', 'equipable'],
        ['t', 'wearable'],
        ['t', 'cosmetic'],
        ['t', 'neckwear'],
        ['t', 'starlight'],
        ['t', 'sparkling'],
        ['t', 'elegant'],
        ['t', 'celebration'],
        ['alt', 'Game item definition: Starlight Bow Tie'],
        ['client', 'blobbi'],
      ],
      content:
        '{"description":"A radiant bow tie filled with shimmering colors and tiny starlight reflections, perfect for Blobbis who want every adventure to feel like a celebration.","metadata":{"stackable":false,"itemId":"starlight-bow-tie"},"visual":{"slot":"neckwear","forms":["baby","adult"]}}',
      created_at: 1785440345,
      sig: '91ed60b76520e430aa113eeb8c54e9f720c1482976046c89135b9c85665bfec2561cd69d26ab638174973369f3c029d8d908a34c6df398a6f93ce2d7b3bbda50',
    },
  },
  {
    d: 'blobbi:cosmetic:block-builder-cap',
    kind: 'wearable',
    event: {
      id: '8552d790b7cd6ab1585329ea1e21d3386d1bba70d5b511e6446681c43af672ed',
      kind: 31632,
      pubkey:
        '9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9',
      tags: [
        ['d', 'blobbi:cosmetic:block-builder-cap'],
        ['name', 'Block Builder Cap'],
        ['type', 'cosmetic'],
        ['category', 'headwear'],
        [
          'image',
          'https://blossom.primal.net/11ed179592981472e25b9a327d8c6bfd55b7a3bae0a8d805e071b8ba4e47d1dc.webp',
        ],
        [
          'image',
          'https://blossom.primal.net/11ed179592981472e25b9a327d8c6bfd55b7a3bae0a8d805e071b8ba4e47d1dc.webp',
          'front',
        ],
        [
          'image',
          'https://blossom.primal.net/3e590f6e43040a399e196d32ea636da31ac23520854e1971988237e8a18d9825.webp',
          'side-right',
        ],
        [
          'image',
          'https://blossom.primal.net/5175d1b0ff2b5f698b62c10fb21bb07d78507a556f39ec33b75e50d6b70d8f9c.webp',
          'side-left',
        ],
        [
          'image',
          'https://blossom.primal.net/10f1f328c6c77c6cb9ed10c16cb66c185dafcba005c7f5640d678a416bdda3bc.webp',
          'back',
        ],
        ['symbol', '🧢'],
        ['rarity', 'uncommon'],
        ['max_stack', '1'],
        ['version', '1'],
        ['context', 'game:blobbi'],
        ['context', 'game:blobbi-island'],
        ['t', 'equipable'],
        ['t', 'wearable'],
        ['t', 'cosmetic'],
        ['t', 'headwear'],
        ['t', 'building'],
        ['t', 'blocks'],
        ['t', 'creative'],
        ['t', 'builder'],
        ['alt', 'Game item definition: Block Builder Cap'],
        ['client', 'blobbi'],
      ],
      content:
        '{"description":"A playful cap for Blobbis who love stacking blocks, building strange little worlds, and turning every idea into an adventure.","metadata":{"itemId":"block-builder-cap","stackable":false},"visual":{"slot":"headwear","forms":["baby","adult"]}}',
      created_at: 1785438784,
      sig: '04185914d5f1b1bc1d0f34a96f96fa425ce488a8602215424c535cedb18b637acc7561b731941f202c5fa178afb0e37d807695a435c83ab3a93a3abcd46d82b4',
    },
  },
  {
    d: 'blobbi:cosmetic:stargazer-glasses',
    kind: 'wearable',
    event: {
      id: 'b6f1699a06e139eb3caa60581e9fe950b7d0ad30efa0e1927c122faab48488b1',
      kind: 31632,
      pubkey:
        '9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9',
      tags: [
        ['d', 'blobbi:cosmetic:stargazer-glasses'],
        ['name', 'Stargazer Glasses'],
        ['type', 'cosmetic'],
        ['category', 'eyewear'],
        [
          'image',
          'https://blossom.primal.net/0f67191987cfbfd637c8eb57db2741dd48b2d74180ef187fdf8297674a80006c.webp',
        ],
        [
          'image',
          'https://blossom.primal.net/0f67191987cfbfd637c8eb57db2741dd48b2d74180ef187fdf8297674a80006c.webp',
          'front',
        ],
        [
          'image',
          'https://blossom.primal.net/168c5eed003a090c3cb6dbfba6b98c52cf632619ba323bc995120f21a7191276.webp',
          'side-left',
        ],
        [
          'image',
          'https://blossom.primal.net/4b2ccc04aebf8dc2d9107383fb909ebbabac73914690328516a9cf6cb04c45ae.webp',
          'side-right',
        ],
        ['symbol', '👓'],
        ['rarity', 'rare'],
        ['max_stack', '1'],
        ['version', '1'],
        ['context', 'game:blobbi'],
        ['context', 'game:blobbi-island'],
        ['t', 'equipable'],
        ['t', 'wearable'],
        ['t', 'cosmetic'],
        ['t', 'eyewear'],
        ['t', 'explorer'],
        ['t', 'stargazing'],
        ['t', 'adventure'],
        ['t', 'curiosity'],
        ['alt', 'Game item definition: Stargazer Glasses'],
        ['client', 'blobbi'],
      ],
      content:
        '{"description":"A pair of golden explorer glasses with shimmering ocean-blue lenses, made for curious Blobbis who are always searching for the next wonder.","metadata":{"stackable":false,"itemId":"stargazer-glasses"},"visual":{"slot":"eyewear","forms":["baby","adult"]}}',
      created_at: 1785438715,
      sig: '615f4c35e1e8b58e35bed62d4965862d36ef72d896a70e5fad2dfc5491e08c46463f3be3ec76c1a7a05cd3bd69655a5d939dedaf50ee13d8683b0551ccef097b',
    },
  },
  {
    d: 'blobbi:effect:rainbow-dream',
    kind: 'visual-effect',
    event: {
      id: 'c010d3ed5e32eb63508ad7f4a354ed39a2a7b96d44ed3615794b5ee9e28ed503',
      kind: 31632,
      pubkey:
        '9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9',
      tags: [
        ['d', 'blobbi:effect:rainbow-dream'],
        ['name', 'Rainbow Dream'],
        ['type', 'cosmetic'],
        ['category', 'effect'],
        [
          'image',
          'https://blossom.primal.net/9b1f04492087f138c27604b55feaa3264d6b4b00d2a77e9286319243317ae3bd.webp',
        ],
        ['symbol', '🌈'],
        ['rarity', 'mythic'],
        ['max_stack', '1'],
        ['version', '1'],
        ['context', 'game:blobbi'],
        ['context', 'game:blobbi-island'],
        ['t', 'equipable'],
        ['t', 'wearable'],
        ['t', 'visual-effect'],
        ['t', 'aura'],
        ['t', 'rainbow'],
        ['t', 'dream'],
        ['alt', 'Game item definition: Rainbow Dream'],
        ['client', 'blobbi'],
      ],
      content:
        '{"description":"A dreamy ribbon of rainbow light and sparkling color dances gently around your Blobbi.","visual":{"kind":"blobbi-effect","effect":"rainbow-dream","effectSlot":"aura","forms":["baby","adult"]}}',
      created_at: 1785538727,
      sig: '5268a6453cc39807e87083f176f033409eab6e218d5c2124c283cd38e95c053b29cdc6563d261f5a834920dcf655c355a46e782963651ec6a5dcef9c71840cdf',
    },
  },
  {
    d: 'blobbi:effect:void-whispers',
    kind: 'visual-effect',
    event: {
      id: 'faa465fb3f8c910bdcb7a7ada7e05fb61b95b57d6ec62e8fb50ed38dd34a07f5',
      kind: 31632,
      pubkey:
        '9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9',
      tags: [
        ['d', 'blobbi:effect:void-whispers'],
        ['name', 'Void Whispers'],
        ['type', 'cosmetic'],
        ['category', 'effect'],
        [
          'image',
          'https://blossom.primal.net/e2f61dff13ee7baee7a15d4df4de8f96af8c439cbee295cfbb962b466269f043.webp',
        ],
        ['symbol', '🌑'],
        ['rarity', 'legendary'],
        ['max_stack', '1'],
        ['version', '1'],
        ['context', 'game:blobbi'],
        ['context', 'game:blobbi-island'],
        ['t', 'equipable'],
        ['t', 'wearable'],
        ['t', 'visual-effect'],
        ['t', 'aura'],
        ['t', 'void'],
        ['t', 'cosmic'],
        ['alt', 'Game item definition: Void Whispers'],
        ['client', 'blobbi'],
      ],
      content:
        '{"description":"Dark cosmic motes and faint violet rings drift around your Blobbi as if the void itself were quietly listening.","visual":{"kind":"blobbi-effect","effect":"void-whispers","effectSlot":"aura","forms":["baby","adult"]}}',
      created_at: 1785538506,
      sig: 'abee2ff664a862b84cc5cf93a09161a01495880bc838525e6b94d41b733f9145a54a43097391cd5b4aeaa45574f5702c70a508e095270faac21b9a671214e883',
    },
  },
  {
    d: 'blobbi:effect:solar-radiance',
    kind: 'visual-effect',
    event: {
      id: '9c4da30528e8c8286454527d5d3d1b58c2b726630cce69216e54af65113841d8',
      kind: 31632,
      pubkey:
        '9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9',
      tags: [
        ['d', 'blobbi:effect:solar-radiance'],
        ['name', 'Solar Radiance'],
        ['type', 'cosmetic'],
        ['category', 'effect'],
        [
          'image',
          'https://blossom.primal.net/e3e1a8066656a685341ac9b0a9f4328f392ef00c795447bd50cc006dba753c4c.webp',
        ],
        ['symbol', '☀️'],
        ['rarity', 'legendary'],
        ['max_stack', '1'],
        ['version', '1'],
        ['context', 'game:blobbi'],
        ['context', 'game:blobbi-island'],
        ['t', 'equipable'],
        ['t', 'wearable'],
        ['t', 'visual-effect'],
        ['t', 'aura'],
        ['t', 'solar'],
        ['t', 'radiance'],
        ['alt', 'Game item definition: Solar Radiance'],
        ['client', 'blobbi'],
      ],
      content:
        '{"description":"Warm rays of miniature sunlight shine behind your Blobbi, filling the air with golden energy.","visual":{"kind":"blobbi-effect","effect":"solar-radiance","effectSlot":"aura","forms":["baby","adult"]}}',
      created_at: 1785538001,
      sig: '09a740932e51961436af7bb593acd35296da959ed335d57d078c8c54e970e1dd7e9165a12933e4a4b1745b70665f0cf4cc7de62cbc55996fe67ea687596257ef',
    },
  },
  {
    d: 'blobbi:effect:celestial-aura',
    kind: 'visual-effect',
    event: {
      id: 'ebb2effcf21a4310be59d354ebd1958b8049673e1ae77bb8719b28162a5d6654',
      kind: 31632,
      pubkey:
        '9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9',
      tags: [
        ['d', 'blobbi:effect:celestial-aura'],
        ['name', 'Celestial Aura'],
        ['type', 'cosmetic'],
        ['category', 'effect'],
        [
          'image',
          'https://blossom.primal.net/509be399fc971a21831fb0d233800560be198e9284f09e27380b014a77ef1c59.webp',
        ],
        ['symbol', '🌌'],
        ['rarity', 'legendary'],
        ['max_stack', '1'],
        ['version', '1'],
        ['context', 'game:blobbi'],
        ['context', 'game:blobbi-island'],
        ['t', 'equipable'],
        ['t', 'wearable'],
        ['t', 'visual-effect'],
        ['t', 'aura'],
        ['t', 'celestial'],
        ['t', 'stars'],
        ['t', 'arcade-prize'],
        ['alt', 'Game item definition: Celestial Aura'],
        ['client', 'blobbi'],
      ],
      content:
        '{"description":"A radiant celestial halo surrounds your Blobbi while tiny stars orbit in a calm blue-violet glow.","visual":{"kind":"blobbi-effect","effect":"celestial-aura","effectSlot":"aura","forms":["baby","adult"]}}',
      created_at: 1785537690,
      sig: 'f526903f848e7754ef0dfb56354712f481ddc3375c99411c68dafebc14a5836466598520ab55f24fb2cc0d1d1fd0b529da5a1a259c6d728cbae467b6356ca4c5',
    },
  },
  {
    d: 'blobbi:effect:electric-charge',
    kind: 'visual-effect',
    event: {
      id: '77780185bb757180ed55cff4a4fca5fdd3954d0ce8ee8a7e6c385954dc2c9236',
      kind: 31632,
      pubkey:
        '9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9',
      tags: [
        ['d', 'blobbi:effect:electric-charge'],
        ['name', 'Electric Charge'],
        ['type', 'cosmetic'],
        ['category', 'effect'],
        [
          'image',
          'https://blossom.primal.net/5c6b68f354d627984555865820668cb6dd51acfdc5981405682eeddae0f341f5.webp',
        ],
        ['symbol', '⚡'],
        ['rarity', 'epic'],
        ['max_stack', '1'],
        ['version', '1'],
        ['context', 'game:blobbi'],
        ['context', 'game:blobbi-island'],
        ['t', 'equipable'],
        ['t', 'wearable'],
        ['t', 'visual-effect'],
        ['t', 'electric'],
        ['t', 'lightning'],
        ['t', 'energy'],
        ['alt', 'Game item definition: Electric Charge'],
        ['client', 'blobbi'],
      ],
      content:
        '{"description":"Bright electric arcs crackle around your Blobbi with the energy of a fully charged arcade machine.","visual":{"kind":"blobbi-effect","effect":"electric-charge","effectSlot":"body-overlay","forms":["baby","adult"]}}',
      created_at: 1785537086,
      sig: 'bf17a629d67f73ea78a3856485f4550cb030b3572d72a282c4543d48de31b61152b2d3eece820479167795cf831d4a0aa1a21bceb95b3038b025fb6dd5c0733e',
    },
  },
  {
    d: 'blobbi:effect:pixel-glitch',
    kind: 'visual-effect',
    event: {
      id: 'b1469dde6cdd232bfd42a9f5673d16f693faa5edc452ac696b4104f2b5800f14',
      kind: 31632,
      pubkey:
        '9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9',
      tags: [
        ['d', 'blobbi:effect:pixel-glitch'],
        ['name', 'Pixel Glitch'],
        ['type', 'cosmetic'],
        ['category', 'effect'],
        [
          'image',
          'https://blossom.primal.net/85c2d70642a4504cb2650a41c7f002727f28a18da2fe811388aa03620d6db3d1.webp',
        ],
        ['symbol', '👾'],
        ['rarity', 'epic'],
        ['max_stack', '1'],
        ['version', '1'],
        ['context', 'game:blobbi'],
        ['context', 'game:blobbi-island'],
        ['t', 'equipable'],
        ['t', 'wearable'],
        ['t', 'visual-effect'],
        ['t', 'pixel'],
        ['t', 'glitch'],
        ['t', 'digital'],
        ['alt', 'Game item definition: Pixel Glitch'],
        ['client', 'blobbi'],
      ],
      content:
        '{"description":"Arcade pixels flicker around your Blobbi in a playful digital distortion from another dimension.","visual":{"kind":"blobbi-effect","effect":"pixel-glitch","effectSlot":"body-overlay","forms":["baby","adult"]}}',
      created_at: 1785536555,
      sig: '787bdd1251ccff3061f55de4697f75ff66a51be03623202e2e6f55e1bd0a0aa2e9323cdc37b6b7fbc88fe826df14e9617f585d2d5bd96d48cd2986ed3c82df37',
    },
  },
  {
    d: 'blobbi:effect:mystic-fog',
    kind: 'visual-effect',
    event: {
      id: 'e77726c624a0893ced825f50889dd9eb0680e5827cc5efb5b6be442ea8345cb0',
      kind: 31632,
      pubkey:
        '9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9',
      tags: [
        ['d', 'blobbi:effect:mystic-fog'],
        ['name', 'Mystic Fog'],
        ['type', 'cosmetic'],
        ['category', 'effect'],
        [
          'image',
          'https://blossom.primal.net/26d2c81643b914cda7418de76f38da83d3ba09497323f2528924e45c2e7ff732.webp',
        ],
        ['symbol', '🌫️'],
        ['rarity', 'epic'],
        ['max_stack', '1'],
        ['version', '1'],
        ['context', 'game:blobbi'],
        ['context', 'game:blobbi-island'],
        ['t', 'equipable'],
        ['t', 'wearable'],
        ['t', 'visual-effect'],
        ['t', 'fog'],
        ['t', 'mist'],
        ['t', 'mystic'],
        ['t', 'arcade-prize'],
        ['alt', 'Game item definition: Mystic Fog'],
        ['client', 'blobbi'],
      ],
      content:
        '{"description":"An enchanted veil of violet mist curls around your Blobbi, making every appearance feel mysterious.","visual":{"kind":"blobbi-effect","effect":"mystic-fog","effectSlot":"ground-local","forms":["baby","adult"]}}',
      created_at: 1785536372,
      sig: '47b0e94bd68d39cf037aa3f68741785dce92068088cf9491d755aea29482df64edc96d1be49b4889d230331d96897449feb23993fed9c2e138967047cefd9c98',
    },
  },
  {
    d: 'blobbi:effect:frost-breath',
    kind: 'visual-effect',
    event: {
      id: '12b69423a32f70f1ecc4ab4627b9e9aae057f9a7f7b6fc4b2bccbd6dab25b984',
      kind: 31632,
      pubkey:
        '9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9',
      tags: [
        ['d', 'blobbi:effect:frost-breath'],
        ['name', 'Frost Breath'],
        ['type', 'cosmetic'],
        ['category', 'effect'],
        [
          'image',
          'https://blossom.primal.net/af1e6d2e9b4dc835ae351ccd532d3837ad8b93e412818ecddda739ceb8e9e3a8.webp',
        ],
        ['symbol', '❄️'],
        ['rarity', 'epic'],
        ['max_stack', '1'],
        ['version', '1'],
        ['context', 'game:blobbi'],
        ['context', 'game:blobbi-island'],
        ['t', 'equipable'],
        ['t', 'wearable'],
        ['t', 'visual-effect'],
        ['t', 'frost'],
        ['t', 'snowflake'],
        ['t', 'ice'],
        ['alt', 'Game item definition: Frost Breath'],
        ['client', 'blobbi'],
      ],
      content:
        '{"description":"Cool crystal air swirls around your Blobbi, leaving tiny snowflakes and icy glimmers in its wake.","visual":{"kind":"blobbi-effect","effect":"frost-breath","effectSlot":"ground-local","forms":["baby","adult"]}}',
      created_at: 1785536344,
      sig: '8ce96439c8a74443f274a4e1c19b98fd1aa60cb1036e0ee99053ec2389acdd1e018bb2c971ae04a5663deab4065c030b77b24632a831332cb3954fcfbf521c90',
    },
  },
  {
    d: 'blobbi:effect:firefly-friends',
    kind: 'visual-effect',
    event: {
      id: 'a687263c52911d6da64e6a4c19e43ae8f67f30cc961ac433dbb39ad90ef0d198',
      kind: 31632,
      pubkey:
        '9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9',
      tags: [
        ['d', 'blobbi:effect:firefly-friends'],
        ['name', 'Firefly Friends'],
        ['type', 'cosmetic'],
        ['category', 'effect'],
        [
          'image',
          'https://blossom.primal.net/fc287963f85d392b50eac59f45b32c30fff456d624691696d333256df5a27b16.webp',
        ],
        ['symbol', '🏮'],
        ['rarity', 'rare'],
        ['max_stack', '1'],
        ['version', '1'],
        ['context', 'game:blobbi'],
        ['context', 'game:blobbi-island'],
        ['t', 'equipable'],
        ['t', 'wearable'],
        ['t', 'visual-effect'],
        ['t', 'fireflies'],
        ['t', 'nature'],
        ['t', 'particles'],
        ['alt', 'Game item definition: Firefly Friends'],
        ['client', 'blobbi'],
      ],
      content:
        '{\n  "description": "A friendly circle of tiny fireflies follows your Blobbi, blinking softly as they wander through the air.",\n  "visual": {\n    "kind": "blobbi-effect",\n    "effect": "firefly-friends",\n    "effectSlot": "ambient-particles",\n    "forms": ["baby", "adult"]\n  }\n}',
      created_at: 1785535953,
      sig: 'd2967e9909fa5b574785381c875cf34aa87b6b8bb0e080ac185016471b001b486a9eae5d00c2045d54da2f2cfc490f1e4dc2ea8c56a908f3fa70b4ce98c57357',
    },
  },
  {
    d: 'blobbi:effect:love-burst',
    kind: 'visual-effect',
    event: {
      id: '2061819ec8d5e84d3e476cb03d4a60d11d96de8270adc6c0da0e9130487848a8',
      kind: 31632,
      pubkey:
        '9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9',
      tags: [
        ['d', 'blobbi:effect:love-burst'],
        ['name', 'Love Burst'],
        ['type', 'cosmetic'],
        ['category', 'effect'],
        [
          'image',
          'https://blossom.primal.net/359b7369a33a90d9a822bc2a82b27aad80ef777ec98cf863b0a8bbcb36e09301.webp',
        ],
        ['symbol', '💖'],
        ['rarity', 'rare'],
        ['max_stack', '1'],
        ['version', '1'],
        ['context', 'game:blobbi'],
        ['context', 'game:blobbi-island'],
        ['t', 'equipable'],
        ['t', 'wearable'],
        ['t', 'visual-effect'],
        ['t', 'hearts'],
        ['t', 'love'],
        ['t', 'particles'],
        ['alt', 'Game item definition: Love Burst'],
        ['client', 'blobbi'],
      ],
      content:
        '{\n  "description": "Tiny glowing hearts appear around your Blobbi and float upward in warm little bursts of affection.",\n  "visual": {\n    "kind": "blobbi-effect",\n    "effect": "love-burst",\n    "effectSlot": "ambient-particles",\n    "forms": ["baby", "adult"]\n  }\n}',
      created_at: 1785535634,
      sig: '2685680f6ce9e0205944b002e982c2363afd7accb9a93b7ca9134f1641fb347e639c09fe3e2473e50ce62535b4c14465f34c3e7be0f6b8db2801986c13306369',
    },
  },
  {
    d: 'blobbi:effect:golden-sparkles',
    kind: 'visual-effect',
    event: {
      id: '46a7df488b0526614f8b68ee9759332a7e61ca8f9a3866904e7ecae1c400419a',
      kind: 31632,
      pubkey:
        '9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9',
      tags: [
        ['d', 'blobbi:effect:golden-sparkles'],
        ['name', 'Golden Sparkles'],
        ['type', 'cosmetic'],
        ['category', 'effect'],
        [
          'image',
          'https://blossom.primal.net/02be7a6849c3599ded9261f3d2d346e6a88261510f052ee2638406fc64c04877.webp',
        ],
        ['symbol', '✨'],
        ['rarity', 'rare'],
        ['max_stack', '1'],
        ['version', '1'],
        ['context', 'game:blobbi'],
        ['context', 'game:blobbi-island'],
        ['t', 'equipable'],
        ['t', 'visual-effect'],
        ['t', 'sparkles'],
        ['t', 'golden'],
        ['t', 'particles'],
        ['t', 'arcade-prize'],
        ['alt', 'Game item definition: Golden Sparkles'],
        ['client', 'blobbi'],
      ],
      content:
        '{"description":"A cheerful constellation of golden stars that twinkles and drifts around your Blobbi wherever it goes.","visual":{"kind":"blobbi-effect","effect":"golden-sparkles","effectSlot":"ambient-particles","forms":["baby","adult"]}}',
      created_at: 1785535302,
      sig: 'd15df7bf99b300459698aaa7a9b4308e4b19e7a8fc486a02c1727af0bf6ae2efd39788fc270852d0aeff564d7a0d2541512eca14c37c3ace71e67b2f03b42d30',
    },
  },
  {
    d: 'blobbi:effect:bubble-bliss',
    kind: 'visual-effect',
    event: {
      id: '511bf0180d0f993ba2c4ad7fb0c265041ed49b5c0e0067146955b4525ab11253',
      kind: 31632,
      pubkey:
        '9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9',
      tags: [
        ['d', 'blobbi:effect:bubble-bliss'],
        ['name', 'Bubble Bliss'],
        ['type', 'cosmetic'],
        ['category', 'effect'],
        [
          'image',
          'https://blossom.primal.net/3eb9f13c831adf9c916d32d0231b4cccdcb7edfdbbdb37d0ba25297d445c1b4f.webp',
        ],
        ['symbol', '🫧'],
        ['rarity', 'uncommon'],
        ['max_stack', '1'],
        ['version', '1'],
        ['context', 'game:blobbi'],
        ['context', 'game:blobbi-island'],
        ['t', 'equipable'],
        ['t', 'wearable'],
        ['t', 'visual-effect'],
        ['t', 'bubbles'],
        ['t', 'playful'],
        ['t', 'particles'],
        ['alt', 'Game item definition: Bubble Bliss'],
        ['client', 'blobbi'],
      ],
      content:
        '{\n  "description": "A playful stream of shimmering bubbles that gently rises and pops around your Blobbi.",\n  "visual": {\n    "kind": "blobbi-effect",\n    "effect": "bubble-bliss",\n    "effectSlot": "ambient-particles",\n    "forms": ["baby", "adult"]\n  }\n}',
      created_at: 1785535134,
      sig: '04a30bb1c544e2a292be0a229bf2e864ac6371e9dc280321a3543d27f9417929ce7e606dd3d69320ddab38e4668fc4cb81f7a3f8ccd874e8b94d323c1e1b36d4',
    },
  },
];

/** The wearable-cosmetic fixtures only. */
export const WEARABLE_EVENT_FIXTURES = OFFICIAL_ITEM_EVENT_FIXTURES.filter(
  (f) => f.kind === 'wearable',
);

/** The visual-effect fixtures only. */
export const EFFECT_EVENT_FIXTURES = OFFICIAL_ITEM_EVENT_FIXTURES.filter(
  (f) => f.kind === 'visual-effect',
);

/** Fixture lookup by `d` tag, or `null`. */
export function fixtureByD(d: string): OfficialItemEventFixture | null {
  return OFFICIAL_ITEM_EVENT_FIXTURES.find((f) => f.d === d) ?? null;
}
