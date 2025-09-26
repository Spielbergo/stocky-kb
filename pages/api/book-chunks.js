// --- book-chunks.js: Returns all chunks for a given book title ---
import fs from "fs";
import path from "path";

export default function handler(req, res) {
  const { title } = req.query;
  const dataPath = path.resolve("./data/books.json");
  const books = fs.existsSync(dataPath)
    ? JSON.parse(fs.readFileSync(dataPath, "utf8"))
    : [];
  const chunks = books.filter((b) => b.bookTitle === title);
  res.status(200).json(chunks);
}