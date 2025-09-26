import { GoogleGenerativeAI } from "@google/generative-ai";

export const config = {
  runtime: "edge", // Required for streaming
};

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response("Only POST requests allowed", { status: 405 });
  }

  const { platform, userPrompt, sourceOption, messages } = await req.json();

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-pro" });

  let systemPrompt;
  if (!messages || messages.length <= 1) {
    // Initial prompt
    systemPrompt = ``;
  } else {
    // Follow-up/refinement prompt
    systemPrompt = ``;
  }

  const chatHistory = [
    { role: "system", parts: [{ text: systemPrompt }] },
    ...(messages
      ? messages.map(m => ({
          role: m.role,
          parts: [{ text: m.content }]
        }))
      : [{ role: "user", parts: [{ text: userPrompt }] }])
  ];

  const resultStream = await model.generateContentStream({
    contents: chatHistory,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for await (const chunk of resultStream.stream) {
        const text = chunk.text();
        controller.enqueue(encoder.encode(text));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
