import { WebSocketServer } from "ws";

let clients = [];
let currentGoalTotal = 0;

export const initWebSocket = (server) => {
  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {
    console.log("WS client connected");

    clients.push(ws);

    // Send current goal to new overlays
    ws.send(JSON.stringify({
      type: "goalInit",
      total: currentGoalTotal
    }));

    ws.on("close", () => {
      clients = clients.filter(c => c !== ws);
      console.log("WS client disconnected");
    });
  });
};

export const broadcastTip = (tip) => {

  const amount = Number(tip.amount) || 0;

  currentGoalTotal += amount;

  const alertMessage = {
    type: "tipAlert",
    name: tip.name || "Anonymous",
    amount: amount,
    message: tip.message || ""
  };

  const goalMessage = {
    type: "goalUpdate",
    total: currentGoalTotal
  };

  clients.forEach(client => {
    if (client.readyState === client.OPEN) {

      // Send tip alert
      client.send(JSON.stringify(alertMessage));

      // Send goal update
      client.send(JSON.stringify(goalMessage));
    }
  });
};