# RAG Search App — Project Context

## What This Is

A full-stack **Retrieval-Augmented Generation (RAG)** application built with Next.js. Users upload documents (PDF, DOCX, TXT), the app embeds them into a vector database, and then answers natural-language queries by retrieving relevant chunks and passing them to a local LLM.

All AI inference runs locally via **Ollama** — no OpenAI or external LLM API calls at runtime (despite the `@langchain/openai` dependency in package.json).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js (App Router) with React 19 |
| Styling | Tailwind CSS v4 |
| Database | Supabase (PostgreSQL + pgvector) |
| File Storage | Supabase Storage |
| Embeddings | Ollama `nomic-embed-text` |
| LLM | Ollama `llama3.2` |
| Doc Parsing | `pdf2json` (PDF), `mammoth` (DOCX) |
| Chunking | LangChain `RecursiveCharacterTextSplitter` |
| Auth | Custom cookie-based (no NextAuth) |
| Linting | Biome |

---

## Directory Map

```
src/
├── app/
│   ├── layout.tsx                  # Root layout, Geist fonts
│   ├── page.tsx                    # Search UI (main page)
│   ├── login/page.tsx              # Password login
│   ├── documents/page.tsx          # Document management
│   └── api/
│       ├── auth/route.ts           # GET/POST/DELETE auth
│       ├── upload/route.ts         # File upload + embedding pipeline
│       ├── search/route.ts         # RAG query endpoint
│       └── documents/route.ts      # List/view/delete documents
│   └── components/
│       ├── Navigation.tsx          # Top nav with logout
│       ├── UploadModal.tsx         # Upload dialog
│       └── PDFViewerModal.tsx      # Document preview (iframe + text tabs)
├── lib/
│   ├── security.ts                 # Auth, validation, rate limiting
│   └── ollama.ts                   # Ollama API wrappers
└── scripts/
    ├── processPendingDocs.ts       # Backfill classification/summary
    └── e2eTest.js                  # End-to-end test script

middleware.ts                       # Auth gate for all protected routes
```

---

## Data Flow

### Upload Pipeline
```
File input
  → validateUploadedFile() [magic byte check, size limit]
  → Text extraction [pdf2json / mammoth / raw text]
  → ensureTextWithinLimit() [200,000 char cap]
  → RecursiveCharacterTextSplitter [800 char chunks, 100 overlap]
  → ensureChunkCountWithinLimit() [100 chunk cap]
  → classifyDocument() [Ollama — optional]
  → summarizeDocument() [Ollama — optional]
  → generateEmbedding() per chunk [Ollama nomic-embed-text]
  → Supabase Storage [original file]
  → Supabase DB [document_chunks table with embeddings]
```

### Search (RAG) Pipeline
```
User query
  → ensureQueryWithinLimit() [500 char cap]
  → generateEmbedding(query) [Ollama nomic-embed-text]
  → match_documents() RPC [pgvector cosine similarity, top 5]
  → Assemble context [12KB cap]
  → generateChatResponse(query, context) [Ollama llama3.2]
  → Return answer + source citations
```

### Authentication Flow
```
Request
  → middleware.ts checks auth cookie
  → Protected paths: /, /documents, /api/*
  → Public paths: /login, /api/auth, /_next/*, /favicon.ico
  → Invalid cookie → redirect to /login?next=<returnURL>
```

---

## Key Environment Variables

```bash
NEXT_PUBLIC_SUPABASE_URL          # Supabase project URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY  # Supabase anon key
SUPABASE_SERVICE_ROLE_KEY         # Supabase service role (server-only)
OLLAMA_BASE_URL                   # Default: http://localhost:11434
OLLAMA_MODEL                      # Default: llama3.2
RAG_APP_PASSWORD                  # Single shared password for all users
MAX_UPLOAD_SIZE_MB                # Default: 10
MAX_QUERY_LENGTH                  # Default: 500
MAX_EXTRACTED_TEXT_LENGTH         # Default: 200,000
MAX_CHUNKS_PER_DOCUMENT           # Default: 100
```

---

## Security Model

| Mechanism | Implementation |
|---|---|
| Auth | httpOnly, Secure, SameSite=Strict cookie (`rag_access`) |
| Session duration | 12 hours |
| Rate limiting | In-memory, per scope + client IP |
| File type validation | Magic byte inspection (not just extension) |
| Filename sanitization | Strips special chars, max 255 chars |
| Query injection | Mitigated by length limit + untrusted-context system prompt |
| File downloads | X-Content-Type-Options: nosniff + Content-Disposition |

**Rate limits by scope:**
- Login: 10 attempts / 15 min
- Upload: 3 uploads / 10 min
- Search: 20 requests / 1 min
- Delete: 10 deletes / 1 min

---

## Supabase Schema (inferred)

