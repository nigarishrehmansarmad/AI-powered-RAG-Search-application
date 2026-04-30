import { createClient } from "@supabase/supabase-js";
import { Ollama } from "ollama";
import { NextResponse } from "next/server";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import mammoth from "mammoth";
import {
  checkRateLimit,
  ensureChunkCountWithinLimit,
  ensureTextWithinLimit,
  getMaxUploadSizeBytes,
  getRequiredEnv,
  isAuthenticatedRequest,
  sanitizeFileName,
  safeErrorMessage,
  validateUploadedFile,
} from "@/lib/security";

type PdfParserData = {
  Pages?: Array<{
    Texts?: Array<{
      R?: Array<{
        T?: string;
      }>;
    }>;
  }>;
};

type PdfParserError = {
  parserError?: string;
};

type PdfParserInstance = {
  on(
    event: "pdfParser_dataError",
    handler: (err: PdfParserError) => void,
  ): void;
  on(
    event: "pdfParser_dataReady",
    handler: (data: PdfParserData) => void,
  ): void;
  parseBuffer(buffer: Buffer): void;
};

type PdfParserConstructor = new (
  options: unknown,
  parseOneFile: boolean,
) => PdfParserInstance;

const url = getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const supabaseStorage = createClient(url, serviceKey);
const supabase = createClient(url, serviceKey);

// Initialize Ollama
const ollama = new Ollama({
  host: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
});

function safeDecodeURIComponent(str: string): string {
  try {
    return decodeURIComponent(str);
  } catch {
    try {
      return decodeURIComponent(str.replace(/%/g, "%25"));
    } catch {
      return str;
    }
  }
}

async function extractTextFromBuffer(
  buffer: Buffer,
  fileName: string,
): Promise<string> {
  const lowerFileName = fileName.toLowerCase();

  if (lowerFileName.endsWith(".pdf")) {
    const PDFParser = (await import("pdf2json")).default;
    return new Promise((resolve, reject) => {
      const pdfParser = new (PDFParser as PdfParserConstructor)(null, true);
      pdfParser.on("pdfParser_dataError", (err) =>
        reject(new Error(`PDF parsing error: ${err.parserError}`)),
      );
      pdfParser.on("pdfParser_dataReady", (pdfData) => {
        try {
          let fullText = "";
          for (const page of pdfData.Pages ?? []) {
            for (const text of page.Texts ?? []) {
              for (const r of text.R ?? []) {
                if (r.T) {
                  fullText += `${safeDecodeURIComponent(r.T)} `;
                }
              }
            }
          }
          resolve(fullText.trim());
        } catch (error: unknown) {
          const message =
            error instanceof Error
              ? error.message
              : "Unknown PDF parsing error";
          reject(new Error(`Error extracting text: ${message}`));
        }
      });
      pdfParser.parseBuffer(buffer);
    });
  } else if (lowerFileName.endsWith(".docx")) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } else if (lowerFileName.endsWith(".txt")) {
    return buffer.toString("utf-8");
  } else {
    throw new Error(
      "Unsupported file type. Please upload PDF, DOCX, or TXT files.",
    );
  }
}

export async function POST(req: Request) {
  try {
    if (!isAuthenticatedRequest(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(req, "upload", 3, 10 * 60 * 1000);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many uploads. Please try again later." },
        {
          status: 429,
          headers: rateLimit.retryAfterSeconds
            ? { "Retry-After": String(rateLimit.retryAfterSeconds) }
            : undefined,
        },
      );
    }

    const file = (await req.formData()).get("file") as File;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > getMaxUploadSizeBytes()) {
      return NextResponse.json({ error: "File is too large" }, { status: 413 });
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const validatedType = validateUploadedFile(file.name, fileBuffer);
    const safeFileName = sanitizeFileName(file.name);

    const text = await extractTextFromBuffer(fileBuffer, file.name);
    const normalizedText = ensureTextWithinLimit(text.trim());
    if (!normalizedText) {
      return NextResponse.json(
        { error: "Could not extract text from file" },
        { status: 400 },
      );
    }

    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 800,
      chunkOverlap: 100,
    });
    const chunks = await textSplitter.splitText(normalizedText);
    ensureChunkCountWithinLimit(chunks.length);

    const documentId = crypto.randomUUID();
    const uploadDate = new Date().toISOString();
    const filePath = `${documentId}.${validatedType}`;

    // Upload file to Supabase Storage
    const { error: storageError } = await supabaseStorage.storage
      .from("documents")
      .upload(filePath, fileBuffer, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

    if (storageError) {
      console.error("Failed to store file", storageError);
      return NextResponse.json(
        { success: false, error: "Failed to store file" },
        { status: 500 },
      );
    }

    // Process each chunk: generate embedding and store in database
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      // Generate embedding using Ollama
      // nomic-embed-text produces 768-dimensional vectors
      const embeddingResponse = await ollama.embeddings({
        model: "nomic-embed-text",
        prompt: chunk,
      });

      // Store chunk with embedding in database
      const { error } = await supabase.from("documents").insert({
        content: chunk,
        metadata: {
          source: safeFileName,
          document_id: documentId,
          file_name: safeFileName,
          file_type: validatedType,
          file_size: file.size,
          upload_date: uploadDate,
          chunk_index: i,
          total_chunks: chunks.length,
          file_path: filePath,
        },
        embedding: JSON.stringify(embeddingResponse.embedding),
      });

      if (error) {
        console.error("Failed to store document chunk", error);
        await supabaseStorage.storage.from("documents").remove([filePath]);
        return NextResponse.json(
          { success: false, error: "Failed to store document" },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({
      success: true,
      documentId,
      fileName: safeFileName,
      chunks: chunks.length,
      textLength: normalizedText.length,
    });
  } catch (error: unknown) {
    console.error("Upload processing failed", error);
    return NextResponse.json(
      { success: false, error: safeErrorMessage("Failed to process file") },
      { status: 500 },
    );
  }
}
