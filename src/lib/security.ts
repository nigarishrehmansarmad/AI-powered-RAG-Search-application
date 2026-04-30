const AUTH_COOKIE_NAME = "rag_access";

const MAX_UPLOAD_SIZE_BYTES =
  Number(process.env.MAX_UPLOAD_SIZE_MB ?? "10") * 1024 * 1024;
const MAX_QUERY_LENGTH = Number(process.env.MAX_QUERY_LENGTH ?? "500");
const MAX_EXTRACTED_TEXT_LENGTH = Number(
  process.env.MAX_EXTRACTED_TEXT_LENGTH ?? "200000",
);
const MAX_CHUNKS_PER_DOCUMENT = Number(
  process.env.MAX_CHUNKS_PER_DOCUMENT ?? "100",
);

const RATE_LIMIT_STATE = new Map<string, { count: number; resetAt: number }>();

const ALLOWED_EXTENSIONS = new Set(["pdf", "docx", "txt"]);

function parseCookies(cookieHeader: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) {
    return cookies;
  }

  cookieHeader.split(";").forEach((part) => {
    const index = part.indexOf("=");
    if (index === -1) {
      return;
    }

    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) {
      cookies[name] = value;
    }
  });

  return cookies;
}

function getAuthSecret(): string {
  return process.env.RAG_APP_PASSWORD?.trim() ?? "";
}

export function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

export function isAuthenticatedRequest(req: Request): boolean {
  const secret = getAuthSecret();
  if (!secret) {
    return false;
  }

  const cookies = parseCookies(req.headers.get("cookie"));
  return cookies[AUTH_COOKIE_NAME] === secret;
}

export function getAuthCookieName(): string {
  return AUTH_COOKIE_NAME;
}

export function sanitizeFileName(fileName: string): string {
  const sanitized = fileName
    .replace(/[\r\n"]/g, "")
    .replace(/[^a-zA-Z0-9._ ()-]/g, "_")
    .trim();

  return sanitized.slice(0, 255) || "document";
}

export function getFileExtension(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() || "";
}

export function validateUploadedFile(
  fileName: string,
  fileBuffer: Buffer,
): "pdf" | "docx" | "txt" {
  const extension = getFileExtension(fileName);
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error(
      "Unsupported file type. Please upload PDF, DOCX, or TXT files.",
    );
  }

  if (extension === "pdf") {
    if (fileBuffer.subarray(0, 5).toString("utf8") !== "%PDF-") {
      throw new Error("Invalid PDF file.");
    }
  }

  if (extension === "docx") {
    if (
      fileBuffer.length < 4 ||
      fileBuffer[0] !== 0x50 ||
      fileBuffer[1] !== 0x4b
    ) {
      throw new Error("Invalid DOCX file.");
    }
  }

  if (extension === "txt" && fileBuffer.includes(0x00)) {
    throw new Error("Invalid TXT file.");
  }

  return extension as "pdf" | "docx" | "txt";
}

export function isValidDocumentId(
  documentId: string | null,
): documentId is string {
  return Boolean(
    documentId &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        documentId,
      ),
  );
}

export function getClientIdentifier(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }

  const realIp = req.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }

  return "unknown";
}

export function checkRateLimit(
  req: Request,
  scope: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; retryAfterSeconds?: number } {
  const cookieValue =
    parseCookies(req.headers.get("cookie"))[AUTH_COOKIE_NAME] || "anon";
  const key = `${scope}:${getClientIdentifier(req)}:${cookieValue}`;
  const now = Date.now();
  const current = RATE_LIMIT_STATE.get(key);

  if (!current || current.resetAt <= now) {
    RATE_LIMIT_STATE.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  current.count += 1;
  RATE_LIMIT_STATE.set(key, current);

  if (current.count <= limit) {
    return { allowed: true };
  }

  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
  };
}

export function ensureQueryWithinLimit(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error("Query is required");
  }

  if (trimmed.length > MAX_QUERY_LENGTH) {
    throw new Error(
      `Query is too long. Maximum length is ${MAX_QUERY_LENGTH} characters.`,
    );
  }

  return trimmed;
}

export function ensureTextWithinLimit(text: string): string {
  if (text.length > MAX_EXTRACTED_TEXT_LENGTH) {
    throw new Error(
      `Extracted text is too large. Maximum length is ${MAX_EXTRACTED_TEXT_LENGTH} characters.`,
    );
  }

  return text;
}

export function ensureChunkCountWithinLimit(chunkCount: number): void {
  if (chunkCount > MAX_CHUNKS_PER_DOCUMENT) {
    throw new Error(
      `Document is too large to process safely. Maximum chunk count is ${MAX_CHUNKS_PER_DOCUMENT}.`,
    );
  }
}

export function getMaxUploadSizeBytes(): number {
  return MAX_UPLOAD_SIZE_BYTES;
}

export function safeErrorMessage(fallback: string): string {
  return fallback;
}
