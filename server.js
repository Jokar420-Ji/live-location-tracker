const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const { nanoid } = require("nanoid");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

const sessions = new Map();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/session", (req, res) => {
  const id = nanoid(10);
  sessions.set(id, {
    id,
    createdAt: Date.now(),
    active: false,
    location: null,
    viewers: 0,
    sharerConnected: false
  });
  res.json({ id });
});

app.get("/api/session/:id", (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "Session not found" });
  res.json(s);
});

io.on("connection", socket => {
  socket.on("join-session", ({ id, role }) => {
    const s = sessions.get(id);
    if (!s) return socket.emit("session-error", "Invalid or expired tracking link.");

    socket.join(id);
    socket.data.sessionId = id;
    socket.data.role = role === "sharer" ? "sharer" : "admin";

    if (socket.data.role === "admin") {
      s.viewers++;
      socket.emit("session-state", s);
      io.to(id).emit("viewer-count", s.viewers);
    } else {
      s.sharerConnected = true;
      socket.emit("session-state", s);
      io.to(id).emit("sharer-status", true);
    }
  });

  socket.on("location-update", data => {
    const id = socket.data.sessionId;
    const s = sessions.get(id);
    if (!s || socket.data.role !== "sharer") return;

    const lat = Number(data.lat), lng = Number(data.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;

    s.location = {
      lat, lng,
      accuracy: Number(data.accuracy) || null,
      speed: Number(data.speed) || null,
      heading: Number(data.heading) || null,
      timestamp: Date.now()
    };
    s.active = true;
    io.to(id).emit("location-update", s.location);
  });

  socket.on("tracking-status", ({ active }) => {
    const id = socket.data.sessionId;
    const s = sessions.get(id);
    if (!s || socket.data.role !== "sharer") return;
    s.active = !!active;
    io.to(id).emit("tracking-status", { active: s.active });
  });

  socket.on("disconnect", () => {
    const id = socket.data.sessionId;
    const s = sessions.get(id);
    if (!s) return;
    if (socket.data.role === "admin") {
      s.viewers = Math.max(0, s.viewers - 1);
      io.to(id).emit("viewer-count", s.viewers);
    } else {
      s.sharerConnected = false;
      s.active = false;
      io.to(id).emit("sharer-status", false);
      io.to(id).emit("tracking-status", { active: false });
    }
  });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

server.listen(PORT, () => console.log(`Live Location Tracker running on port ${PORT}`));
