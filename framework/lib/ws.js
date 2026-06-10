// RFC 6455 WebSocket framing over Arc's TCP byte-string bridge.
//
// WsConnection wraps a TCP connection Pid after the HTTP upgrade and
// exposes message-level reads/writes: fragmentation is reassembled, pings
// are answered, masking is applied per the spec (clients mask, servers
// don't), and text payloads are UTF-8 decoded to JS strings.

import { utf8Decode, utf8Encode } from "./utf8.js";

export const OPCODE = {
  CONTINUATION: 0x0,
  TEXT: 0x1,
  BINARY: 0x2,
  CLOSE: 0x8,
  PING: 0x9,
  PONG: 0xa,
};

function encodeLength(len )  {
  if (len < 126) return String.fromCharCode(len);
  if (len < 65536) {
    return String.fromCharCode(126, (len >> 8) & 0xff, len & 0xff);
  }
  // Arc strings cap well below 2^32; high 4 bytes are always zero.
  return String.fromCharCode(
    127,
    0,
    0,
    0,
    0,
    (len >> 24) & 0xff,
    (len >> 16) & 0xff,
    (len >> 8) & 0xff,
    len & 0xff,
  );
}

export function encodeFrame(
  opcode ,
  payload ,
  mask ,
)  {
  let frame = String.fromCharCode(0x80 | opcode);
  const lenPart = encodeLength(payload.length);
  if (!mask) {
    frame += lenPart;
    return frame + payload;
  }
  frame += String.fromCharCode(lenPart.charCodeAt(0) | 0x80) + lenPart.slice(1);
  const key = [
    Math.floor(Math.random() * 256),
    Math.floor(Math.random() * 256),
    Math.floor(Math.random() * 256),
    Math.floor(Math.random() * 256),
  ];
  frame += String.fromCharCode(key[0], key[1], key[2], key[3]);
  let masked = "";
  for (let i = 0; i < payload.length; i++) {
    masked += String.fromCharCode(payload.charCodeAt(i) ^ key[i % 4]);
  }
  return frame + masked;
}

   
   
   
   


// Parse one frame from `buffer`. Returns the frame and the bytes consumed,
// or null when the buffer doesn't hold a complete frame yet.
export function decodeFrame(buffer )         {
  if (buffer.length < 2) return null;
  const b0 = buffer.charCodeAt(0);
  const b1 = buffer.charCodeAt(1);
  const fin = (b0 & 0x80) !== 0;
  const opcode = b0 & 0x0f;
  const masked = (b1 & 0x80) !== 0;
  let len = b1 & 0x7f;
  let offset = 2;
  if (len === 126) {
    if (buffer.length < 4) return null;
    len = (buffer.charCodeAt(2) << 8) | buffer.charCodeAt(3);
    offset = 4;
  } else if (len === 127) {
    if (buffer.length < 10) return null;
    len = 0;
    for (let i = 2; i < 10; i++) {
      len = len * 256 + buffer.charCodeAt(i);
    }
    offset = 10;
  }
  let key = null;
  if (masked) {
    if (buffer.length < offset + 4) return null;
    key = [
      buffer.charCodeAt(offset),
      buffer.charCodeAt(offset + 1),
      buffer.charCodeAt(offset + 2),
      buffer.charCodeAt(offset + 3),
    ];
    offset += 4;
  }
  if (buffer.length < offset + len) return null;
  let payload = buffer.slice(offset, offset + len);
  if (key) {
    let unmasked = "";
    for (let i = 0; i < payload.length; i++) {
      unmasked += String.fromCharCode(payload.charCodeAt(i) ^ key[i % 4]);
    }
    payload = unmasked;
  }
  return { frame: { fin, opcode, payload }, size: offset + len };
}

   
     
   


export class WsConnection {
  conn ;
  mask ;
  buffer ;
  closed ;

  constructor(conn , options       = {}) {
    this.conn = conn;
    this.mask = options.mask ?? false;
    this.buffer = options.initial ?? "";
    this.closed = false;
  }

