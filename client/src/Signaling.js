import { io } from "socket.io-client";

export const SIGNALING_URL =
  import.meta.env.VITE_SIGNALING_URL || "http://localhost:5000";

export function initSignaling() {
  return io(SIGNALING_URL);
}

