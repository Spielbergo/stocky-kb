import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { IncomingForm } from "formidable";
import pdfParse from "pdf-parse";
import { setProgress, clearProgress } from "./progressStore";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const config = {
  api: { bodyParser: false },
};

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embedder = genAI.getGenerativeModel({ model: "embedding-001" });

const getEmbedding = async (text) => {
  const result = await embedder.embedContent({
    content: {
      parts: [{ text }],
    },
  });
  return result.embedding.values;
};

const readFile = async (filepath, mimetype) => {
  let content = "";

  if (mimetype === "application/pdf") {
    const buffer = fs.readFileSync(filepath);
    const data = await pdfParse(buffer);
    content = data.text;
  } else {
    content = fs.readFileSync(filepath, "utf8");
  }

  const words = content.split(/\s+/);
  const chunks = [];

  // Use smaller chunk size for stability (e.g., 300 words)
  for (let i = 0; i < words.length; i += 300) {
    let chunk = words.slice(i, i + 300).join(" ");
    chunk = chunk
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, "") // remove control chars
      .replace(/\s+/g, " ") // normalize whitespace
      .trim();
    chunks.push(chunk);
  }

  return chunks;
};


const parseForm = (req) =>
  new Promise((resolve, reject) => {
    const form = new IncomingForm({
      uploadDir: os.tmpdir(),
      keepExtensions: true,
    });

    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });

export default async function handler(req, res) {
  const { key } = req.query;

  if (key !== process.env.UPLOAD_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { fields, files } = await parseForm(req);
    const file = files.file[0];
    const mimetype = file.mimetype;
    const bookTitle = fields.bookTitle ? fields.bookTitle[0] : file.originalFilename;

    const chunks = await readFile(file.filepath, mimetype);

    const embeddedChunks = [];

    setProgress(key, { current: 0, total: chunks.length });

    for (let i = 0; i < chunks.length; i++) {
      const text = chunks[i];
      const embedding = await getEmbedding(text);
      embeddedChunks.push({
        id: randomUUID(),
        text,
        embedding,
        bookTitle, // <-- Add this line
      });
      setProgress(key, { current: i + 1, total: chunks.length });
    }

    clearProgress(key);

    console.log(`📚 Total chunks: ${chunks.length}, Embedded successfully: ${embeddedChunks.length}`);

    const dataPath = path.resolve("./data/books.json");
    const existing = fs.existsSync(dataPath)
      ? JSON.parse(fs.readFileSync(dataPath, "utf8"))
      : [];

    const updated = [...existing, ...embeddedChunks];
    fs.writeFileSync(dataPath, JSON.stringify(updated, null, 2));

    res.status(200).json({ message: "Book added", chunks: embeddedChunks.length });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "Server error" });
  }
}