  // Next complete message, transparently answering pings and handling
  // fragmentation. Returns null once the connection is closed.
  async readMessage()    {
    let assembling = "";
    let assemblingOp = 0;
    while (true) {
      const decoded = decodeFrame(this.buffer);
      if (!decoded) {
        if (this.closed) return null;
        const chunk = await Arc.read(this.conn);
        if (chunk === null) {
          this.closed = true;
          return null;
        }
        this.buffer += chunk;
        continue;
      }
      this.buffer = this.buffer.slice(decoded.size);
      const frame = decoded.frame;

      if (frame.opcode === OPCODE.PING) {
        await this.#send(OPCODE.PONG, frame.payload);
        continue;
      }
      if (frame.opcode === OPCODE.PONG) continue;
      if (frame.opcode === OPCODE.CLOSE) {
        if (!this.closed) {
          this.closed = true;
          await Arc.write(this.conn, encodeFrame(OPCODE.CLOSE, frame.payload, this.mask));
          Arc.close(this.conn);
        }
        return null;
      }

      if (frame.opcode === OPCODE.CONTINUATION) {
        assembling += frame.payload;
        if (!frame.fin) continue;
        const data = assembling;
        const op = assemblingOp;
        assembling = "";
        return op === OPCODE.TEXT
          ? { type: "text", data: utf8Decode(data) }
          : { type: "binary", data };
      }

      if (!frame.fin) {
        assembling = frame.payload;
        assemblingOp = frame.opcode;
        continue;
      }

      return frame.opcode === OPCODE.TEXT
        ? { type: "text", data: utf8Decode(frame.payload) }
        : { type: "binary", data: frame.payload };
    }
  }

  async #send(opcode , payload )  {
    if (this.closed) return false;
    return Arc.write(this.conn, encodeFrame(opcode, payload, this.mask));
  }

  // Send a text message (JS string, UTF-8 encoded on the wire).
  async sendText(data )  {
    return this.#send(OPCODE.TEXT, utf8Encode(data));
  }

  // Send a binary message (byte string, sent verbatim).
  async sendBinary(data )  {
    return this.#send(OPCODE.BINARY, data);
  }

  async close(code  = 1000)  {
    if (this.closed) return;
    this.closed = true;
    const payload = String.fromCharCode((code >> 8) & 0xff, code & 0xff);
    await Arc.write(this.conn, encodeFrame(OPCODE.CLOSE, payload, this.mask));
    Arc.close(this.conn);
  }
}

// Client side of the RFC 6455 opening handshake; resolves to a masked
// WsConnection ready for traffic.
export async function wsConnect(
  host ,
  port ,
  path ,
)  {
  const conn = await Arc.connect(host, port);
  let key = "";
  for (let i = 0; i < 16; i++) {
    key += String.fromCharCode(Math.floor(Math.random() * 256));
  }
  const encoded = base64(key);
  const head =
    "GET " + path + " HTTP/1.1\r\n" +
    "host: " + host + ":" + port + "\r\n" +
    "upgrade: websocket\r\n" +
    "connection: Upgrade\r\n" +
    "sec-websocket-key: " + encoded + "\r\n" +
    "sec-websocket-version: 13\r\n\r\n";
  const ok = await Arc.write(conn, head);
  if (!ok) throw new Error("volt: websocket handshake write failed");

  let buffer = "";
  while (buffer.indexOf("\r\n\r\n") === -1) {
    const chunk = await Arc.read(conn);
    if (chunk === null) throw new Error("volt: connection closed during handshake");
    buffer += chunk;
  }
  const headEnd = buffer.indexOf("\r\n\r\n");
  const response = buffer.slice(0, headEnd);
  if (response.indexOf(" 101 ") === -1) {
    Arc.close(conn);
    throw new Error("volt: server refused websocket upgrade");
  }
  const expected = Arc.wsAcceptKey(encoded);
  if (response.toLowerCase().indexOf(expected.toLowerCase()) === -1) {
    Arc.close(conn);
    throw new Error("volt: bad sec-websocket-accept");
  }
  return new WsConnection(conn, { mask: true, initial: buffer.slice(headEnd + 4) });
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64(bytes )  {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes.charCodeAt(i);
    const b1 = i + 1 < bytes.length ? bytes.charCodeAt(i + 1) : 0;
    const b2 = i + 2 < bytes.length ? bytes.charCodeAt(i + 2) : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < bytes.length ? B64[b2 & 63] : "=";
  }
  return out;
}
