import fs from "fs";
import path from "path";
import { cosineSimilarity } from "../../lib/math";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embedder = genAI.getGenerativeModel({ model: "embedding-001" });

export default async function handler(req, res) {
  const { userPrompt, platform, sourceOption, stockContext } = req.body;

  let context = "";

if (sourceOption === "mydata") {
  const chunksPath = path.join(process.cwd(), "data", "books.json");
  const chunks = JSON.parse(fs.readFileSync(chunksPath, "utf8"));

  const result = await embedder.embedContent({
    content: { parts: [{ text: userPrompt }] },
  });
  const promptEmbedding = result.embedding.values;

  const scored = chunks.map((chunk) => ({
    ...chunk,
    score: cosineSimilarity(promptEmbedding, chunk.embedding),
  }));

  const topChunks = scored.sort((a, b) => b.score - a.score).slice(0, 5);

  context = topChunks
    .map(
      (c, i) => `Source ${i + 1} (Score: ${c.score.toFixed(4)}):\n${c.text}`
    )
    .join("\n\n");
  } else if (sourceOption === "model") {
    context = ""; // No user data, rely fully on the model
  } else {
  // Combine both
  const chunksPath = path.join(process.cwd(), "data", "books.json");
  const chunks = JSON.parse(fs.readFileSync(chunksPath, "utf8"));

  const result = await embedder.embedContent({
      content: { parts: [{ text: userPrompt }] },
  });
  const promptEmbedding = result.embedding.values;

  const scored = chunks.map((chunk) => ({
      ...chunk,
      score: cosineSimilarity(promptEmbedding, chunk.embedding),
  }));

  const topChunks = scored.sort((a, b) => b.score - a.score).slice(0, 5);

  context = topChunks
      .map((c, i) => `Source ${i + 1} (Score: ${c.score.toFixed(4)}):\n${c.text}`)
      .join("\n\n");
  }

    let fullPrompt = `
    You are a helpful assistant.

    Use the ${
      sourceOption === "model" ? "best of your own knowledge" : "following source material"
    } to answer the user's question or fulfill their request.

    User Request:
    "${userPrompt}"

    ${sourceOption !== "model" ? `Source material:\n${context}` : ""}
    `.trim();

    if (stockContext) {
      fullPrompt += `\n\nStock historical data summary:\n${stockContext}`;
    }

  const model = genAI.getGenerativeModel({ model: "models/gemini-2.0-flash" });

  try {
    const response = await model.generateContent(fullPrompt);
    const text = response.response.text();
    const wordCount = text.trim().split(/\s+/).length;

    res.status(200).json({ 
        response: text,
        wordCount: wordCount
    });
    } catch (err) {
    res.status(500).json({ error: err.message || "Error generating content." });
  }
}

