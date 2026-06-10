// Volt test suite, modeled on the socket.io server tests
// (socketio/socket.io packages/socket.io/test/socket.ts).

   

import { describe, it, delay, expect } from "./harness.js";
import { Server } from "../../lib/server.js";
import { connect } from "../../lib/client.js";
import { encodePacket, decodePacket, PacketType } from "../../lib/parser.js";
import { utf8Encode, utf8Decode } from "../../lib/utf8.js";
import { encodeFrame, decodeFrame, OPCODE } from "../../lib/ws.js";

async function withServer(
  fn      ,
)  {
  const io = new Server();
  const port = await io.listen(0);
  try {
    await fn(io, port);
  } finally {
    io.close();
  }
}

function url(port , nsp  = "/")  {
  return "ws://127.0.0.1:" + port + nsp;
}

describe("connection", () => {
  it("should fire a connection event", (done) => {
    withServer(async (io, port) => {
      const connected = new Promise((resolve) => {
        io.on("connection", () => resolve());
      });
      await connect(url(port));
      await connected;
    }).then(() => done(), done);
  });

  it("should assign an id and the default namespace", () =>
    withServer(async (io, port) => {
      let serverSocket  = null;
      io.on("connection", (socket ) => {
        serverSocket = socket;
      });
      const client = await connect(url(port));
      expect(typeof client.id, "string", "client id type");
      expect(client.id, serverSocket.id, "ids match");
      expect(serverSocket.nsp.name, "/", "default namespace");
    }));

  it("should receive events with their arguments intact", () =>
    withServer(async (io, port) => {
      const received = new Promise((resolve) => {
        io.on("connection", (socket ) => {
          socket.on("payload", (...args ) => resolve(args));
        });
      });
      const client = await connect(url(port));
      client.emit("payload", "str", 42, { nested: [1, 2] }, null, true);
      expect(await received, ["str", 42, { nested: [1, 2] }, null, true], "args");
    }));

  it("should emit events from the server to the client", () =>
    withServer(async (io, port) => {
      io.on("connection", (socket ) => {
        socket.emit("greeting", "hello", { from: "server" });
      });
      const client = await connect(url(port));
      const args = await new Promise((resolve) => {
        client.on("greeting", (...a ) => resolve(a));
      });
      expect(args, ["hello", { from: "server" }], "server emit args");
    }));

  it("should expose handshake details", () =>
    withServer(async (io, port) => {
      const handshake = new Promise((resolve) => {
        io.on("connection", (socket ) => resolve(socket.handshake));
      });
      await connect(url(port), { auth: { token: "abc" } });
      const h = await handshake;
      expect(typeof h.address, "string", "address");
      expect(h.auth, { token: "abc" }, "auth");
      expect(typeof h.issued, "number", "issued");
    }));
});

describe("acknowledgements", () => {
  it("should call the ack callback for client-to-server emits", () =>
    withServer(async (io, port) => {
      io.on("connection", (socket ) => {
        socket.on("question", (text , ack    ) => {
          ack("answer:" + text);
        });
      });
      const client = await connect(url(port));
      const answer = await client.emitWithAck("question", "ping");
      expect(answer, "answer:ping", "ack value");
    }));

  it("should call the ack callback for server-to-client emits", () =>
    withServer(async (io, port) => {
      const acked = new Promise((resolve) => {
        io.on("connection", (socket ) => {
          socket.emit("question", "ready?", (reply ) => resolve(reply));
        });
      });
      const client = await connect(url(port));
      client.on("question", (text , ack    ) => {
        ack("yes, " + text);
      });
      expect(await acked, "yes, ready?", "server ack value");
    }));

  it("should support emitWithAck on the server socket", () =>
    withServer(async (io, port) => {
      const replied = new Promise((resolve) => {
        io.on("connection", async (socket ) => {
          resolve(await socket.emitWithAck("sum", 2, 3));
        });
      });
      const client = await connect(url(port));
      client.on("sum", (a , b , ack    ) => {
        ack(a + b);
      });
      expect(await replied, 5, "emitWithAck result");
    }));
});

