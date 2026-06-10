// Server-side Socket: one connected client on one namespace.

import { EventEmitter } from "./events.js";
import { PacketType, encodePacket } from "./parser.js";
import type { Packet } from "./parser.js";

export interface Handshake {
  address: string;
  url: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  issued: number;
  auth: any;
}

let nextSocketId = 0;

export function generateId(): string {
  nextSocketId += 1;
  return (
    nextSocketId.toString(36) +
    "." +
    Math.floor(Math.random() * 0x7fffffff).toString(36)
  );
}

export class Socket extends EventEmitter {
  id: string;
  nsp: any; // Namespace
  client: any; // Client (shared transport)
  handshake: Handshake;
  rooms: Set<string>;
  data: any;
  connected: boolean;
  #acks = new Map();
  #nextAckId = 0;

  constructor(nsp: any, client: any, handshake: Handshake, auth: any) {
    super();
    this.id = generateId();
    this.nsp = nsp;
    this.client = client;
    this.handshake = { ...handshake, auth };
    this.rooms = new Set([this.id]);
    this.data = {};
    this.connected = true;
  }

  // emit("event", ...args) sends an EVENT packet. When the last argument is
  // a function it becomes an acknowledgement callback, invoked with the
  // client's response.
  emit(event: string, ...args: any[]): boolean {
    if (RESERVED_EVENTS.has(event)) {
      throw new Error('volt: "' + event + '" is a reserved event name');
    }
    const packet: Packet = { t: PacketType.EVENT, nsp: this.nsp.name };
    if (args.length > 0 && typeof args[args.length - 1] === "function") {
      const ack = args.pop();
      this.#nextAckId += 1;
      packet.id = this.#nextAckId;
      this.#acks.set(packet.id, ack);
    }
    packet.data = [event, ...args];
    this.client.send(packet);
    return true;
  }

  // Promise-flavored emit: resolves with the client's ack response.
  emitWithAck(event: string, ...args: any[]): Promise<any> {
    return new Promise((resolve) => {
      this.emit(event, ...args, (...response: any[]) => {
        resolve(response.length > 1 ? response : response[0]);
      });
    });
  }

  join(room: string): void {
    this.rooms.add(room);
    this.nsp.addToRoom(room, this);
  }

  leave(room: string): void {
    this.rooms.delete(room);
    this.nsp.removeFromRoom(room, this);
  }

  // Chainable broadcast scoping: socket.to("room").emit(...) reaches the
  // room's members except this socket.
  to(room: string): any {
    return this.nsp.broadcastOperator([room], [this.id]);
  }

  in(room: string): any {
    return this.to(room);
  }

  except(room: string): any {
    return this.nsp.broadcastOperator([], [this.id, room]);
  }

  get broadcast(): any {
    return this.nsp.broadcastOperator([], [this.id]);
  }

  send(...args: any[]): boolean {
    return this.emit("message", ...args);
  }

  disconnect(close: boolean = false): this {
    if (!this.connected) return this;
    this.client.send({ t: PacketType.DISCONNECT, nsp: this.nsp.name });
    this.#onclose("server namespace disconnect");
    if (close) this.client.close();
    return this;
  }

  // -- internal plumbing (called by Namespace/Client) --

  handlePacket(packet: Packet): void {
    if (packet.t === PacketType.EVENT) {
      const data = Array.isArray(packet.data) ? packet.data.slice() : [];
      const event = data.shift();
      if (typeof event !== "string") return;
      if (packet.id !== undefined) {
        const id = packet.id;
        let acked = false;
        data.push((...response: any[]) => {
          if (acked) return;
          acked = true;
          this.client.send({
            t: PacketType.ACK,
            nsp: this.nsp.name,
            id,
            data: response,
          });
        });
      }
      super.emit(event, ...data);
      return;
    }
    if (packet.t === PacketType.ACK) {
      const ack = this.#acks.get(packet.id);
      if (ack) {
        this.#acks.delete(packet.id);
        ack(...(Array.isArray(packet.data) ? packet.data : []));
      }
      return;
    }
    if (packet.t === PacketType.DISCONNECT) {
      this.#onclose("client namespace disconnect");
    }
  }

  handleClose(reason: string): void {
    this.#onclose(reason);
  }

  #onclose(reason: string): void {
    if (!this.connected) return;
    this.connected = false;
    super.emit("disconnecting", reason);
    for (const room of this.rooms) {
      this.nsp.removeFromRoom(room, this);
    }
    this.rooms.clear();
    this.nsp.removeSocket(this);
    super.emit("disconnect", reason);
  }
}

const RESERVED_EVENTS = new Set([
  "connect",
  "connect_error",
  "disconnect",
  "disconnecting",
  "newListener",
  "removeListener",
]);
