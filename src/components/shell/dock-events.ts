/** Custom DOM events the world (PlayingView) listens for from the shell dock. */
export const DOCK_EVENTS = {
  focusChat: "blobbi:focus-chat",
  openMyBlobbi: "blobbi:open-my-blobbi",
  sendChat: "blobbi:send-chat",
} as const;

/** Detail payload for the {@link DOCK_EVENTS.sendChat} event. */
export interface SendChatDetail {
  text: string;
}