describe("broadcast", () => {
  it("should emit to all connected clients via io.emit", () =>
    withServer(async (io, port) => {
      const a = await connect(url(port));
      const b = await connect(url(port));
      const got  = [];
      const all = new Promise((resolve) => {
        const tick = () => {
          if (got.length === 2) resolve();
        };
        a.on("news", (m ) => {
          got.push("a:" + m);
          tick();
        });
        b.on("news", (m ) => {
          got.push("b:" + m);
          tick();
        });
      });
      io.emit("news", "flash");
      await all;
      got.sort();
      expect(got, ["a:flash", "b:flash"], "both received");
    }));

  it("should exclude the sender with socket.broadcast", () =>
    withServer(async (io, port) => {
      io.on("connection", (socket ) => {
        socket.on("shout", (m ) => socket.broadcast.emit("echo", m));
      });
      const a = await connect(url(port));
      const b = await connect(url(port));
      let aGot = 0;
      const bGot = new Promise((resolve) => {
        b.on("echo", (m ) => resolve(m));
      });
      a.on("echo", () => {
        aGot++;
      });
      a.emit("shout", "hi");
      expect(await bGot, "hi", "other client received");
      await delay(50);
      expect(aGot, 0, "sender excluded");
    }));
});

describe("rooms", () => {
  it("should join rooms and receive room broadcasts", () =>
    withServer(async (io, port) => {
      io.on("connection", (socket ) => {
        socket.on("join", (room , ack   ) => {
          socket.join(room);
          ack();
        });
      });
      const a = await connect(url(port));
      const b = await connect(url(port));
      await a.emitWithAck("join", "lobby");
      let bGot = 0;
      const aGot = new Promise((resolve) => {
        a.on("room-news", (m ) => resolve(m));
      });
      b.on("room-news", () => {
        bGot++;
      });
      io.to("lobby").emit("room-news", "members only");
      expect(await aGot, "members only", "member received");
      await delay(50);
      expect(bGot, 0, "non-member excluded");
    }));

  it("should leave rooms", () =>
    withServer(async (io, port) => {
      io.on("connection", (socket ) => {
        socket.on("join", (room , ack   ) => {
          socket.join(room);
          ack();
        });
        socket.on("leave", (room , ack   ) => {
          socket.leave(room);
          ack();
        });
      });
      const a = await connect(url(port));
      await a.emitWithAck("join", "lobby");
      await a.emitWithAck("leave", "lobby");
      let got = 0;
      a.on("room-news", () => {
        got++;
      });
      io.to("lobby").emit("room-news", "anyone?");
      await delay(50);
      expect(got, 0, "left the room");
    }));

  it("should broadcast to a room from a socket, excluding the sender", () =>
    withServer(async (io, port) => {
      io.on("connection", (socket ) => {
        socket.join("game");
        socket.on("move", (m ) => socket.to("game").emit("moved", m));
      });
      const a = await connect(url(port));
      const b = await connect(url(port));
      let aGot = 0;
      a.on("moved", () => {
        aGot++;
      });
      const bGot = new Promise((resolve) => {
        b.on("moved", (m ) => resolve(m));
      });
      a.emit("move", "e4");
      expect(await bGot, "e4", "room member received");
      await delay(50);
      expect(aGot, 0, "sender excluded");
    }));
});

describe("namespaces", () => {
  it("should isolate events between namespaces", () =>
    withServer(async (io, port) => {
      const chat = io.of("/chat");
      chat.on("connection", (socket ) => {
        socket.emit("welcome", "to chat");
      });
      io.on("connection", (socket ) => {
        socket.emit("welcome", "to root");
      });
      const chatClient = await connect(url(port, "/chat"));
      const chatMsg = new Promise((resolve) => {
        chatClient.on("welcome", (m ) => resolve(m));
      });
      const rootClient = await connect(url(port));
      const rootMsg = new Promise((resolve) => {
        rootClient.on("welcome", (m ) => resolve(m));
      });
      expect(await chatMsg, "to chat", "chat namespace");
      expect(await rootMsg, "to root", "root namespace");
    }));

  it("should reject connections to unknown namespaces", () =>
    withServer(async (io, port) => {
      let error  = null;
      try {
        await connect(url(port, "/nope"));
      } catch (err) {
        error = err;
      }
      expect(error === null, false, "connect rejected");
    }));
});

describe("middleware", () => {
  it("should run middleware before connection", () =>
    withServer(async (io, port) => {
      const order  = [];
      io.use((socket , next   ) => {
        order.push("mw1");
        next();
      });
      io.use((socket , next   ) => {
        order.push("mw2");
        next();
      });
      io.on("connection", () => order.push("connection"));
      await connect(url(port));
      expect(order, ["mw1", "mw2", "connection"], "middleware order");
    }));

  it("should refuse connections when middleware errors", () =>
    withServer(async (io, port) => {
      io.use((socket , next    ) => {
        next(new Error("not authorized"));
      });
      let message = "";
      try {
        await connect(url(port));
      } catch (err) {
        message = err && err.message ? err.message : String(err);
      }
      expect(message, "not authorized", "middleware error surfaced");
    }));

  it("should let middleware read auth from the handshake", () =>
    withServer(async (io, port) => {
      io.use((socket , next    ) => {
        if (socket.handshake.auth && socket.handshake.auth.token === "s3cr3t") {
          next();
        } else {
          next(new Error("bad token"));
        }
      });
      io.on("connection", (socket ) => socket.emit("ok"));
      const client = await connect(url(port), { auth: { token: "s3cr3t" } });
      await new Promise((resolve) => client.on("ok", () => resolve()));
      let rejected = false;
      try {
        await connect(url(port), { auth: { token: "wrong" } });
      } catch (err) {
        rejected = true;
      }
      expect(rejected, true, "bad token rejected");
    }));
});

