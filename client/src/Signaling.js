import { io } from "socket.io-client";

export function initSignaling() {
  const socket = io("http://localhost:5000");

  return socket;
}
