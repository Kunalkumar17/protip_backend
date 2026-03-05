import { WebSocketServer } from "ws";

let clients = [];

export const initWebSocket = (server) => {
  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {
    console.log("WS client connected");

    clients.push(ws);

    ws.on("close", () => {
      clients = clients.filter(c => c !== ws);
    });
  });
};

export const broadcastTip = (tip) => {
  clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(JSON.stringify(tip));
    }
  });
};
