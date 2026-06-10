// Volt client: connects to a Volt server over WebSocket. Used by the test
// suite and by arc programs that talk to other Volt servers.

import { EventEmitter } from "./events.js";
import { wsConnect } from "./ws.js";
import type { WsConnection } from "./ws.js";
import { PacketType, encodePacket, decodePacket } from "./parser.js";
import type { Packet } from "./parser.js";

export interface ClientOptions {
  path?: string;
  auth?: any;
}

export class ClientSocket extends EventEmitter {
  id: string | null = null;
  nsp: string;
  connected: boolean = false;
  #ws: WsConnection;
  #acks = new Map();
  #nextAckId = 0;

  constructor(ws: WsConnection, nsp: string) {
    super();
    this.#ws = ws;
    this.nsp = nsp;
  }

  emit(event: string, ...args: any[]): boolean {
    const packet: Packet = { t: PacketType.EVENT, nsp: this.nsp };
    if (args.length > 0 && typeof args[args.length - 1] === "function") {
      const ack = args.pop();
      this.#nextAckId += 1;
      packet.id = this.#nextAckId;
      this.#acks.set(packet.id, ack);
    }
    packet.data = [event, ...args];
    this.#ws.sendText(encodePacket(packet));
    return true;
  }

  emitWithAck(event: string, ...args: any[]): Promise<any> {
    return new Promise((resolve) => {
      this.emit(event, ...args, (...response: any[]) => {
        resolve(response.length > 1 ? response : response[0]);
      });
    });
  }

  send(...args: any[]): boolean {
    return this.emit("message", ...args);
  }

  disconnect(): void {
    this.#ws.sendText(encodePacket({ t: PacketType.DISCONNECT, nsp: this.nsp }));
    this.#ws.close();
  }

  // -- internal plumbing --

  handlePacket(packet: Packet): void {
    if (packet.t === PacketType.CONNECT) {
      this.id = packet.data && packet.data.sid ? packet.data.sid : null;
      this.connected = true;
      super.emit("connect");
      return;
    }
    if (packet.t === PacketType.CONNECT_ERROR) {
      super.emit("connect_error", packet.data);
      return;
    }
    if (packet.t === PacketType.EVENT) {
      const data = Array.isArray(packet.data) ? packet.data.slice() : [];
      const event = data.shift();
      if (typeof event !== "string") return;
      if (packet.id !== undefined) {
        const id = packet.id;
        data.push((...response: any[]) => {
          this.#ws.sendText(
            encodePacket({ t: PacketType.ACK, nsp: this.nsp, id, data: response }),
          );
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
      this.handleClose("io server disconnect");
    }
  }

  handleClose(reason: string): void {
    if (!this.connected) return;
    this.connected = false;
    super.emit("disconnect", reason);
  }
}

// connect("ws://host:port/nsp") — open a transport and join a namespace.
// Resolves once the server acknowledges the CONNECT packet.
export async function connect(
  url: string,
  options: ClientOptions = {},
): Promise<ClientSocket> {
  const parsed = parseUrl(url);
  const path = options.path ?? "/volt";
  const ws = await wsConnect(parsed.host, parsed.port, path);
  const socket = new ClientSocket(ws, parsed.nsp);

  const readLoop = async (): Promise<void> => {
    while (true) {
      const message = await ws.readMessage();
      if (message === null) {
        socket.handleClose("transport close");
        return;
      }
      if (message.type !== "text") continue;
      const packet = decodePacket(message.data);
      if (packet && packet.nsp === parsed.nsp) socket.handlePacket(packet);
    }
  };
  readLoop();

  ws.sendText(
    encodePacket({
      t: PacketType.CONNECT,
      nsp: parsed.nsp,
      data: options.auth ?? null,
    }),
  );

  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", (err: any) => {
      ws.close();
      reject(new Error(err && err.message ? err.message : "connect error"));
    });
  });
}

function parseUrl(url: string): { host: string; port: number; nsp: string } {
  let rest = url;
  const schemeEnd = rest.indexOf("://");
  if (schemeEnd !== -1) rest = rest.slice(schemeEnd + 3);
  let nsp = "/";
  const slash = rest.indexOf("/");
  if (slash !== -1) {
    nsp = rest.slice(slash);
    rest = rest.slice(0, slash);
  }
  const colon = rest.indexOf(":");
  const host = colon === -1 ? rest : rest.slice(0, colon);
  const port = colon === -1 ? 80 : parseInt(rest.slice(colon + 1), 10);
  return { host: host || "127.0.0.1", port, nsp };
}
