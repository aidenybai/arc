// Volt server: accept loop, HTTP fallback, WebSocket upgrade, namespaces,
// rooms and broadcast — the Socket.IO server model on the arc runtime.

import { EventEmitter } from "./events.js";
import { readRequest, writeResponse, isUpgrade, acceptUpgrade } from "./http.js";
import type { HttpRequest, HttpResponse } from "./http.js";
import { WsConnection } from "./ws.js";
import { PacketType, encodePacket, decodePacket } from "./parser.js";
import type { Packet } from "./parser.js";
import { Socket } from "./socket.js";
import type { Handshake } from "./socket.js";

export type Middleware = (socket: Socket, next: (err?: any) => void) => void;
export type HttpHandler = (request: HttpRequest) => HttpResponse | Promise<HttpResponse>;

// One physical WebSocket connection. Sockets from several namespaces can
// share it; the Client routes packets between the wire and those sockets.
class Client {
  ws: WsConnection;
  sockets = new Map();

  constructor(ws: WsConnection) {
    this.ws = ws;
  }

  send(packet: Packet): void {
    this.ws.sendText(encodePacket(packet));
  }

  close(): void {
    this.ws.close();
  }
}

export class BroadcastOperator {
  #nsp: Namespace;
  #rooms: string[];
  #except: string[];

  constructor(nsp: Namespace, rooms: string[], except: string[]) {
    this.#nsp = nsp;
    this.#rooms = rooms;
    this.#except = except;
  }

