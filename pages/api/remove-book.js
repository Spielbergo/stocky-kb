// --- remove-book.js: Deletes all chunks for a given book title (DELETE) ---
import fs from "fs";
import path from "path";

export default function handler(req, res) {
  if (req.method !== "DELETE") return res.status(405).end();
  const { title } = req.query;
  const dataPath = path.resolve("./data/books.json");
  const books = fs.existsSync(dataPath)
    ? JSON.parse(fs.readFileSync(dataPath, "utf8"))
    : [];
  const filtered = books.filter((b) => b.bookTitle !== title);
  fs.writeFileSync(dataPath, JSON.stringify(filtered, null, 2));
  res.status(200).json({ message: "Book removed" });
}