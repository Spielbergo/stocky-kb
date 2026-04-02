import { getDb } from "../../lib/firebase";
import { cosineSimilarity } from "../../lib/math";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getCachedChunks } from "../../lib/chunk-cache";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embedder = genAI.getGenerativeModel({ model: "gemini-embedding-001" });

export default async function handler(req, res) {
  const { userPrompt, platform, sourceOption, stockContext, geminiModel, profile } = req.body;
  const activeProfile = profile || "stocks";
  const bookProfile = activeProfile;

  let context = "";
  const db = getDb();

if (sourceOption === "mydata") {
  const allChunks = await getCachedChunks(db);
  const chunks = allChunks.filter(d => d.profile === bookProfile);

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
  const allChunks = await getCachedChunks(db);
  const chunks = allChunks.filter(d => d.profile === bookProfile);

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

    let fullPrompt;

    if (sourceOption === "model") {
      fullPrompt = `
    You are a helpful assistant.
    Use the best of your own knowledge to answer the user's question or fulfill their request.

    User Request:
    "${userPrompt}"
      `.trim();
    } else if (context.trim() === "") {
      // "mydata" or "combined" selected but no books uploaded for this profile
      fullPrompt = `
    You are a helpful assistant.
    The user has selected "Use my data only" but no source material has been uploaded for this profile yet.
    You must inform the user that no data is available for this profile and suggest they upload relevant documents in the Admin panel.
    Do not answer the question from your own general knowledge.

    User Request:
    "${userPrompt}"
      `.trim();
    } else {
      fullPrompt = `
    You are a helpful assistant.
    Use ONLY the following source material to answer the user's question. Do not use outside knowledge.

    User Request:
    "${userPrompt}"

    Source material:
    ${context}
      `.trim();
    }

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
    const isQuota = err?.message?.includes('RESOURCE_EXHAUSTED') || err?.message?.includes('Quota exceeded') || err?.status === 429;
    if (isQuota) {
      return res.status(429).json({ error: 'Service is temporarily over capacity due to high usage. Please try again in a few minutes.' });
    }
    res.status(500).json({ error: err.message || "Error generating content." });
  }
}

