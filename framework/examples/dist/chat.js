// A chat server with rooms, plus three in-process clients exercising it.
//
// Build, then run:
//
//   gleam run -- --event-loop framework/tools/build.js
//   gleam run -- --event-loop framework/examples/dist/chat.js

   

import { Server } from "../../lib/server.js";
import { connect } from "../../lib/client.js";

function delay(ms )  {
  return new Promise((resolve) => Arc.setTimeout(resolve, ms));
}

async function main()  {
  const io = new Server();

  io.use((socket , next    ) => {
    const name = socket.handshake.auth && socket.handshake.auth.name;
    if (typeof name === "string" && name.length > 0) {
      socket.data.name = name;
      next();
    } else {
      next(new Error("a name is required"));
    }
  });

  io.on("connection", (socket ) => {
    socket.on("join", (room , ack   ) => {
      socket.join(room);
      socket.to(room).emit("system", socket.data.name + " joined " + room);
      ack();
    });

    socket.on("message", (room , text ) => {
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
    client.on("message", (from , text ) => {
      Arc.log("[general] " + from + ": " + text);
    });
    client.on("system", (text ) => {
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
    Arc.log("[rejected] " + (err  ).message);
  }

  ada.disconnect();
  bob.disconnect();
  await delay(100);
  io.close();
}

main();
