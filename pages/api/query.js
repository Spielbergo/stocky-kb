import { getDb } from "../../lib/firebase";
import { cosineSimilarity } from "../../lib/math";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embedder = genAI.getGenerativeModel({ model: "gemini-embedding-001" });

export default async function handler(req, res) {
  const { userPrompt, platform, sourceOption, stockContext, geminiModel, profile } = req.body;
  const activeProfile = profile || "stocks";
  const bookProfile = activeProfile;

  let context = "";
  const db = getDb();

if (sourceOption === "mydata") {
  const snapshot = await db.collection('book_chunks').get();
  const chunks = snapshot.docs
    .map(doc => doc.data())
    .filter(d => (d.profile || 'stocks') === bookProfile);

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
  const snapshot = await db.collection('book_chunks').get();
  const chunks = snapshot.docs
    .map(doc => doc.data())
    .filter(d => (d.profile || 'stocks') === bookProfile);

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

  const model = genAI.getGenerativeModel({ model: geminiModel || "gemini-2.5-flash" });

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

