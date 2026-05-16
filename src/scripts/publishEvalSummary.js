/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const title = process.argv[2] || "Quantitative RAG Eval";
const summaryPath = path.resolve(
  process.argv[3] || "src/evals/reports/latest-summary.json",
);
const githubSummaryPath = process.env.GITHUB_STEP_SUMMARY;

if (!githubSummaryPath) {
  console.log("GITHUB_STEP_SUMMARY is not set; skipping summary publishing.");
  process.exit(0);
}

if (!fs.existsSync(summaryPath)) {
  fs.appendFileSync(githubSummaryPath, "No eval summary available.\n");
  process.exit(0);
}

const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
const deltas = summary.deltasFromBaseline || {};
const retrieval = summary.metrics?.retrieval || {};
const generation = summary.metrics?.generation || {};

const lines = [
  `## ${title}`,
  "",
  `Overall score: **${summary.metrics?.overallScore}** (delta: ${deltas.overallScore ?? "n/a"})`,
  "",
  `Retrieval Recall@k: ${retrieval.recallAtK}`,
  `Retrieval MRR: ${retrieval.mrr}`,
  `Generation Correctness: ${generation.correctness ?? "n/a"}`,
  `Generation Faithfulness: ${generation.faithfulness ?? "n/a"}`,
  `Hallucination Rate: ${generation.hallucinationRate ?? "n/a"}`,
];

fs.appendFileSync(githubSummaryPath, `${lines.join("\n")}\n`);
