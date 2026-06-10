// A chat server with rooms, plus three in-process clients exercising it.
//
// Build, then run:
//
//   gleam run -- --event-loop framework/tools/build.js
//   gleam run -- --event-loop framework/examples/dist/chat.js

declare const Arc: any;

import { Server } from "../../lib/server.js";
import { connect } from "../../lib/client.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => Arc.setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const io = new Server();

  io.use((socket: any, next: (err?: Error) => void) => {
    const name = socket.handshake.auth && socket.handshake.auth.name;
    if (typeof name === "string" && name.length > 0) {
      socket.data.name = name;
      next();
    } else {
      next(new Error("a name is required"));
    }
  });

  io.on("connection", (socket: any) => {
    socket.on("join", (room: string, ack: () => void) => {
      socket.join(room);
      socket.to(room).emit("system", socket.data.name + " joined " + room);
      ack();
    });

    socket.on("message", (room: string, text: string) => {
      io.to(room).emit("message", socket.data.name, text);
    });

    socket.on("disconnect", () => {
      io.emit("system", socket.data.name + " left");
    });
  });

  const port = await io.listen(4000);
  Arc.log("chat server on port " + port);

  const url = "ws://127.0.0.1:" + port + "/";
  const ada = await connect(url, { auth: { name: "ada" } });
  const bob = await connect(url, { auth: { name: "bob" } });

  for (const client of [ada, bob]) {
    client.on("message", (from: string, text: string) => {
      Arc.log("[general] " + from + ": " + text);
    });
    client.on("system", (text: string) => {
      Arc.log("[system] " + text);
    });
  }

  await ada.emitWithAck("join", "general");
  await bob.emitWithAck("join", "general");

  ada.emit("message", "general", "hello bob");
  bob.emit("message", "general", "hi ada");
  await delay(200);

  try {
    await connect(url);
  } catch (err) {
    Arc.log("[rejected] " + (err as Error).message);
  }

  ada.disconnect();
  bob.disconnect();
  await delay(100);
  io.close();
}

main();
