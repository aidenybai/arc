// Minimal Volt server with an HTTP fallback and one client.
//
// Build, then run:
//
//   gleam run -- --event-loop framework/tools/build.js
//   gleam run -- --event-loop framework/examples/dist/echo.js

declare const Arc: any;

import { Server } from "../../lib/server.js";
import { connect } from "../../lib/client.js";

async function main(): Promise<void> {
  const io = new Server();

  io.on("connection", (socket: any) => {
    Arc.log("server: " + socket.id + " connected");
    socket.on("echo", (message: string, ack: (reply: string) => void) => {
      ack("echo: " + message);
    });
  });

  io.http((req: any) => ({ status: 200, body: "Volt is running at " + req.path }));

  const port = await io.listen(4000);
  Arc.log("listening on port " + port);

  const client = await connect("ws://127.0.0.1:" + port + "/");
  const reply = await client.emitWithAck("echo", "hello volt");
  Arc.log("client: " + reply);

  client.disconnect();
  io.close();
}

main();
