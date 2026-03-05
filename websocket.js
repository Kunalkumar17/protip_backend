import { WebSocketServer } from "ws";

let clients = [];
let currentGoalTotal = 0; // keeps running total

export const initWebSocket = (server) => {
  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {
    console.log("WS client connected");

    clients.push(ws);

    // send current goal to new overlay
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

export const broadcastTip = (tipAmount) => {
  currentGoalTotal += tipAmount;

  const message = JSON.stringify({
    type: "goalUpdate",
    total: currentGoalTotal
  });

  clients.forEach(client => {
    if (client.readyState === client.OPEN) {
      client.send(message);
    }
  });
};