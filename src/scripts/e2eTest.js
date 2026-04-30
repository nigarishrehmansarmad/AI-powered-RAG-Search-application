const fs = require("node:fs");
const path = require("node:path");

async function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function main() {
  const base = process.env.BASE_URL || "http://localhost:3000";

  // Upload sample file
  const filePath = path.join(__dirname, "sample.txt");
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(
      filePath,
      "This is a sample document about Acme Corporation policies.",
    );
  }

  const form = new FormData();
  form.append("file", fs.createReadStream(filePath));

  console.log("Uploading sample file...");
  const uploadRes = await fetch(`${base}/api/upload`, {
    method: "POST",
    body: form,
  });
  const uploadBody = await uploadRes.json().catch(() => ({}));
  console.log("Upload response:", uploadBody);

  if (!uploadBody.documentId) {
    console.error("Upload did not return a documentId; aborting.");
    process.exit(1);
  }

  const docId = uploadBody.documentId;

  // Poll for document to appear in listing
  console.log("Polling for document to be available...");
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${base}/api/documents`);
    const body = await res.json().catch(() => ({}));
    const docs = body.documents || [];
    if (docs.find((d) => d.id === docId)) {
      console.log("Document visible in list.");
      break;
    }
    await sleep(1000);
  }

  // Run a simple search
  console.log("Running a simple search...");
  const qRes = await fetch(`${base}/api/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "What is this document about?" }),
  });
  const qBody = await qRes.json().catch(() => ({}));
  console.log("Search response:", qBody);

  if (qBody.answer) {
    console.log("E2E test succeeded: received answer.");
    process.exit(0);
  } else {
    console.error("E2E test failed: no answer returned.");
    process.exit(2);
  }
}

void main();
