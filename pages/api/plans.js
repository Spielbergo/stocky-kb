// --- plans.js: Returns all saved marketing plans ---
import fs from "fs";
import path from "path";

export default function handler(req, res) {
  const dataPath = path.resolve("./data/plans.json");
  const plans = fs.existsSync(dataPath)
    ? JSON.parse(fs.readFileSync(dataPath, "utf8"))
    : [];
  res.status(200).json(plans);
}