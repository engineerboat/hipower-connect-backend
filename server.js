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
// SYSTEM STATE
// =========================
const reporters = new Map(); // code -> reporter group
const sessions = new Map();  // socket.id -> code
const socketToCode = new Map(); // socket.id -> code

// =========================
// HEALTH CHECK
// =========================
app.get("/", (req, res) => {
  res.send("HI-Power Connect Backend Running");
});

// =========================
// SOCKET CORE
// =========================
io.on("connection", (socket) => {

  console.log(`Connected: ${socket.id}`);

  // =========================
  // REGISTER USER (CRITICAL FIX)
  // =========================
socket.on("register-reporter", (data) => {

  const { code, name } = data || {};
  if (!code) return;

  sessions.set(socket.id, code);

  if (!reporters.has(code)) {
    reporters.set(code, {
      code,
      name: name || "Reporter",
      sockets: new Set()
    });
  }

  const reporter = reporters.get(code);

  reporter.name = name || reporter.name;
  reporter.sockets.add(socket.id);

  socket.emit("registered", {
    code,
    name: reporter.name
  });

  io.emit("reporter-joined", {
    code,
    name: reporter.name,
    activeDevices: reporter.sockets.size
  });
});

  // =========================
  // AUDIO STATUS (FIXED ROUTING)
  // =========================
socket.on("audio-status", (data) => {

  const code = sessions.get(socket.id);

  if (!code || !reporters.has(code)) return;

  const reporter = reporters.get(code);

  const payload = {
    code,
    name: reporter.name,
    level: data.level,
    connected: true,
    transmitting: data.transmitting,
    timestamp: Date.now(),
    devices: reporter.sockets.size
  };

  console.log("📡 REPORTER STATUS:", payload);

  io.emit("audio-status", payload);
});

  // =========================
  // GPS LOCATION
  // =========================
socket.on("gps-location", (location) => {

  const code = sessions.get(socket.id);
  if (!code) return;

  io.emit("gps-location", {
    code,
    location
  });
});
  // =========================
  // WEBRTC SIGNALING
  // =========================
  socket.on("offer", (offer) => {
    socket.broadcast.emit("offer", {
      offer,
      from: socket.id
    });
  });

  socket.on("answer", (answer) => {
    socket.broadcast.emit("answer", {
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
  // STUDIO COMMAND ENGINE (NEW CORE FEATURE)
  // =========================
  socket.on("studio-command", (cmd) => {

    const target = cmd?.target;

    // TARGETED COMMAND (SOLO / MUTE SINGLE REPORTER)
if (target && reporters.has(target)) {

  const reporter = reporters.get(target);

  reporter.sockets.forEach((socketId) => {
    io.to(socketId).emit("studio-command", {
      ...cmd,
      from: socket.id
    });
  });

  return;
}

    // GLOBAL COMMAND (MUTE ALL / PANIC CUT)
    io.emit("studio-command", {
      ...cmd,
      from: socket.id
    });
  });

  // =========================
  // TALKBACK SYSTEM
  // =========================
  socket.on("talkback", (data) => {
    socket.broadcast.emit("talkback", {
      ...data,
      from: socket.id
    });
  });

  // =========================
  // DISCONNECT CLEANUP
  // =========================
socket.on("disconnect", () => {

  const code = sessions.get(socket.id);

  if (code && reporters.has(code)) {

    const reporter = reporters.get(code);

    reporter.sockets.delete(socket.id);

    if (reporter.sockets.size === 0) {

      reporters.delete(code);

      io.emit("reporter-offline", {
        code
      });
    }
  }

  sessions.delete(socket.id);

  console.log(`Disconnected: ${socket.id}`);
});

});

// =========================
// START SERVER (BOTTOM ONLY)
// =========================
// =========================
// START SERVER (BOTTOM ONLY)
// =========================

setInterval(() => {
  io.emit("server-heartbeat", {
    time: Date.now(),
    activeUsers: reporters.size
  });
}, 3000);

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});