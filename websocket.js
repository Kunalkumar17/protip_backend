import { WebSocketServer } from "ws";

let clients = [];

// Current active goal
let currentGoal = {
  name: "Monthly Goal",
  target: 10000,
  total: 0,
};

export const initWebSocket = (server) => {
  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {
    console.log("WS client connected");

    clients.push(ws);

    // Send current goal to new overlays
    ws.send(
      JSON.stringify({
        type: "goalInit",
        goal: currentGoal,
      })
    );

    ws.on("close", () => {
      clients = clients.filter((client) => client !== ws);
      console.log("WS client disconnected");
    });
  });
};


// Send message to all connected clients
const broadcast = (data) => {
  clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(JSON.stringify(data));
    }
  });
};


// Create / reset goal
export const setGoal = (name, target) => {
  currentGoal = {
    name: name || "New Goal",
    target: Number(target) || 0,
    total: 0,
  };

  broadcast({
    type: "goalInit",
    goal: currentGoal,
  });
};


// Reset current goal but keep its name and target
export const resetGoal = () => {
  currentGoal.total = 0;

  broadcast({
    type: "goalUpdate",
    goal: currentGoal,
  });
};


export const broadcastTip = (tip) => {
  const amount = Number(tip.convertedAmount) || 0;

  // Add to current goal
  currentGoal.total += amount;

  const alertMessage = {
    type: "tipAlert",
    name: tip.name || "Anonymous",
    amount: Number(tip.amount) || 0,
    currency: tip.currency,
    message: tip.message || "",
    memeSound: tip.memeSound || null,
    convertedAmount: amount,
  };

  const goalMessage = {
    type: "goalUpdate",
    goal: currentGoal,
  };

  broadcast(alertMessage);
  broadcast(goalMessage);
};