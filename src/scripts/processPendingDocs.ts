import { createClient } from "@supabase/supabase-js";
import { classifyDocument, summarizeDocument } from "@/lib/ollama";
import { getRequiredEnv } from "@/lib/security";

async function main() {
  const url = getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(url, key);

  console.log("Scanning for documents missing classification/summary...");

  const { data: rows, error } = await supabase
    .from("documents")
    .select("metadata")
    .limit(1000);

  if (error) {
    console.error("Failed to list documents", error);
    process.exit(1);
  }

  const docMap = new Map<string, Record<string, unknown>>();
  for (const r of rows ?? []) {
    const m = r.metadata || {};
    if (m?.document_id && (!m.classification || !m.summary)) {
      docMap.set(m.document_id, m);
    }
  }

  if (docMap.size === 0) {
    console.log("No pending documents found.");
    return;
  }

  console.log(`Found ${docMap.size} documents to process.`);

  for (const [docId] of docMap) {
    try {
      // Fetch full text via documents API for reconstruction
      const base = process.env.BASE_URL || "http://localhost:3000";
      const res = await fetch(`${base}/api/documents?id=${docId}`);
      const body = await res.json();
      if (body.error) {
        console.warn(`Skipping ${docId}: ${body.error}`);
        continue;
      }

      const fullText = String(body.fullText || "");

      const classification = await classifyDocument(fullText).catch((e) => {
        console.error("Classification failed", e);
        return "Other";
      });

      const summary = await summarizeDocument(fullText).catch((e) => {
        console.error("Summarization failed", e);
        return "";
      });

      // Update all chunks for this document with classification and summary
      const { error: updateErr } = await supabase
        .from("documents")
        .update({ metadata: { classification, summary } })
        .eq("metadata->>document_id", docId);

      if (updateErr) {
        console.error(`Failed to update document ${docId}`, updateErr);
      } else {
        console.log(`Processed ${docId}: classification=${classification}`);
      }
    } catch (err) {
      console.error(`Error processing ${docId}`, err);
    }
  }
}

void main();
