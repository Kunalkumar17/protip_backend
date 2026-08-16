import dotenv from "dotenv/config";
import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import http from "http";
import cron from "node-cron";
import cookieParser from "cookie-parser";

import donationsRoutes from "./routes/donations.js";
import { initWebSocket } from "./websocket.js"; // 👈 important

const port = process.env.PORT || 3000;

const app = express();

app.set("trust proxy", 1);

app.use(express.json());
app.use(cookieParser());
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

cron.schedule("0 0 * * *", async () => {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const result = await Tips.deleteMany({
    payment: false,
    createdAt: { $lt: twentyFourHoursAgo }
  });

  if (result.deletedCount > 0) {
    console.log("Deleted abandoned tips:", result.deletedCount);
  }
});

app.get("/api/tts-token", async (req, res) => {
  try {
    const azureRes = await fetch(
      `https://${process.env.AZURE_REGION}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
      { method: "POST", headers: { "Ocp-Apim-Subscription-Key": process.env.AZURE_KEY } }
    );
    if (!azureRes.ok) throw new Error(`Azure token failed: ${azureRes.status}`);
    const token = await azureRes.text();
    res.json({ token, region: process.env.AZURE_REGION });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Token fetch failed" });
  }
});

// start server
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    server.listen(port, () => {
      console.log("Server running on port", port);
    });
  })
  .catch(console.log);

  
