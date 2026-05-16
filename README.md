# AI-powered RAG Search application

A Next.js RAG application backed by Supabase + pgvector and Ollama.

## Development

```bash
npm install
npm run dev
```

## Existing commands

```bash
npm run build
npm run lint
npm run process:pending
npm run test:e2e
```

## Quantitative RAG evaluation pipeline

This repository includes a quantitative evaluation pipeline for retrieval and generation quality.

### Dataset and config

- Dataset: `src/evals/data/evalDataset.json`
- Config and thresholds: `src/evals/config.json`
- Baseline metrics: `src/evals/baselines/default.json`

### Run evaluations

```bash
npm run eval:retrieval   # retrieval-only metrics (Recall@k, Precision@k, MRR, hit rate)
npm run eval:generation  # retrieval + answer quality scoring
npm run eval:rag         # full quantitative pipeline and threshold gates
npm run eval:baseline    # capture/update baseline metrics
npm run eval:rag:pr      # smaller PR subset
```

### Metrics and gating

- Retrieval metrics: Recall@k, Precision@k, MRR, hit rate
- Generation metrics: correctness, faithfulness, relevance, hallucination rate
- Combined overall score with weighted retrieval/generation components
- Threshold and drift checks fail runs when quality drops below configured gates

### Reports and artifacts

Each run writes JSON/CSV artifacts under:

- `src/evals/reports/latest-summary.json`
- `src/evals/reports/latest-retrieval.csv`
- `src/evals/reports/latest-generation.csv`

Timestamped snapshots are also generated for regression comparison.

### CI automation

GitHub Actions workflow: `.github/workflows/rag-eval.yml`

- Pull requests run the `pr` subset and publish metric deltas.
- Main branch pushes and nightly schedule run the full eval suite.
- Reports are uploaded as workflow artifacts for historical comparison.

### Required environment variables

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OLLAMA_BASE_URL`
- `OLLAMA_MODEL` (optional override)

> The evaluator seeds temporary eval documents into the `documents` table, computes metrics, writes reports, then cleans up seeded rows automatically.
