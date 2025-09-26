// --- remove-plan.js: Deletes a marketing plan by id (DELETE) ---
import fs from "fs";
import path from "path";

export default function handler(req, res) {
  if (req.method !== "DELETE") return res.status(405).end();
  const { id } = req.query;
  const dataPath = path.resolve("./data/plans.json");
  const plans = fs.existsSync(dataPath)
    ? JSON.parse(fs.readFileSync(dataPath, "utf8"))
    : [];
  const filtered = plans.filter((p) => String(p.id) !== String(id));
  fs.writeFileSync(dataPath, JSON.stringify(filtered, null, 2));
  res.status(200).json({ message: "Plan removed" });
}