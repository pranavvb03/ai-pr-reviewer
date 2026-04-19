import fs from "fs";
import process from "process";

import { reviewCode } from "./review.js";
import { reviewJsonSchema, reviewSchema } from "./schema.js";
import { redactSecrets } from "./utils/redact-secrets.js";
import { failClosedResult } from "./utils/fail-closed-result.js";
import { postPRComment } from "./post-pr-comment.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Max characters to send to Gemini. ~12 000 chars ≈ ~3 000 tokens (safe buffer). */
const MAX_DIFF_CHARS = 12_000;

/** How many times to retry the Gemini call on transient failures before giving up. */
const MAX_RETRIES = 2;

/** Base delay in ms between retries — doubles each attempt (exponential backoff). */
const RETRY_BASE_DELAY_MS = 1500;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Reads and sanitises the diff text.
 * Handles both GitHub Actions mode (env var) and local CLI mode (stdin).
 *
 * @returns {string} Sanitised, length-capped diff text
 */
function getDiffText() {
  const isGitHubAction = process.env.GITHUB_ACTIONS === "true";

  let rawDiff;

  if (isGitHubAction) {
    rawDiff = process.env.PR_DIFF;
    if (!rawDiff) {
      throw new Error(
        "Running in GitHub Actions but PR_DIFF environment variable is empty. " +
          "Check the 'Export Diff' step in the workflow."
      );
    }
  } else {
    // Local CLI: read from stdin (e.g.  cat file.diff | node index.js)
    try {
      rawDiff = fs.readFileSync(0, "utf8");
    } catch {
      throw new Error(
        "Could not read from stdin. Usage: cat your.diff | node index.js"
      );
    }
  }

  if (!rawDiff || rawDiff.trim() === "") {
    throw new Error("Diff is empty. Nothing to review.");
  }

  const totalLines = rawDiff.split("\n").length;
  console.log(`📄 Raw diff: ${rawDiff.length.toLocaleString()} chars, ${totalLines.toLocaleString()} lines`);

  // 1. Redact secrets before they ever reach the network
  const redacted = redactSecrets(rawDiff);

  // Log how many secrets were caught so it's visible in the Actions log
  const redactedCount = (redacted.match(/\[REDACTED\]/g) || []).length;
  if (redactedCount > 0) {
    console.warn(`🔐 Redacted ${redactedCount} potential secret(s) from the diff.`);
  }

  // 2. Cap length — truncate at a line boundary to avoid splitting a diff hunk mid-way
  if (redacted.length > MAX_DIFF_CHARS) {
    const lines = redacted.split("\n");
    let truncated = "";
    for (const line of lines) {
      if ((truncated + line + "\n").length > MAX_DIFF_CHARS) break;
      truncated += line + "\n";
    }
    const keptLines = truncated.split("\n").length;
    console.warn(
      `⚠️  Diff truncated at line boundary — kept ${keptLines} of ${totalLines} lines (${truncated.length.toLocaleString()} chars).`
    );
    return truncated + "\n[... diff truncated for token limit ...]";
  }

  return redacted;
}

/**
 * Strips optional markdown code fences that some models add even in JSON mode.
 * e.g.  ```json\n{...}\n```  →  {...}
 *
 * @param {string} raw - Raw model output
 * @returns {string}   - Cleaned JSON string
 */
function stripCodeFences(raw) {
  return raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

/**
 * Calls reviewCode with exponential backoff retries on transient errors.
 * Retries on network errors and 5xx/429-style failures.
 * Does NOT retry on validation errors or empty diffs (permanent failures).
 *
 * @param {string} diffText
 * @param {object} jsonSchema
 * @returns {Promise<string>} Raw JSON string from the model
 */
async function reviewWithRetry(diffText, jsonSchema) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      return await reviewCode(diffText, jsonSchema);
    } catch (err) {
      lastError = err;
      const msg = err.message ?? "";
      const isTransient =
        msg.includes("503") ||
        msg.includes("429") ||
        msg.includes("UNAVAILABLE") ||
        msg.includes("network") ||
        msg.includes("timeout");

      if (!isTransient || attempt > MAX_RETRIES) {
        throw err;
      }

      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.warn(`⏳ Gemini call failed (attempt ${attempt}/${MAX_RETRIES + 1}): ${msg}`);
      console.warn(`   Retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError;
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

async function main() {
  const isGitHubAction = process.env.GITHUB_ACTIONS === "true";
  const startTime = Date.now();
  let validated;

  try {
    // Step 1 – acquire and sanitise diff
    const diffText = getDiffText();
    console.log(`📋 Diff ready — ${diffText.length.toLocaleString()} chars after sanitisation`);

    // Step 2 – call Gemini (with retry on transient failures)
    console.log("🤖 Sending diff to Gemini for review...");
    const geminiStart = Date.now();
    const rawResponse = await reviewWithRetry(diffText, reviewJsonSchema);
    console.log(`⏱  Gemini responded in ${Date.now() - geminiStart}ms`);

    // Step 3 – parse and validate response
    const cleaned = stripCodeFences(rawResponse);

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      // Log a snippet of the raw response to help debug unexpected model output
      console.error("❌ Failed to parse Gemini response as JSON.");
      console.error("   Raw response preview:", rawResponse.slice(0, 300));
      throw parseErr;
    }

    validated = reviewSchema.parse(parsed);

    const findingsSummary =
      validated.findings.length > 0
        ? `${validated.findings.length} finding(s)`
        : "no findings";
    console.log(
      `✅ Review complete — verdict: ${validated.verdict.toUpperCase()}, ` +
        `risk: ${validated.risk_score}/100, ${findingsSummary}`
    );
  } catch (error) {
    console.error("❌ Review pipeline error:", error instanceof Error ? error.message : error);
    validated = failClosedResult(error);
  }

  // Step 4 – output
  if (isGitHubAction) {
    await postPRComment(validated);

    // Exit with non-zero if verdict is "fail" — enables branch protection to block the merge
    if (validated.verdict === "fail") {
      console.error("🚫 Verdict is FAIL — exiting with code 1 to block the PR.");
      process.exit(1);
    }
  } else {
    // Local output: pretty-print JSON for easy inspection in the terminal
    console.log(JSON.stringify(validated, null, 2));
  }

  console.log(`🏁 Total pipeline time: ${Date.now() - startTime}ms`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});