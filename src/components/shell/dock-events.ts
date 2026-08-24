/** Custom DOM events the world (PlayingView) listens for from the shell dock. */
export const DOCK_EVENTS = {
  focusChat: "blobbi:focus-chat",
  openMyBlobbi: "blobbi:open-my-blobbi",
  sendChat: "blobbi:send-chat",
  /**
   * Broadcast that the local Blobbi has started walking toward a target (e.g.
   * walking to a door before a location change). MultiplayerLayer forwards this
   * to the presence `moveTo` so REMOTE clients animate the walk-to-door instead
   * of the Blobbi vanishing instantly when the location switches.
   */
  presenceMove: "blobbi:presence-move",
} as const;

/** Detail payload for the {@link DOCK_EVENTS.sendChat} event. */
export interface SendChatDetail {
  text: string;
}

/** Detail payload for the {@link DOCK_EVENTS.presenceMove} event. */
export interface PresenceMoveDetail {
  /** World-percent target the local Blobbi is walking toward. */
  target: { x: number; y: number };
}
