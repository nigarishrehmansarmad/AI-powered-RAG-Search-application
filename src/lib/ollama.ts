import { Ollama } from "ollama";

const ollama = new Ollama({
  host: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
});

export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await ollama.embeddings({
    model: "nomic-embed-text", // Specialized embedding model
    prompt: text,
  });

  return response.embedding;
}

export async function generateChatResponse(
  prompt: string,
  context: string,
): Promise<string> {
  const modelName = process.env.OLLAMA_MODEL || "llama3.2";

  const response = await ollama.chat({
    model: modelName,
    messages: [
      {
        role: "system",
        content:
          "You are a helpful assistant that answers questions based on the provided context. If the context doesn't contain relevant information, say so.",
      },
      {
        role: "user",
        content: `Context: ${context}\n\nQuestion: ${prompt}`,
      },
    ],
  });

  return response.message.content;
}

export async function classifyDocument(text: string): Promise<string> {
  const modelName = process.env.OLLAMA_MODEL || "llama3.2";

  const prompt = `Classify the following document into one of the categories: Invoice, Contract, Policy, Email, Memo, Report, Other. Output only the single label with no explanation.\n\nDocument:\n${text.slice(0, 4000)}`;

  const response = await ollama.chat({
    model: modelName,
    messages: [
      {
        role: "system",
        content: "You are a classifier that returns a single category label.",
      },
      { role: "user", content: prompt },
    ],
  });

  return String(response.message.content || "Other").trim();
}

export async function summarizeDocument(text: string): Promise<string> {
  const modelName = process.env.OLLAMA_MODEL || "llama3.2";

  const prompt = `Write a concise summary (2-4 sentences) of the following document. Be factual and keep it short.\n\nDocument:\n${text.slice(0, 15000)}`;

  const response = await ollama.chat({
    model: modelName,
    messages: [
      { role: "system", content: "You produce short factual summaries." },
      { role: "user", content: prompt },
    ],
  });

  return String(response.message.content || "").trim();
}
