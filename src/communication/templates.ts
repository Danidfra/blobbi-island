/**
 * The phrase-template registry: sentences with holes, and the closed sets of
 * things that may fill them.
 *
 * ## Not a grammar engine
 *
 * Five templates, three value catalogs, and a segment list per template. There
 * is no parser, no inflection, no agreement, no pluralisation, a template is a
 * fixed sequence of literal fragments and named holes, and rendering is a
 * `map`. That is enough to say the handful of things players actually need to
 * coordinate, and it keeps the receive-side validation to "is this id in this
 * list?", which is the property the safety argument depends on.
 *
 * ## Segments rather than string interpolation
 *
 * A template renders by walking `segments` and substituting a *locally resolved
 * label* for each parameter. Nothing from the wire is ever interpolated, the
 * wire supplies an id, this module supplies every character that reaches the
 * screen. Splitting the sentence this way also leaves the door open for
 * translation, where word order changes and a format string would not survive.
 *
 * ## Locations are a curated destination list, not `LocationId`
 *
 * The world has sixteen `LocationId`s, most of which are interiors, arcade
 * floors, or private rooms. Exposing them would let a phrase name somewhere a
 * player cannot meaningfully be met, and would leak the world's internal
 * structure into a sentence a child reads. So this module keeps its own list of
 * six public destinations and maps each to a canonical id, the same six the Map
 * modal offers, minus `home` (which is private, so "meet me at Home" is a
 * sentence with no true reading) and plus the Arcade.
 *
 * Note what a template deliberately cannot say: a coordinate, a seat, a hiding
 * spot, a session address, or anything else presence happens to know. A phrase
 * names a place, at the granularity a map already shows publicly.
 */

import type { LocationId } from '@/lib/location-types';

/** The kinds of value a template hole can take. */
export type TemplateParamCatalogId = 'location' | 'time' | 'activity';

/** One allowed value: a protocol id plus the label it renders as. */
export interface TemplateParamValue {
  readonly id: string;
  readonly label: string;
}

/**
 * Public destinations a phrase may name.
 *
 * `location` is the canonical `LocationId` a value maps to, kept so a future
 * feature (a "take me there" action on a received phrase) has something real to
 * navigate to without re-deriving it from a label.
 */
export interface DestinationValue extends TemplateParamValue {
  readonly location: LocationId;
}

export const DESTINATION_VALUES: readonly DestinationValue[] = Object.freeze([
  { id: 'town', label: 'the Town', location: 'town' },
  { id: 'plaza', label: 'the Plaza', location: 'plaza' },
  { id: 'beach', label: 'the Beach', location: 'beach' },
  { id: 'mine', label: 'the Mine', location: 'mine' },
  { id: 'arcade', label: 'the Arcade', location: 'arcade' },
  { id: 'nostr-station', label: 'the Nostr Station', location: 'nostr-station' },
]);

/** Bounded waiting times. Four options, because a child picking from twelve picks none. */
export const TIME_VALUES: readonly TemplateParamValue[] = Object.freeze([
  { id: '5m', label: '5 minutes' },
  { id: '10m', label: '10 minutes' },
  { id: '15m', label: '15 minutes' },
  { id: '30m', label: '30 minutes' },
]);

/**
 * Things there is actually something to play.
 *
 * Every entry corresponds to a real activity in the world, the three arcade
 * cabinets, the beach hunt, the mine, and hiding in the Town bushes, so an
 * invitation is never to something that does not exist.
 */
export const ACTIVITY_VALUES: readonly TemplateParamValue[] = Object.freeze([
  { id: 'dance', label: 'Blobbi Dance' },
  { id: 'pool', label: 'Pool' },
  { id: 'air-hockey', label: 'Air Hockey' },
  { id: 'treasure-hunt', label: 'the Treasure Hunt' },
  { id: 'mining', label: 'Mining' },
  { id: 'hide-and-seek', label: 'Hide and Seek' },
]);

const PARAM_CATALOGS: Readonly<Record<TemplateParamCatalogId, readonly TemplateParamValue[]>> =
  Object.freeze({
    location: DESTINATION_VALUES,
    time: TIME_VALUES,
    activity: ACTIVITY_VALUES,
  });

/** Every allowed value for a catalog, for the picker and for validation. */
export function templateParamValues(
  catalog: TemplateParamCatalogId,
): readonly TemplateParamValue[] {
  return PARAM_CATALOGS[catalog] ?? [];
}

/** The value with this id in this catalog, or `null`. */
export function templateParamValueById(
  catalog: TemplateParamCatalogId,
  id: string,
): TemplateParamValue | null {
  return templateParamValues(catalog).find((value) => value.id === id) ?? null;
}

/** One hole in a template. */
export interface TemplateParam {
  /** The key used in the wire `params` object. */
  readonly name: string;
  readonly catalog: TemplateParamCatalogId;
  /** Shown above the picker, e.g. "Where". */
  readonly prompt: string;
}

/** A literal fragment, or a reference to one of the template's parameters. */
export type TemplateSegment = string | { readonly param: string };

export interface PhraseTemplate {
  /** Stable, language-independent protocol id. */
  readonly id: string;
  /** Short label for the builder's template picker. */
  readonly label: string;
  readonly params: readonly TemplateParam[];
  /** The sentence, as literals and holes. Every hole must name a declared param. */
  readonly segments: readonly TemplateSegment[];
}

export const PHRASE_TEMPLATES: readonly PhraseTemplate[] = Object.freeze([
  {
    id: 'going-to',
    label: "I'm going to…",
    params: [{ name: 'location', catalog: 'location', prompt: 'Where' }],
    segments: ["I'm going to ", { param: 'location' }, '.'],
  },
  {
    id: 'meet-at',
    label: "Let's meet at…",
    params: [{ name: 'location', catalog: 'location', prompt: 'Where' }],
    segments: ["Let's meet at ", { param: 'location' }, '.'],
  },
  {
    id: 'meet-at-in',
    label: 'Meet me at… in…',
    params: [
      { name: 'location', catalog: 'location', prompt: 'Where' },
      { name: 'time', catalog: 'time', prompt: 'When' },
    ],
    segments: ['Meet me at ', { param: 'location' }, ' in ', { param: 'time' }, '.'],
  },
  {
    id: 'want-to-play',
    label: 'Want to play…?',
    params: [{ name: 'activity', catalog: 'activity', prompt: 'What' }],
    segments: ['Want to play ', { param: 'activity' }, '?'],
  },
  {
    id: 'back-in',
    label: "I'll be back in…",
    params: [{ name: 'time', catalog: 'time', prompt: 'When' }],
    segments: ["I'll be back in ", { param: 'time' }, '.'],
  },
]);

const BY_ID: ReadonlyMap<string, PhraseTemplate> = new Map(
  PHRASE_TEMPLATES.map((template) => [template.id, template]),
);

/** The template with this id, or `null` when the local registry does not know it. */
export function phraseTemplateById(id: string): PhraseTemplate | null {
  return BY_ID.get(id) ?? null;
}

/** Whether the local registry knows this id. */
export function isKnownPhraseTemplate(id: string): boolean {
  return BY_ID.has(id);
}
