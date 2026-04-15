// bridge-server.js
//
// Small Node.js process that accepts Plan documents over HTTP and forwards
// them to the Claude Control Bridge plugin over WebSocket.
//
// Usage:
//   node bridge-server.js
//
// Endpoints:
//   POST /plan        — submit a Plan JSON document. Body must be a full Plan.
//   GET  /status      — connection health (is the plugin connected?)
//   GET  /events      — Server-Sent Events stream of execution events
//   WS   /plugin      — plugin connects here
//
// This file has ZERO npm dependencies — uses only Node's built-in http/crypto
// modules and a minimal WebSocket frame implementation. That way you can run
// it with `node bridge-server.js` on a fresh machine with no install step.

const http = require("http");
const crypto = require("crypto");

const PORT = Number(process.env.PORT) || 7879;

// ---------------------------------------------------------------------------
// Minimal WebSocket server (RFC 6455 handshake + frame encoder/decoder)
// ---------------------------------------------------------------------------
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function computeAcceptKey(secWebSocketKey) {
  return crypto
    .createHash("sha1")
    .update(secWebSocketKey + WS_GUID)
    .digest("base64");
}

function encodeFrame(payload) {
  const data = Buffer.from(payload, "utf8");
  const len = data.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x81; // FIN + text frame
  return Buffer.concat([header, data]);
}

function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const byte1 = buf[0];
  const byte2 = buf[1];
  const opcode = byte1 & 0x0f;
  const masked = (byte2 & 0x80) !== 0;
  let len = byte2 & 0x7f;
  let offset = 2;

  if (len === 126) {
    if (buf.length < offset + 2) return null;
    len = buf.readUInt16BE(offset);
    offset += 2;
  } else if (len === 127) {
    if (buf.length < offset + 8) return null;
    len = Number(buf.readBigUInt64BE(offset));
    offset += 8;
  }

  let mask;
  if (masked) {
    if (buf.length < offset + 4) return null;
    mask = buf.slice(offset, offset + 4);
    offset += 4;
  }

  if (buf.length < offset + len) return null;

  const payload = Buffer.alloc(len);
  for (let i = 0; i < len; i++) {
    payload[i] = masked ? buf[offset + i] ^ mask[i % 4] : buf[offset + i];
  }

  return {
    opcode,
    payload: payload.toString("utf8"),
    totalLength: offset + len,
  };
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let pluginSocket = null;
const sseClients = new Set();
const rpcPromises = new Map();

