import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

io.on("connection", socket => {
  console.log("User connected:", socket.id);

  // Join room
  socket.on("join-room", (code) => {
    socket.join(code);
    socket.to(code).emit("peer-joined");
  });

  // Relay SDP + ICE
  socket.on("signal", ({ code, data }) => {
    socket.to(code).emit("signal", data);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

const PORT = 5000;
server.listen(PORT, () => console.log("Signaling server running on port", PORT));
