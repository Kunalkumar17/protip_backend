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

  console.log(tipAmount)

  const amount = Number(tipAmount.amount) || 0;
  console.log(amount)

  currentGoalTotal = Number(currentGoalTotal) || 0;
  console.log(currentGoalTotal)

  currentGoalTotal += amount;
  console.log(currentGoalTotal);
  

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