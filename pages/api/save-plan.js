// --- save-plan.js: Saves a new marketing plan (POST) ---
import fs from "fs";
import path from "path";

export default function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const dataPath = path.resolve("./data/plans.json");
  const plans = fs.existsSync(dataPath)
    ? JSON.parse(fs.readFileSync(dataPath, "utf8"))
    : [];

  const newPlan = { id: Date.now(), ...req.body };
  plans.push(newPlan);

  fs.writeFileSync(dataPath, JSON.stringify(plans, null, 2));
  res.status(200).json({ message: "Plan saved" });
}