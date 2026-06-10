// Minimal HTTP/1.1 layer over Arc's TCP host functions.
//
// Enough to (a) answer plain requests via user handlers and (b) recognize
// WebSocket upgrade requests and complete the RFC 6455 handshake. Bodies
// and request heads use the byte-string bridge described in src/utf8.ts.

import { utf8Decode, utf8Encode } from "./utf8.js";

   
   
   
   
   
    
   


   
   
    
   


const STATUS_TEXT   = {
  101: "Switching Protocols",
  200: "OK",
  201: "Created",
  204: "No Content",
  301: "Moved Permanently",
  302: "Found",
  400: "Bad Request",
  404: "Not Found",
  405: "Method Not Allowed",
  426: "Upgrade Required",
  500: "Internal Server Error",
};

export function statusText(code )  {
  return STATUS_TEXT[code] || "Unknown";
}

// Read from `conn` until a full request head (+body, when Content-Length
// says so) is buffered. Returns the parsed request and any bytes that
// arrived after it, or null when the connection closes first.
export async function readRequest(
  conn ,
  initial ,
)         {
  let buffer = initial;
  while (buffer.indexOf("\r\n\r\n") === -1) {
    const chunk = await Arc.read(conn);
    if (chunk === null) return null;
    buffer += chunk;
    if (buffer.length > 65536) return null;
  }

  const headEnd = buffer.indexOf("\r\n\r\n");
  const head = buffer.slice(0, headEnd);
  let rest = buffer.slice(headEnd + 4);

  const lines = head.split("\r\n");
  const requestLine = lines[0].split(" ");
  if (requestLine.length < 3) return null;
  const method = requestLine[0];
  const target = requestLine[1];
  const httpVersion = requestLine[2];

  const headers   = {};
  for (let i = 1; i < lines.length; i++) {
    const sep = lines[i].indexOf(":");
    if (sep === -1) continue;
    const name = lines[i].slice(0, sep).trim().toLowerCase();
    const value = lines[i].slice(sep + 1).trim();
    headers[name] = value;
  }

  const qIndex = target.indexOf("?");
  const path = qIndex === -1 ? target : target.slice(0, qIndex);
  const query = qIndex === -1 ? "" : target.slice(qIndex + 1);

  let body = "";
  const contentLength = headers["content-length"];
  if (contentLength) {
    const wanted = parseInt(contentLength, 10);
    while (rest.length < wanted) {
      const chunk = await Arc.read(conn);
      if (chunk === null) return null;
      rest += chunk;
    }
    body = utf8Decode(rest.slice(0, wanted));
    rest = rest.slice(wanted);
  }

  return {
    request: { method, path, query, httpVersion, headers, body },
    rest,
  };
}

export async function writeResponse(
  conn ,
  response ,
)  {
  const status = response.status ?? 200;
  const body = utf8Encode(response.body ?? "");
  const headers   = {
    "content-type": "text/plain; charset=utf-8",
    connection: "close",
    ...(response.headers ?? {}),
  };
  headers["content-length"] = String(body.length);

  let head = "HTTP/1.1 " + status + " " + statusText(status) + "\r\n";
  for (const name of Object.keys(headers)) {
    head += name + ": " + headers[name] + "\r\n";
  }
  return Arc.write(conn, head + "\r\n" + body);
}

export function isUpgrade(request )  {
  const connection = (request.headers["connection"] || "").toLowerCase();
  const upgrade = (request.headers["upgrade"] || "").toLowerCase();
  return connection.indexOf("upgrade") !== -1 && upgrade === "websocket";
}

// Complete the server side of the RFC 6455 opening handshake.
export async function acceptUpgrade(
  conn ,
  request ,
)  {
  const key = request.headers["sec-websocket-key"];
  if (!key) {
    await writeResponse(conn, { status: 400, body: "missing websocket key" });
    return false;
  }
  const accept = Arc.wsAcceptKey(key);
  const head =
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "upgrade: websocket\r\n" +
    "connection: Upgrade\r\n" +
    "sec-websocket-accept: " +
    accept +
    "\r\n\r\n";
  return Arc.write(conn, head);
}
