const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// =========================
// GLOBAL STATE
// =========================
const reporters = new Map();   // code -> reporter object
const sessions = new Map();    // socket.id -> code

// =========================
// HELPERS
// =========================
const getStudioState = () => ({
  reporters: Object.fromEntries(
    [...reporters.entries()].map(([code, r]) => [
      code,
      {
        code: r.code,
        name: r.name,
        level: r.level || 0,
        transmitting: !!r.transmitting,
        connected: r.connected ?? true,
        sockets: r.sockets?.size || 0,
        lastSeen: r.lastSeen || 0
      }
    ])
  ),
  updatedAt: Date.now()
});

const broadcastState = () => {
  io.emit("studio-state", getStudioState());
};

// =========================
// HEALTH CHECK
// =========================
app.get("/", (req, res) => {
  res.send("HI-Power Connect Backend Running");
});

// =========================
// SOCKET ENGINE
// =========================
io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  // 🔥 send full state immediately on join
  socket.emit("studio-state", getStudioState());

  // =========================
  // REGISTER REPORTER
  // =========================
  socket.on("register-reporter", (data) => {
    const { code, name } = data || {};
    if (!code) return;

    sessions.set(socket.id, code);

    const existing = reporters.get(code);

    reporters.set(code, {
      code,
      name: name || existing?.name || "Reporter",
      level: existing?.level || 0,
      transmitting: existing?.transmitting || false,
      connected: true,
      sockets: new Set([
        ...(existing?.sockets || []),
        socket.id
      ]),
      lastSeen: Date.now()
    });

    socket.emit("registered", { code, name });

    broadcastState();
  });

  // =========================
  // AUDIO STATUS (REALTIME HEARTBEAT)
  // =========================
  socket.on("audio-status", (data) => {
    const code = sessions.get(socket.id);
    if (!code || !reporters.has(code)) return;

    const reporter = reporters.get(code);

    reporters.set(code, {
      ...reporter,
      code,
      name: reporter.name,
      level: data?.level ?? 0,
      transmitting: !!data?.transmitting,
      connected: true,
      lastSeen: Date.now()
    });

    broadcastState();
  });

  // =========================
  // GPS
  // =========================
  socket.on("gps-location", (location) => {
    const code = sessions.get(socket.id);
    if (!code) return;

    io.emit("gps-location", { code, location });
  });

  // =========================
  // WEBRTC SIGNALING (FIXED NAMES)
  // =========================
  socket.on("webrtc-offer", (offer) => {
    socket.broadcast.emit("webrtc-offer", {
      offer,
      from: socket.id
    });
  });

  socket.on("webrtc-answer", (answer) => {
    socket.broadcast.emit("webrtc-answer", {
      answer,
      from: socket.id
    });
  });

  socket.on("ice-candidate", (candidate) => {
    socket.broadcast.emit("ice-candidate", {
      candidate,
      from: socket.id
    });
  });

  // =========================
  // STUDIO COMMAND ENGINE
  // =========================
  socket.on("studio-command", (cmd) => {
    const target = cmd?.target;

    if (target && reporters.has(target)) {
      const reporter = reporters.get(target);

      for (const socketId of reporter.sockets) {
        io.to(socketId).emit("studio-command", {
          ...cmd,
          from: socket.id
        });
      }

      return;
    }

    io.emit("studio-command", {
      ...cmd,
      from: socket.id
    });
  });

  // =========================
  // DISCONNECT HANDLING
  // =========================
  socket.on("disconnect", () => {
    const code = sessions.get(socket.id);

    if (code && reporters.has(code)) {
      const reporter = reporters.get(code);

      reporter.sockets.delete(socket.id);

      if (reporter.sockets.size === 0) {
        reporters.delete(code);
        io.emit("reporter-offline", { code });
      } else {
        reporters.set(code, reporter);
      }
    }

    sessions.delete(socket.id);

    broadcastState();

    console.log("Disconnected:", socket.id);
  });
});

// =========================
// HEARTBEAT CLEANER
// =========================
setInterval(() => {
  const now = Date.now();

  let changed = false;

  for (const [code, reporter] of reporters.entries()) {
    if (now - (reporter.lastSeen || 0) > 5000) {
      reporters.set(code, {
        ...reporter,
        connected: false,
        transmitting: false,
        level: 0
      });
      changed = true;
    }
  }

  if (changed) broadcastState();
}, 3000);

// =========================
// START SERVER
// =========================
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
