import { createClient } from '@supabase/supabase-js';
import { Ollama } from 'ollama';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!
);

// Initialize Ollama
const ollama = new Ollama({
  host: process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
});

export async function POST(req: Request) {
  try {
    const { query } = await req.json();

    // Generate embedding for the user's query using Ollama
    // This converts the search query into the same vector space as document chunks
    const embeddingResponse = await ollama.embeddings({
      model: 'nomic-embed-text',
      prompt: query,
    });

    // Find similar documents using vector similarity search
    // The match_documents function finds the 5 most similar chunks
    const { data: results, error } = await supabase.rpc('match_documents', {
      query_embedding: JSON.stringify(embeddingResponse.embedding),
      match_threshold: 0.0,  // Accept any similarity (you can increase this for stricter matching)
      match_count: 5,        // Return top 5 most similar chunks
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Combine retrieved chunks into context
    // These chunks will be used as context for the AI to generate an answer
    const context = results?.map((r: any) => r.content).join('\n---\n') || '';

    // Generate answer using Ollama with retrieved context
    // This is the "Generation" part of RAG
    const modelName = process.env.OLLAMA_MODEL || 'llama3.2';
    
    const chatResponse = await ollama.chat({
      model: modelName,
      messages: [
        { 
          role: 'system', 
          content: 'You are a helpful assistant. Use the provided context to answer questions. If the answer is not in the context, say you do not know.' 
        },
        { 
          role: 'user', 
          content: `Context: ${context}\n\nQuestion: ${query}` 
        }
      ],
    });

    return NextResponse.json({ 
      answer: chatResponse.message.content, 
      sources: results 
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}