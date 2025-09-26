// --- books.js: Returns a list of books grouped by title ---
import fs from "fs";
import path from "path";

export default function handler(req, res) {
  const dataPath = path.resolve("./data/books.json");
  const books = fs.existsSync(dataPath)
    ? JSON.parse(fs.readFileSync(dataPath, "utf8"))
    : [];
  // Group by bookTitle and count chunks
  const grouped = {};
  books.forEach((b) => {
    if (!grouped[b.bookTitle]) grouped[b.bookTitle] = { bookTitle: b.bookTitle, count: 0 };
    grouped[b.bookTitle].count++;
  });
  res.status(200).json(Object.values(grouped));
}