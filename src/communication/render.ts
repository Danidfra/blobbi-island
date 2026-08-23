/**
 * Trusted reconstruction: turning a validated message into the words and
 * pictures a player actually sees.
 *
 * ## The rule
 *
 * For a structured message the sender supplies **ids and nothing else**, and
 * every character on screen comes from this build's own catalogs. Two
 * consequences follow, and both are the point:
 *
 *  - a hostile client cannot put words in another player's bubble, because
 *    there is no path from a payload field to rendered text;
 *  - the same event renders in whatever language the reader's build speaks,
 *    because the payload never contained a language in the first place.
 *
 * Free text is the exception, necessarily: it *is* the words. That asymmetry is
 * exactly what the `freeTextChat` capability governs, and it is why a profile
 * that refuses free text can still allow everything in this file.
 *
 * ## The presentation model is not the wire model
 *
 * Components receive a {@link CommunicationBubble}: resolved, safe, ready to
 * paint. They never see `IslandMessage`, never see the envelope, and never see
 * the event. A component cannot mis-handle a payload it was never given.
 */

import { emoteById } from './emotes';
import type { IslandMessage } from './message';
import { quickPhraseById } from './quick-phrases';
import { phraseTemplateById, templateParamValueById, type PhraseTemplate } from './templates';

/**
 * What the bubble layer paints.
 *
 * `text` and `phrase` carry the same payload shape but stay separate classes: a
 * phrase is locally reconstructed and a text is not, and a future surface may
 * well want to present that difference (a phrase could offer "reply with the
 * same phrase"; free text could not).
 */
export type CommunicationBubble =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'phrase'; readonly text: string }
  | {
      readonly type: 'emote';
      readonly emote: string;
      readonly glyph: string;
      /** Accessible name — an emote bubble is unreadable without it. */
      readonly label: string;
    };

/**
 * Render a template from its declared segments and a set of value ids.
 *
 * Returns `null` when anything is unresolvable, so a caller cannot accidentally
 * paint a half-built sentence with a hole in it. Note that no value from
 * `params` is ever placed on screen — only the LABEL this build holds for that
 * id.
 *
 * Exported because the phrase builder previews the same sentence it is about to
 * send, and a preview built by different code from the one the receiver renders
 * is a preview that can lie.
 */
export function renderTemplateText(
  template: PhraseTemplate,
  params: Readonly<Record<string, string>>,
): string | null {
  let out = '';
  for (const segment of template.segments) {
    if (typeof segment === 'string') {
      out += segment;
      continue;
    }
    const declared = template.params.find((param) => param.name === segment.param);
    if (!declared) return null;
    const id = params[declared.name];
    if (typeof id !== 'string') return null;
    const value = templateParamValueById(declared.catalog, id);
    if (!value) return null;
    out += value.label;
  }
  return out;
}

/**
 * The presentation form of a validated message, or `null` when this build
 * cannot render it.
 *
 * `null` is not an error path. A message referencing a catalog entry this build
 * does not have — an older client meeting a newer phrase — is simply not shown,
 * which is the same outcome as never having received it.
 */
export function renderMessage(message: IslandMessage): CommunicationBubble | null {
  switch (message.type) {
    case 'text': {
      const text = message.text.trim();
      return text ? { type: 'text', text } : null;
    }

    case 'quick': {
      const phrase = quickPhraseById(message.phrase);
      return phrase ? { type: 'phrase', text: phrase.text } : null;
    }

    case 'template': {
      const template = phraseTemplateById(message.template);
      if (!template) return null;
      const text = renderTemplateText(template, message.params);
      return text ? { type: 'phrase', text } : null;
    }

    case 'emote': {
      const emote = emoteById(message.emote);
      return emote
        ? { type: 'emote', emote: emote.id, glyph: emote.glyph, label: emote.label }
        : null;
    }

    default:
      return null;
  }
}

/**
 * The text equivalent of a bubble.
 *
 * One place that answers "what does this message say in words", for screen
 * readers, for `aria-label`s, and for the optimistic local echo. An emote's
 * label is its text: a bare glyph is not a message anyone can read aloud.
 */
export function bubbleTextEquivalent(bubble: CommunicationBubble): string {
  return bubble.type === 'emote' ? bubble.label : bubble.text;
}
