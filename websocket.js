import { WebSocketServer } from "ws";
import Goal from "./model/goal.js";

let clients = [];


export const initWebSocket = (server) => {
  const wss = new WebSocketServer({ server });

  wss.on("connection", async (ws) => {
    console.log("WS client connected");

    clients.push(ws);

    try {
      let goal = await Goal.findOne();

      // Create default goal if none exists
      if (!goal) {
        goal = await Goal.create({
          name: "Monthly Goal",
          target: 10000,
          total: 0,
        });
      }

      ws.send(
        JSON.stringify({
          type: "goalInit",
          goal,
        })
      );
    } catch (error) {
      console.error("Failed to get goal:", error);
    }

    ws.on("close", () => {
      clients = clients.filter((client) => client !== ws);

      console.log("WS client disconnected");
    });
  });
};


export const broadcast = (data) => {
  clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(JSON.stringify(data));
    }
  });
};


export const broadcastTip = async (tip, updateGoal = true) => {
  const amount = Number(tip.convertedAmount) || 0;

  try {
    // Only update the goal for real tips
    if (updateGoal) {
      let goal = await Goal.findOne();

      // Safety: create a goal if one doesn't exist
      if (!goal) {
        goal = await Goal.create({
          name: "Monthly Goal",
          target: 10000,
          total: 0,
        });
      }

      goal.total += amount;
      await goal.save();

      broadcast({
        type: "goalUpdate",
        goal,
      });
    }

    // Always send the tip alert
    const alertMessage = {
      type: "tipAlert",
      name: tip.name || "Anonymous",
      amount: Number(tip.amount) || 0,
      currency: tip.currency,
      message: tip.message || "",
      memeSound: tip.memeSound || null,
      convertedAmount: amount,
    };

    broadcast(alertMessage);

  } catch (error) {
    console.error("Failed to broadcast tip:", error);
  }
};