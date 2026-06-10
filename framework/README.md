# Volt

Volt is a Socket.IO-style realtime framework that runs on the Arc runtime. You write TypeScript, Volt strips the types at build time with its own tooling (which also runs on Arc), and the result runs as plain JavaScript on `gleam run`. It gives you WebSocket servers and clients with events, acknowledgements, rooms, namespaces, middleware, and an HTTP fallback, with no dependency on Node.js.

## Contents

- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [Writing a web server](#writing-a-web-server)
- [Events and acknowledgements](#events-and-acknowledgements)
- [Rooms and broadcasting](#rooms-and-broadcasting)
- [Namespaces](#namespaces)
- [Middleware and authentication](#middleware-and-authentication)
- [Serving HTTP](#serving-http)
- [Clients](#clients)
- [Running the tests](#running-the-tests)
- [Deploying to Railway](#deploying-to-railway)
- [TypeScript support](#typescript-support)
- [API reference](#api-reference)

## Quick start

Three commands take you from a clone to a running realtime server.

```sh
# 1. Build the framework and the examples (the build itself runs on Arc)
gleam run -- --event-loop framework/tools/build.js

# 2. Run the echo example: a server, a client, and an ack round trip
gleam run -- --event-loop framework/examples/dist/echo.js

# 3. Run the chat example: rooms, broadcasts, and auth middleware
gleam run -- --event-loop framework/examples/dist/chat.js
```

You should see output like:

```
listening on port 4000
server: 1.dmd3vl connected
client: echo: hello volt
```

## How it works

Volt is three layers, each written in TypeScript under `framework/src/` and compiled to `framework/lib/` by a type stripper that itself runs on Arc.

1. **Transport.** `Arc.listen` / `Arc.accept` / `Arc.read` / `Arc.write` are host functions backed by Erlang's `gen_tcp`. Each socket is an Erlang process; reads and writes settle promises through the runtime's event loop.
2. **Protocol.** `http.ts` parses HTTP/1.1 requests, `ws.ts` implements RFC 6455 WebSocket framing (masking, fragmentation, ping/pong, close handshake), and `parser.ts` encodes Volt packets as JSON.
3. **API.** `server.ts`, `socket.ts`, and `client.ts` implement the Socket.IO model: servers, namespaces, sockets, rooms, acknowledgements, and middleware.

The compiled output in `framework/lib/` is committed, so you can run everything without a build step. Rebuild after editing any `.ts` file.

## Writing a web server

A Volt server accepts WebSocket connections and answers plain HTTP requests on the same port. Create a `Server`, register a connection handler, and listen:

```ts
import { Server } from "../../lib/server.js";

const io = new Server();

io.on("connection", (socket) => {
  console.log(socket.id + " connected");

  socket.on("hello", (name) => {
    socket.emit("greeting", "hello " + name);
  });
});

io.http((req) => ({ status: 200, body: "Volt is running" }));

const port = await io.listen(3000);
```

Save this as `framework/examples/myserver.ts`, rebuild, and run:

```sh
gleam run -- --event-loop framework/tools/build.js
gleam run -- --event-loop framework/examples/dist/myserver.js
```

Passing `0` to `listen` picks a free port and returns it, which is what the test suite uses.

## Events and acknowledgements

Sockets are event emitters in both directions, and any emit can request an acknowledgement. Pass a function as the last argument to `emit`, or use `emitWithAck` to get a promise:

```ts
// server
io.on("connection", (socket) => {
  socket.on("question", (text, ack) => {
    ack("answer: " + text);
  });
});

// client
const client = await connect("ws://127.0.0.1:3000/");
const answer = await client.emitWithAck("question", "ping");
```

Arguments survive the round trip intact: strings, numbers, booleans, `null`, arrays, and plain objects all work, since packets are JSON.

The reserved event names `connect`, `connect_error`, `disconnect`, and `disconnecting` are emitted by the framework and cannot be sent manually.

## Rooms and broadcasting

Rooms group sockets so you can address many clients at once. A socket joins with `join`, leaves with `leave`, and every socket starts in a room named after its own id:

```ts
io.on("connection", (socket) => {
  socket.join("game-7");

  // To everyone in the room, including this socket
  io.to("game-7").emit("update", state);

  // To everyone in the room except this socket
  socket.to("game-7").emit("player-moved", move);

  // To every connected socket
  io.emit("announcement", "server restarting soon");

  // To every socket except this one
  socket.broadcast.emit("someone-connected", socket.id);
});
```

`to`, `in`, and `except` chain, so `io.to("a").except("b").emit(...)` reaches sockets in room `a` that are not in room `b`.

## Namespaces

Namespaces multiplex independent applications over one server. Clients pick a namespace through the URL path:

```ts
const chat = io.of("/chat");
chat.on("connection", (socket) => {
  socket.emit("welcome", "to chat");
});

// client side
const client = await connect("ws://127.0.0.1:3000/chat");
```

Events, rooms, and middleware are scoped per namespace. Connecting to a namespace the server never created rejects with "Invalid namespace".

## Middleware and authentication

Middleware runs before the `connection` event and can reject the socket. Clients send credentials in the `auth` option, which the server reads from `socket.handshake.auth`:

```ts
// server
io.use((socket, next) => {
  if (socket.handshake.auth.token === "s3cr3t") {
    next();
  } else {
    next(new Error("not authorized"));
  }
});

// client
const client = await connect("ws://127.0.0.1:3000/", {
  auth: { token: "s3cr3t" },
});
```

When middleware passes an error to `next`, the client's `connect` promise rejects with that message. `socket.handshake` also carries the remote `address`, the request `url`, parsed `query` parameters, and the request `headers`.

## Serving HTTP

The same port answers plain HTTP requests, which is where health checks and landing pages live. Register a handler with `io.http`; return a response object or a promise of one:

```ts
io.http((req) => {
  if (req.path === "/health") {
    return { status: 200, body: "ok" };
  }
  return {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    body: "<h1>hello</h1>",
  };
});
```

The request object exposes `method`, `path`, `query`, `headers`, and `body`. Requests to the WebSocket path (default `/volt`) upgrade instead of reaching this handler; everything else without a handler gets a 404.

## Clients

`connect` returns a promise that resolves once the server accepts the connection. The client socket mirrors the server API:

```ts
import { connect } from "../../lib/client.js";

const client = await connect("ws://127.0.0.1:3000/", {
  auth: { name: "ada" },
});

client.on("message", (from, text) => console.log(from + ": " + text));
client.emit("message", "general", "hello");
const reply = await client.emitWithAck("question", "ping");
client.disconnect();
```

Volt clients run on Arc, so a single process can host a server and many clients, which keeps tests and simulations in one file.

## Running the tests

The test suite covers connections, acks, rooms, broadcasts, namespaces, middleware, disconnects, the HTTP fallback, the packet parser, UTF-8, and WebSocket framing, in the style of the socket.io server tests. Run it directly:

```sh
gleam run -- --event-loop framework/tools/build.js
gleam run -- --event-loop framework/test/dist/index.js
```

The suite is also wired into the engine's own tests through `test/framework_test.gleam`, so `gleam test` runs it too.

## Deploying to Railway

The repository ships a `Dockerfile` and `railway.toml` that build the runtime and start `framework/examples/server.ts`, a long-running server with a `/health` endpoint that reads the port from the `PORT` environment variable.

1. Install the [Railway CLI](https://docs.railway.com/guides/cli) and log in:

   ```sh
   npm install -g @railway/cli
   railway login
   ```

2. From the repository root, create a project and deploy:

   ```sh
   railway init
   railway up
   ```

   Railway detects the `Dockerfile`, builds the image, and starts the server. The `railway.toml` sets `/health` as the health check path.

3. Generate a public domain:

   ```sh
   railway domain
   ```

   Clients then connect to `wss://your-app.up.railway.app/`.

To deploy your own server instead of the example, edit the `CMD` line in the `Dockerfile` to point at your built entry file, for example `framework/examples/dist/myserver.js`.

You can also skip the CLI: create a new project on [the Railway dashboard](https://railway.com/new), point it at your GitHub repository, and Railway builds from the same `Dockerfile` on every push.

## TypeScript support

The type stripper (`framework/tools/strip.js`) erases types without a TypeScript compiler, on Arc itself. It supports the type syntax used in everyday code:

- type annotations on variables, parameters, return types, and class fields
- `interface` and `type` declarations, `import type` / `export type`
- generics in type position, `as` casts, optional `?` parameters and fields
- `private` / `public` / `protected` / `readonly` modifiers, `declare` statements

It intentionally does not transform syntax that generates code: `enum`, `namespace`, parameter properties, decorators, and call-site generics like `foo<T>()`. Stick to the supported subset and the stripped output is the source, minus types.

## API reference

| Export | Description |
| --- | --- |
| `new Server(options?)` | Create a server. `options.path` sets the WebSocket path (default `/volt`). |
| `io.listen(port)` | Start listening. Resolves with the bound port (`0` picks a free one). |
| `io.on("connection", fn)` | Handle new sockets on the default namespace. |
| `io.of(name)` | Get or create a namespace. |
| `io.use(fn)` | Register middleware on the default namespace. |
| `io.to(room)` / `io.except(room)` | Build a broadcast targeting rooms. |
| `io.emit(event, ...args)` | Emit to every socket on the default namespace. |
| `io.http(handler)` | Handle plain HTTP requests. |
| `io.close()` | Close the listener and disconnect all sockets. |
| `socket.emit(event, ...args, ack?)` | Emit to the client, with an optional ack callback. |
| `socket.emitWithAck(event, ...args)` | Emit and await the acknowledgement. |
| `socket.on(event, fn)` | Listen for client events. The last argument is an ack function when the client requests one. |
| `socket.join(room)` / `socket.leave(room)` | Manage room membership. |
| `socket.to(room)` | Broadcast to a room, excluding this socket. |
| `socket.broadcast` | Broadcast to the namespace, excluding this socket. |
| `socket.handshake` | Address, URL, query, headers, auth, and issue time. |
| `socket.data` | A plain object for your own per-socket state. |
| `socket.disconnect(close?)` | Disconnect the socket; pass `true` to close the underlying connection. |
| `connect(url, options?)` | Connect a client. `options.auth` carries credentials, `options.path` matches the server path. |
| `client.emit` / `client.emitWithAck` / `client.on` | Mirror the server socket API. |
| `client.disconnect()` | Close the connection. |