```sql
-- document_chunks table
id            uuid PRIMARY KEY
document_id   uuid              -- groups chunks from same file
file_name     text
source        text              -- storage path
content       text              -- chunk text
embedding     vector(?)         -- from nomic-embed-text
metadata      jsonb             -- classification, summary, chunk_index, etc.
created_at    timestamptz

-- match_documents RPC (pgvector)
-- performs cosine similarity search, returns top-k chunks
```

---

## Technical Criticisms

### Critical Issues

**1. In-memory rate limiting resets on restart**
`checkRateLimit()` in `security.ts` stores state in a module-level `Map`. Any app restart (deploy, crash, Vercel cold start) wipes all rate limit state. An attacker can bypass limits by triggering a restart or simply waiting for a cold start. For production, this must be backed by Redis or Supabase.

**2. No atomic upload transaction**
In `upload/route.ts`, the file is first written to Supabase Storage, then chunk rows are inserted into the DB. If the DB insert fails after storage upload succeeds, an orphaned file is left in storage with no way to clean it up automatically. Needs either a cleanup step on failure or a two-phase commit approach.

**3. Single shared password for all users**
`RAG_APP_PASSWORD` is one password for everyone. There is no concept of user identity, so there's no audit trail, no per-user document isolation, and no ability to revoke access for one person without changing the password for everyone. Fine for a private single-user tool, a liability for anything shared.

**4. e2eTest.js bypasses authentication**
The end-to-end test script (`scripts/e2eTest.js`) calls `/api/upload` and `/api/documents` without any auth cookie. This means either the test only works with auth disabled (not representative of production) or the middleware is being bypassed in test mode — which would be a security hole if the test target is a real deployment.

---

### Significant Issues

**5. Sequential chunk embedding is slow**
Each chunk's embedding is generated one at a time in a `for` loop. For a document near the 100-chunk limit, this means 100 sequential HTTP calls to Ollama. These are trivially parallelizable with `Promise.all()`, which could cut upload time by 5–10x.

**6. `@langchain/openai` is an unused dependency**
The package is in `package.json` but the app never calls OpenAI. This adds ~200KB to the bundle and signals future intent that was never implemented. It should be removed until actually needed.

**7. processPendingDocs.ts metadata overwrite risk**
When backfilling classification/summary for existing documents, the script sets `metadata` to `{ classification, summary }` — overwriting whatever was already in the metadata JSONB field. Any other fields (e.g. `chunk_index`, `file_type`) stored in metadata would be silently lost.

**8. No database migration files**
The Supabase schema (tables, pgvector extension, `match_documents` RPC) exists only in the hosted Supabase project — there are no SQL migration files in the repo. This makes the project impossible to reproduce from source alone and fragile to schema changes.

---

### Minor / Design Issues

**9. PDF preview relies on browser built-in**
`PDFViewerModal.tsx` renders PDFs in an `<iframe>` pointing at the file URL. This works in Chrome/Edge but fails silently in Firefox (which prompts for download) and Safari (inconsistent). A proper viewer like `react-pdf` or `pdf.js` would be reliable.

**10. Prompt injection is under-mitigated**
The search query is interpolated directly into the LLM prompt string. The system prompt says context is untrusted, but the query itself (up to 500 chars) is also untrusted and could contain injection instructions. Input-side filtering (e.g. stripping instruction-like patterns) or a structured prompt format would help.

**11. No streaming for LLM responses**
`generateChatResponse()` waits for the full Ollama response before returning. For llama3.2 generating a long answer, this could mean 10–30 seconds of silence on the frontend. Ollama supports streaming; using it with Next.js streaming responses would dramatically improve perceived performance.

**12. Chunking parameters are hardcoded**
Chunk size (800) and overlap (100) are constants in the upload route, not configurable via environment variables. Different document types benefit from different chunking strategies — dense legal text vs. conversational transcripts, for example.

**13. Client-side Supabase key exposed**
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` is the anon key, visible in the browser bundle. This is normal for Supabase apps but means Supabase Row-Level Security (RLS) policies are the only thing preventing unauthorized direct DB access. Given that there are no user identities, RLS cannot be scoped per user.

**14. No pagination on documents list**
`documents/page.tsx` fetches all documents in one request. With hundreds of documents, this becomes a slow, large response. The table UI has no pagination controls implemented.

---

## What Works Well

- Clean separation between security logic (`security.ts`) and route handlers
- Magic byte validation rather than just file extension checks
- Graceful degradation when Ollama classification/summarization fails
- Content-Disposition and X-Content-Type-Options on file downloads
- System prompt explicitly flagging context as potentially untrusted
- Biome for consistent formatting without ESLint complexity
- The `processPendingDocs` backfill script is a practical operational tool

---

## Running the App

```bash
# Prerequisites
# 1. Ollama running locally with models pulled:
#    ollama pull llama3.2
#    ollama pull nomic-embed-text
# 2. Supabase project with pgvector and match_documents RPC set up
# 3. .env.local populated

npm install
npm run dev          # development
npm run build        # production build
npm run process:pending   # backfill missing classification/summary
npm run test:e2e     # end-to-end test (note: auth bypass issue)
```