// A long-running Volt server, ready for deployment. Reads the port from the
// PORT environment variable (set by Railway and most other hosts).
//
// Build, then run:
//
//   gleam run -- --event-loop framework/tools/build.js
//   PORT=3000 gleam run -- --event-loop framework/examples/dist/server.js

declare const Arc: any;

import { Server } from "../../lib/server.js";

const io = new Server();

io.on("connection", (socket: any) => {
  Arc.log("connected: " + socket.id + " from " + socket.handshake.address);

  socket.on("join", (room: string, ack: () => void) => {
    socket.join(room);
    socket.to(room).emit("system", socket.id + " joined " + room);
    if (typeof ack === "function") ack();
  });

  socket.on("message", (room: string, text: string) => {
    io.to(room).emit("message", socket.id, text);
  });

  socket.on("disconnect", (reason: string) => {
    Arc.log("disconnected: " + socket.id + " (" + reason + ")");
  });
});

io.http((req: any) => {
  if (req.path === "/health") {
    return { status: 200, body: "ok" };
  }
  return {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    body: "<h1>Volt server</h1><p>WebSocket endpoint: <code>/volt</code></p>",
  };
});

async function main(): Promise<void> {
  const envPort = Arc.env("PORT");
  const port = envPort === null ? 3000 : Number(envPort);
  await io.listen(port);
  Arc.log("volt server listening on port " + port);
}

main();