  to(room: string): BroadcastOperator {
    return new BroadcastOperator(this.#nsp, [...this.#rooms, room], this.#except);
  }

  in(room: string): BroadcastOperator {
    return this.to(room);
  }

  except(room: string): BroadcastOperator {
    return new BroadcastOperator(this.#nsp, this.#rooms, [...this.#except, room]);
  }

  // Matching sockets: in ALL listed rooms (no rooms = everyone), minus
  // exclusions (socket ids and room names both work).
  sockets(): Socket[] {
    const excluded = new Set(this.#except);
    const out: Socket[] = [];
    for (const socket of this.#nsp.allSockets()) {
      let match = true;
      for (const room of this.#rooms) {
        if (!socket.rooms.has(room)) match = false;
      }
      if (!match) continue;
      if (excluded.has(socket.id)) continue;
      let kicked = false;
      for (const room of excluded) {
        if (socket.rooms.has(room)) kicked = true;
      }
      if (kicked) continue;
      out.push(socket);
    }
    return out;
  }

  emit(event: string, ...args: any[]): boolean {
    for (const socket of this.sockets()) {
      socket.emit(event, ...args);
    }
    return true;
  }

  disconnectSockets(close: boolean = false): void {
    for (const socket of this.sockets()) {
      socket.disconnect(close);
    }
  }
}

export class Namespace extends EventEmitter {
  name: string;
  server: Server;
  #sockets = new Map();
  #rooms = new Map();
  #middleware: Middleware[] = [];

  constructor(server: Server, name: string) {
    super();
    this.server = server;
    this.name = name;
  }

  use(fn: Middleware): this {
    this.#middleware.push(fn);
    return this;
  }

  to(room: string): BroadcastOperator {
    return new BroadcastOperator(this, [room], []);
  }

  in(room: string): BroadcastOperator {
    return this.to(room);
  }

  except(room: string): BroadcastOperator {
    return new BroadcastOperator(this, [], [room]);
  }

  // Namespace-wide emit broadcasts to every connected socket.
  emit(event: string, ...args: any[]): boolean {
    return new BroadcastOperator(this, [], []).emit(event, ...args);
  }

  fetchSockets(): Socket[] {
    return this.allSockets();
  }

  get socketCount(): number {
    return this.#sockets.size;
  }

  // -- internal plumbing --

  allSockets(): Socket[] {
    const out: Socket[] = [];
    for (const socket of this.#sockets.values()) out.push(socket);
    return out;
  }

  broadcastOperator(rooms: string[], except: string[]): BroadcastOperator {
    return new BroadcastOperator(this, rooms, except);
  }

  addToRoom(room: string, socket: Socket): void {
    let members = this.#rooms.get(room);
    if (!members) {
      members = new Set();
      this.#rooms.set(room, members);
    }
    members.add(socket);
  }

  removeFromRoom(room: string, socket: Socket): void {
    const members = this.#rooms.get(room);
    if (members) {
      members.delete(socket);
      if (members.size === 0) this.#rooms.delete(room);
    }
  }

  removeSocket(socket: Socket): void {
    this.#sockets.delete(socket.id);
    socket.client.sockets.delete(this.name);
  }

  // Run middleware then attach the socket and fire "connection".
  async addClient(client: Client, handshake: Handshake, auth: any): Promise<void> {
    const socket = new Socket(this, client, handshake, auth);
    let index = 0;
    const run = (err?: any): void => {
      if (err) {
        client.send({
          t: PacketType.CONNECT_ERROR,
          nsp: this.name,
          data: { message: err && err.message ? err.message : String(err) },
        });
        return;
      }
      if (index >= this.#middleware.length) {
        this.#sockets.set(socket.id, socket);
        client.sockets.set(this.name, socket);
        client.send({
          t: PacketType.CONNECT,
          nsp: this.name,
          data: { sid: socket.id },
        });
        super.emit("connection", socket);
        return;
      }
      const fn = this.#middleware[index];
      index += 1;
      fn(socket, run);
    };
    run();
  }
}

export interface ServerOptions {
  path?: string;
}

export class Server extends EventEmitter {
  #namespaces = new Map();
  #httpHandler: HttpHandler | null = null;
  #listener: any = null;
  path: string;
  port: number | null = null;

  constructor(options: ServerOptions = {}) {
    super();
    this.path = options.path ?? "/volt";
    this.of("/");
  }

  // Namespace accessor: io.of("/admin"). Created on first use.
  of(name: string): Namespace {
    let nsp = this.#namespaces.get(name);
    if (!nsp) {
      nsp = new Namespace(this, name);
      this.#namespaces.set(name, nsp);
    }
    return nsp;
  }

  // Main-namespace conveniences, mirroring socket.io's API surface.
  on(event: string, fn: (...args: any[]) => void): this {
    if (event === "connection" || event === "connect") {
      this.of("/").on("connection", fn);
      return this;
    }
    super.on(event, fn);
    return this;
  }

  use(fn: Middleware): this {
    this.of("/").use(fn);
    return this;
  }

  to(room: string): BroadcastOperator {
    return this.of("/").to(room);
  }

  except(room: string): BroadcastOperator {
    return this.of("/").except(room);
  }

  emit(event: string, ...args: any[]): boolean {
    return this.of("/").emit(event, ...args);
  }

  // Serve plain HTTP requests (anything that isn't a Volt upgrade) with a
  // user handler; without one, non-upgrade requests get 404.
  http(handler: HttpHandler): this {
    this.#httpHandler = handler;
    return this;
  }

  // Bind and start the accept loop. Resolves with the bound port (handy
  // with port 0).
  async listen(port: number): Promise<number> {
    this.#listener = Arc.listen(port);
    this.port = await Arc.listenerPort(this.#listener);
    this.#acceptLoop();
    return this.port;
  }

  close(): void {
    if (this.#listener) Arc.close(this.#listener);
    for (const nsp of this.#namespaces.values()) {
      for (const socket of nsp.allSockets()) {
        socket.disconnect(true);
      }
    }
  }

  async #acceptLoop(): Promise<void> {
    while (true) {
      const conn = await Arc.accept(this.#listener);
      if (conn === null) return;
      this.#handleConnection(conn);
    }
  }

  async #handleConnection(conn: any): Promise<void> {
    const result = await readRequest(conn, "");
    if (!result) {
      Arc.close(conn);
      return;
    }
    const { request, rest } = result;

    if (isUpgrade(request) && request.path === this.path) {
      const ok = await acceptUpgrade(conn, request);
      if (!ok) {
        Arc.close(conn);
        return;
      }
      const ws = new WsConnection(conn, { mask: false, initial: rest });
      await this.#serveClient(ws, request, conn);
      return;
    }

    if (this.#httpHandler) {
      const response = await this.#httpHandler(request);
      await writeResponse(conn, response);
    } else {
      await writeResponse(conn, { status: 404, body: "not found" });
    }
    Arc.close(conn);
  }

  async #serveClient(ws: WsConnection, request: HttpRequest, conn: any): Promise<void> {
    const address = await Arc.peerName(conn);
    const query: Record<string, string> = {};
    for (const pair of request.query.split("&")) {
      if (!pair) continue;
      const eq = pair.indexOf("=");
      if (eq === -1) query[pair] = "";
      else query[pair.slice(0, eq)] = decodeURIComponent(pair.slice(eq + 1));
    }
    const handshake: Handshake = {
      address,
      url: request.path,
      query,
      headers: request.headers,
      issued: Date.now(),
      auth: null,
    };

    const client = new Client(ws);
    while (true) {
      const message = await ws.readMessage();
      if (message === null) break;
      if (message.type !== "text") continue;
      const packet = decodePacket(message.data);
      if (!packet) continue;

      if (packet.t === PacketType.CONNECT) {
        const nsp = this.#namespaces.get(packet.nsp);
        if (!nsp) {
          client.send({
            t: PacketType.CONNECT_ERROR,
            nsp: packet.nsp,
            data: { message: "Invalid namespace" },
          });
          continue;
        }
        await nsp.addClient(client, handshake, packet.data ?? null);
        continue;
      }

      const socket = client.sockets.get(packet.nsp);
      if (socket) socket.handlePacket(packet);
    }

    for (const socket of client.sockets.values()) {
      socket.handleClose("transport close");
    }
  }
}
