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
