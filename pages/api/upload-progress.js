import { getProgress } from "./progressStore";

export default function handler(req, res) {
  const { key } = req.query;

  if (!key) return res.status(400).end("Missing key");

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const sendProgress = () => {
    const progress = getProgress(key);
    res.write(`data: ${JSON.stringify(progress)}\n\n`);
  };

  const interval = setInterval(sendProgress, 1000);

  req.on("close", () => {
    clearInterval(interval);
  });
}