describe("disconnect", () => {
  it("should fire disconnect on the server when the client disconnects", () =>
    withServer(async (io, port) => {
      const reason = new Promise((resolve) => {
        io.on("connection", (socket ) => {
          socket.on("disconnect", (r ) => resolve(r));
        });
      });
      const client = await connect(url(port));
      client.disconnect();
      expect(await reason, "client namespace disconnect", "reason");
    }));

  it("should fire disconnecting before leaving rooms", () =>
    withServer(async (io, port) => {
      const rooms = new Promise((resolve) => {
        io.on("connection", (socket ) => {
          socket.join("game");
          socket.on("disconnecting", () => {
            resolve(Array.from(socket.rooms));
          });
        });
      });
      const client = await connect(url(port));
      client.disconnect();
      const list = await rooms;
      expect(list.includes("game"), true, "still in room while disconnecting");
    }));

  it("should disconnect the client from the server side", () =>
    withServer(async (io, port) => {
      io.on("connection", (socket ) => {
        socket.disconnect(true);
      });
      const client = await connect(url(port));
      const reason = await new Promise((resolve) => {
        client.on("disconnect", (r ) => resolve(r));
      });
      expect(reason, "io server disconnect", "client reason");
    }));
});

describe("http fallback", () => {
  it("should serve plain HTTP requests through io.http", () =>
    withServer(async (io, port) => {
      io.http((req ) => ({ status: 200, body: "hello " + req.path }));
      const conn = await Arc.connect("127.0.0.1", port);
      await Arc.write(conn, "GET /status HTTP/1.1\r\nHost: x\r\n\r\n");
      let raw = "";
      while (true) {
        const chunk = await Arc.read(conn);
        if (chunk === null) break;
        raw += chunk;
      }
      expect(raw.includes("200"), true, "status line");
      expect(raw.includes("hello /status"), true, "body");
    }));
});

describe("packet parser", () => {
  it("should round-trip packets", () => {
    const packet = { t: PacketType.EVENT, nsp: "/", id: 3, data: ["x", 1] };
    const decoded = decodePacket(encodePacket(packet));
    expect(decoded, packet, "round trip");
  });

  it("should reject malformed packets", () => {
    expect(decodePacket("not json"), null, "invalid json");
    expect(decodePacket("{}"), null, "missing fields");
    expect(decodePacket('{"t":"x","nsp":"/"}'), null, "bad type field");
  });
});

describe("utf8", () => {
  it("should round-trip ascii, multibyte, and astral characters", () => {
    const samples = ["plain", "héllo wörld", "日本語", "emoji \u{1F680} ok"];
    for (const s of samples) {
      expect(utf8Decode(utf8Encode(s)), s, "round trip: " + s);
    }
  });
});

describe("websocket frames", () => {
  it("should round-trip unmasked frames", () => {
    const payload = "hello frame";
    const decoded  = decodeFrame(encodeFrame(OPCODE.TEXT, payload, false));
    expect(decoded.frame.opcode, OPCODE.TEXT, "opcode");
    expect(decoded.frame.payload, payload, "payload");
  });

  it("should round-trip masked frames", () => {
    const payload = "masked payload";
    const decoded  = decodeFrame(encodeFrame(OPCODE.TEXT, payload, true));
    expect(decoded.frame.payload, payload, "masked payload");
  });

  it("should handle extended 16-bit lengths", () => {
    let payload = "";
    for (let i = 0; i < 300; i++) payload += "a";
    const decoded  = decodeFrame(encodeFrame(OPCODE.TEXT, payload, false));
    expect(decoded.frame.payload.length, 300, "long payload length");
  });

  it("should return null for incomplete frames", () => {
    const full = encodeFrame(OPCODE.TEXT, "abcdef", false);
    expect(decodeFrame(full.slice(0, 3)), null, "partial frame");
  });
});
