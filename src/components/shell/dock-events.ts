/** Custom DOM events the world (PlayingView) listens for from the shell dock. */
export const DOCK_EVENTS = {
  /**
   * Open the Communication panel (quick phrases, phrase builder, emotes and,
   * where the policy allows it, free text).
   *
   * Replaces the old `focus-chat` / `send-chat` pair. Sending no longer travels
   * through a DOM event at all: the panel is rendered by `PlayingView`, which
   * already holds the publisher, so the message goes straight to it as a typed
   * value instead of being flattened into a `CustomEvent` detail and re-parsed.
   */
  openCommunication: "blobbi:open-communication",
  openMyBlobbi: "blobbi:open-my-blobbi",
  /**
   * Broadcast that the local Blobbi has started walking toward a target (e.g.
   * walking to a door before a location change). MultiplayerLayer forwards this
   * to the presence `moveTo` so REMOTE clients animate the walk-to-door instead
   * of the Blobbi vanishing instantly when the location switches.
   */
  presenceMove: "blobbi:presence-move",
} as const;

/** Detail payload for the {@link DOCK_EVENTS.presenceMove} event. */
export interface PresenceMoveDetail {
  /** World-percent target the local Blobbi is walking toward. */
  target: { x: number; y: number };
}
