/** Public WebSocket server URL. Only NEXT_PUBLIC_* is exposed to the browser. */
export const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4000";
