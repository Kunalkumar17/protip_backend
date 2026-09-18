import { WebSocketServer } from "ws";
import Goal from "./model/goal.js";
import Streamer from "./model/streamer.js";

const clients = new Map();
// streamerId -> Set of WebSocket clients

export const initWebSocket = (server) => {
  const wss = new WebSocketServer({ server });

  wss.on("connection", async (ws, req) => {
    console.log("WS client connected");

        const url = new URL(
      req.url,
      `http://${req.headers.host}`
    );

    const streamerSlug =
      url.searchParams
        .get("streamer")
        ?.toLowerCase()
        .trim();

    if (!streamerSlug) {
      console.log(
        "WS connection rejected: no streamer"
      );

      ws.close();
      return;
    }

    const streamer = await Streamer.findOne({
      username: streamerSlug,
    });

    if (!streamer) {
      console.log(
        `WS connection rejected: streamer not found: ${streamerSlug}`
      );

      ws.close();
      return;
    }

    const streamerId = streamer._id.toString();

    // Create a client set for this streamer
    if (!clients.has(streamerId)) {
      clients.set(streamerId, new Set());
    }

    clients.get(streamerId).add(ws);

    console.log(`WS client connected for streamer: ${streamerId}`);

    try {
      const goal = await Goal.findOne({ streamerId });

      if (goal) {
        ws.send(
          JSON.stringify({
            type: "goalInit",
            goal,
          })
        );
      }
    } catch (error) {
      console.error("Failed to get goal:", error);
    }

    ws.on("close", () => {
      const streamerClients = clients.get(streamerId);

      if (streamerClients) {
        streamerClients.delete(ws);

        if (streamerClients.size === 0) {
          clients.delete(streamerId);
        }
      }

      console.log(`WS client disconnected: ${streamerId}`);
    });
  });
};

export const broadcast = (data, streamerId) => {
  const id = streamerId?.toString();

  console.log("📡 BROADCAST:", {
    type: data.type,
    streamerId: id,
    clients: clients.get(id)?.size || 0,
  });

  if (!id) {
    console.log("❌ Broadcast skipped: no streamerId");
    return;
  }

  const streamerClients = clients.get(id);

  if (!streamerClients) {
    console.log("❌ No clients for streamer:", id);
    return;
  }

  streamerClients.forEach((client) => {
    if (client.readyState === 1) {
      console.log("📤 Sending", data.type, "to client");
      client.send(JSON.stringify(data));
    }
  });
};

export const broadcastTip = async (
  streamerId,
  tip,
  updateGoal = true
) => {
  streamerId = streamerId?.toString();
  if (!streamerId) {
    console.log("❌ Broadcast tip skipped: no streamerId");
    return;
  }

  const amount = Number(tip.convertedAmount) || 0;

  console.log("💰 Broadcasting tip:", {
    streamerId,
    name: tip.name,
    amount: tip.amount,
    currency: tip.currency,
    message: tip.message,
    memeSound: tip.memeSound,
  });

  // =========================
  // UPDATE GOAL
  // =========================

  if (updateGoal) {
    try {
      const goal = await Goal.findOne({ streamerId });

      if (goal) {
        goal.total += amount;
        await goal.save();

        console.log("🎯 Goal updated:", goal.total);

        broadcast(
          {
            type: "goalUpdate",
            goal,
          },
          streamerId
        );
      } else {
        console.log("ℹ️ No goal found for streamer:", streamerId);
      }
    } catch (error) {
      // IMPORTANT:
      // Goal failure should NOT prevent the tip alert.
      console.error("❌ Goal update failed:", error);
    }
  }

  // =========================
  // SEND TIP ALERT
  // =========================

  try {
    const alertMessage = {
      type: "tipAlert",
      name: tip.name || "Anonymous",
      amount: Number(tip.amount) || 0,
      currency: tip.currency,
      message: tip.message || "",
      memeSound: tip.memeSound || null,
      convertedAmount: amount,
    };

    console.log("🚨 Sending tipAlert to streamer:", streamerId);

    broadcast(alertMessage, streamerId);

    console.log("✅ tipAlert broadcast complete");
  } catch (error) {
    console.error("❌ Tip alert broadcast failed:", error);
  }
};