import { WebSocketServer } from "ws";
import jwt from "jsonwebtoken";
import Goal from "./model/goal.js";
import { sessionSecret } from "./middleware/auth.js"; // adjust path if needed

const clients = new Map();
// streamerId -> Set<WebSocket>

const getCookie = (cookieHeader, name) => {
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(";");

  for (const cookie of cookies) {
    const [key, ...value] = cookie.trim().split("=");

    if (key === name) {
      return decodeURIComponent(value.join("="));
    }
  }

  return null;
};

export const initWebSocket = (server) => {
  const wss = new WebSocketServer({ server });

  wss.on("connection", async (ws, req) => {
    console.log("🔌 WS client connecting...");

    try {
      // =========================
      // GET SESSION COOKIE
      // =========================

      const token = getCookie(
        req.headers.cookie,
        "dashboardSession"
      );

      if (!token) {
        console.log("❌ WS rejected: no dashboard session");
        ws.close(1008, "Unauthorized");
        return;
      }

      // =========================
      // VERIFY JWT
      // =========================

      const payload = jwt.verify(
        token,
        sessionSecret()
      );

      if (!payload.streamerId) {
        console.log("❌ WS rejected: no streamerId");
        ws.close(1008, "Unauthorized");
        return;
      }

      const streamerId = payload.streamerId.toString();

      console.log(
        "✅ WS authenticated for streamer:",
        streamerId
      );

      // =========================
      // REGISTER CLIENT
      // =========================

      if (!clients.has(streamerId)) {
        clients.set(streamerId, new Set());
      }

      clients.get(streamerId).add(ws);

      console.log(
        `📡 WS client registered for streamer ${streamerId}`
      );

      // =========================
      // SEND CURRENT GOAL
      // =========================

      try {
        const goal = await Goal.findOne({
          streamerId,
        });

        if (goal && ws.readyState === 1) {
          ws.send(
            JSON.stringify({
              type: "goalInit",
              goal,
            })
          );
        }
      } catch (error) {
        console.error(
          "❌ Failed to get goal:",
          error
        );
      }

      // =========================
      // DISCONNECT
      // =========================

      ws.on("close", () => {
        const streamerClients = clients.get(streamerId);

        if (streamerClients) {
          streamerClients.delete(ws);

          if (streamerClients.size === 0) {
            clients.delete(streamerId);
          }
        }

        console.log(
          `🔌 WS client disconnected: ${streamerId}`
        );
      });

    } catch (error) {
      console.error(
        "❌ WS authentication failed:",
        error.message
      );

      ws.close(1008, "Unauthorized");
    }
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
      console.log(
        "📤 Sending",
        data.type,
        "to client"
      );

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
    console.log(
      "❌ Broadcast tip skipped: no streamerId"
    );
    return;
  }

  const amount =
    Number(tip.convertedAmount) || 0;

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
      const goal = await Goal.findOne({
        streamerId,
      });

      if (goal) {
        goal.total += amount;
        await goal.save();

        console.log(
          "🎯 Goal updated:",
          goal.total
        );

        broadcast(
          {
            type: "goalUpdate",
            goal,
          },
          streamerId
        );
      } else {
        console.log(
          "ℹ️ No goal found for streamer:",
          streamerId
        );
      }
    } catch (error) {
      console.error(
        "❌ Goal update failed:",
        error
      );
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

    console.log(
      "🚨 Sending tipAlert to streamer:",
      streamerId
    );

    broadcast(
      alertMessage,
      streamerId
    );

    console.log(
      "✅ tipAlert broadcast complete"
    );
  } catch (error) {
    console.error(
      "❌ Tip alert broadcast failed:",
      error
    );
  }
};