function broadcastEvent(event) {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(line);
    } catch (e) {
      sseClients.delete(res);
    }
  }
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  // CORS — allow any origin so curl, browser devtools, MCP clients all work
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "POST" && req.url === "/rpc") {
    let body = "";
    let bodySize = 0;
    const MAX_BODY = 2 * 1024 * 1024; // 2 MB
    req.on("data", (c) => {
      bodySize += c.length;
      if (bodySize > MAX_BODY) { req.destroy(); return; }
      body += c;
    });
    req.on("end", () => {
      let rpcReq;
      try {
        rpcReq = JSON.parse(body);
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }
      if (!rpcReq.method) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "RPC must have a method" }));
        return;
      }
      if (!pluginSocket) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Plugin not connected" }));
        return;
      }
      
      const rpcId = "rpc_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
      
      const timeoutId = setTimeout(() => {
        if (rpcPromises.has(rpcId)) {
          const { reject } = rpcPromises.get(rpcId);
          rpcPromises.delete(rpcId);
          reject(new Error("RPC Timed out"));
        }
      }, 15000); // 15 sec timeout

      rpcPromises.set(rpcId, {
        resolve: (result) => {
          clearTimeout(timeoutId);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ result }));
        },
        reject: (err) => {
          clearTimeout(timeoutId);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(err) }));
        }
      });

      try {
        const msg = JSON.stringify({ kind: "rpc_request", method: rpcReq.method, params: rpcReq.params || {}, rpcId });
        pluginSocket.write(encodeFrame(msg));
      } catch (e) {
        if (rpcPromises.has(rpcId)) {
          const { reject } = rpcPromises.get(rpcId);
          rpcPromises.delete(rpcId);
          reject(e);
        }
      }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/plan") {
    let body = "";
    let bodySize = 0;
    const MAX_BODY = 2 * 1024 * 1024; // 2 MB
    req.on("data", (c) => {
      bodySize += c.length;
      if (bodySize > MAX_BODY) { req.destroy(); return; }
      body += c;
    });
    req.on("end", () => {
      let plan;
      try {
        plan = JSON.parse(body);
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }
      if (!plan.planId || !Array.isArray(plan.operations)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Plan must have planId and operations array",
          }),
        );
        return;
      }
      if (!pluginSocket) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Plugin not connected. Open the Claude Control Bridge plugin in Figma.",
          }),
        );
        return;
      }
      try {
        const msg = JSON.stringify({ kind: "plan", plan });
        pluginSocket.write(encodeFrame(msg));
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ status: "forwarded", planId: plan.planId }),
        );
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    });
    return;
  }

  if (req.method === "GET" && req.url === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        pluginConnected: !!pluginSocket,
        sseClients: sseClients.size,
        port: PORT,
      }),
    );
    return;
  }

  if (req.method === "GET" && req.url === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(":ok\n\n");
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(
      "Claude Control Bridge server\n" +
        "Plugin: " + (pluginSocket ? "connected" : "not connected") + "\n" +
        "Port: " + PORT + "\n\n" +
        "POST /plan    submit a plan\n" +
        "GET  /status  connection health\n" +
        "GET  /events  SSE stream of execution events\n",
    );
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

// ---------------------------------------------------------------------------
// WebSocket upgrade (for the plugin)
// ---------------------------------------------------------------------------
server.on("upgrade", (req, socket) => {
  if (req.url !== "/plugin") {
    socket.destroy();
    return;
  }
  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }
  const acceptKey = computeAcceptKey(key);
  const headers = [
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    "Sec-WebSocket-Accept: " + acceptKey,
    "",
    "",
  ].join("\r\n");
  socket.write(headers);

  if (pluginSocket) {
    // Close old socket if a second plugin instance connects
    try { pluginSocket.destroy(); } catch (e) {}
  }
  pluginSocket = socket;
  console.log("Plugin connected");

  let buffer = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const frame = decodeFrame(buffer);
      if (!frame) break;
      buffer = buffer.slice(frame.totalLength);
      if (frame.opcode === 0x8) {
        // Close frame
        socket.destroy();
        return;
      }
      if (frame.opcode === 0x1) {
        // Text frame
        try {
          const msg = JSON.parse(frame.payload);
          if (msg.kind === "plan") {
            console.log("[Bridge] Routing plan to plugin UI");
          } else if (msg.kind === "event") {
            console.log("[Bridge] Received event:", msg.event.type);
            const sseMsg = `data: ${JSON.stringify(msg.event)}\n\n`;
            for (const res of sseClients) {
              res.write(sseMsg);
            }
          } else if (msg.kind === "rpc_response") {
            if (rpcPromises.has(msg.rpcId)) {
              const { resolve, reject } = rpcPromises.get(msg.rpcId);
              rpcPromises.delete(msg.rpcId);
              if (msg.error) reject(new Error(msg.error));
              else resolve(msg.result);
            }
          }
        } catch (e) {
          console.error("[Bridge] Error parsing plugin message:", e);
        }
      }
    }
  });

  socket.on("close", () => {
    if (pluginSocket === socket) pluginSocket = null;
    console.log("Plugin disconnected");
  });

  socket.on("error", (e) => {
    console.warn("Plugin socket error:", e.message);
    if (pluginSocket === socket) pluginSocket = null;
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("Design Audit Bridge server listening on http://localhost:" + PORT);
  console.log("Now open the Design Audit Bridge plugin in Figma Desktop.");
});

// Graceful shutdown
function shutdown() {
  console.log("\nShutting down...");
  if (pluginSocket) { try { pluginSocket.destroy(); } catch (e) {} }
  for (const res of sseClients) { try { res.end(); } catch (e) {} }
  sseClients.clear();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 3000);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
