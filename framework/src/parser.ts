// Volt packet protocol.
//
// Packets travel as WebSocket text messages carrying JSON, in the spirit of
// Socket.IO's protocol (CONNECT/EVENT/ACK/...) but not wire-compatible
// with it. Shape:
//
//   { "t": <PacketType>, "nsp": "/", "id": 3, "data": [...] }
//
// `id` is present only on EVENT packets expecting an ACK and on the ACK
// itself. `data` is `[eventName, ...args]` for EVENT, `[...args]` for ACK,
// and an arbitrary JSON value for CONNECT / CONNECT_ERROR.

export const PacketType = {
  CONNECT: 0,
  DISCONNECT: 1,
  EVENT: 2,
  ACK: 3,
  CONNECT_ERROR: 4,
};

export interface Packet {
  t: number;
  nsp: string;
  id?: number;
  data?: any;
}

export function encodePacket(packet: Packet): string {
  return JSON.stringify(packet);
}

export function decodePacket(raw: string): Packet | null {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  if (typeof parsed.t !== "number") return null;
  if (typeof parsed.nsp !== "string") return null;
  return parsed as Packet;
}
