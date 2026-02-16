import dotenv from "dotenv/config";
import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import http from "http";

import donationsRoutes from "./routes/donations.js";
import { initWebSocket } from "./websocket.js"; // 👈 important

const port = process.env.PORT || 3000;

const app = express();

app.use(express.json());
app.use(express.static("public"));

app.use(cors({
  origin: [process.env.USER_FRONTEND_URL],
  credentials: true
}));

app.use("/donations", donationsRoutes);

// create HTTP server
const server = http.createServer(app);

// attach websocket
initWebSocket(server);

// start server
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    server.listen(port, () => {
      console.log("Server running on port", port);
    });
  })
  .catch(console.log);
