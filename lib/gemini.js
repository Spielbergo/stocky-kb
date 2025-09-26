import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export const runGeminiPrompt = async (prompt, contextChunks = []) => {
  const model = genAI.getGenerativeModel({ model: "models/gemini-2.0-flash" });

  const context = contextChunks.map((chunk, i) => `Source ${i + 1}:\n${chunk}`).join("\n\n");

  const fullPrompt = `Use the following sources to generate a marketing strategy:\n\n${context}\n\nUser Request:\n${prompt}`;

  const result = await model.generateContent(fullPrompt);
  return result.response.text();
};
