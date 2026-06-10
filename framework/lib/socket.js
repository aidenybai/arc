// Server-side Socket: one connected client on one namespace.

import { EventEmitter } from "./events.js";
import { PacketType, encodePacket } from "./parser.js";
      

   
   
   
    
    
   
   


let nextSocketId = 0;

export function generateId()  {
  nextSocketId += 1;
  return (
    nextSocketId.toString(36) +
    "." +
    Math.floor(Math.random() * 0x7fffffff).toString(36)
  );
}

export class Socket extends EventEmitter {
  id ;
  nsp ; // Namespace
  client ; // Client (shared transport)
  handshake ;
  rooms ;
  data ;
  connected ;
  #acks = new Map();
  #nextAckId = 0;

  constructor(nsp , client , handshake , auth ) {
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
  emit(event , ...args )  {
    if (RESERVED_EVENTS.has(event)) {
      throw new Error('volt: "' + event + '" is a reserved event name');
    }
    const packet  = { t: PacketType.EVENT, nsp: this.nsp.name };
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
  emitWithAck(event , ...args )  {
    return new Promise((resolve) => {
      this.emit(event, ...args, (...response ) => {
        resolve(response.length > 1 ? response : response[0]);
      });
    });
  }

  join(room )  {
    this.rooms.add(room);
    this.nsp.addToRoom(room, this);
  }

  leave(room )  {
    this.rooms.delete(room);
    this.nsp.removeFromRoom(room, this);
  }

  // Chainable broadcast scoping: socket.to("room").emit(...) reaches the
  // room's members except this socket.
  to(room )  {
    return this.nsp.broadcastOperator([room], [this.id]);
  }

  in(room )  {
    return this.to(room);
  }

  except(room )  {
    return this.nsp.broadcastOperator([], [this.id, room]);
  }

  get broadcast()  {
    return this.nsp.broadcastOperator([], [this.id]);
  }

  send(...args )  {
    return this.emit("message", ...args);
  }

  disconnect(close  = false)  {
    if (!this.connected) return this;
    this.client.send({ t: PacketType.DISCONNECT, nsp: this.nsp.name });
    this.#onclose("server namespace disconnect");
    if (close) this.client.close();
    return this;
  }

  // -- internal plumbing (called by Namespace/Client) --

  handlePacket(packet )  {
    if (packet.t === PacketType.EVENT) {
      const data = Array.isArray(packet.data) ? packet.data.slice() : [];
      const event = data.shift();
      if (typeof event !== "string") return;
      if (packet.id !== undefined) {
        const id = packet.id;
        let acked = false;
        data.push((...response ) => {
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

  handleClose(reason )  {
    this.#onclose(reason);
  }

  #onclose(reason )  {
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
