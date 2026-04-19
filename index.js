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

  // 1. Redact secrets before they ever reach the network
  const redacted = redactSecrets(rawDiff);

  // 2. Cap length to control token cost and model context limits
  if (redacted.length > MAX_DIFF_CHARS) {
    console.warn(
      `⚠️  Diff is ${redacted.length.toLocaleString()} chars — truncating to ${MAX_DIFF_CHARS.toLocaleString()} chars.`
    );
    return redacted.slice(0, MAX_DIFF_CHARS) + "\n\n[... diff truncated for token limit ...]";
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

// ─── Main pipeline ────────────────────────────────────────────────────────────

async function main() {
  const isGitHubAction = process.env.GITHUB_ACTIONS === "true";
  let validated;

  try {
    // Step 1 – acquire and sanitise diff
    const diffText = getDiffText();
    console.log(`📋 Diff ready — ${diffText.length.toLocaleString()} characters`);

    // Step 2 – call Gemini
    console.log("🤖 Sending diff to Gemini for review...");
    const rawResponse = await reviewCode(diffText, reviewJsonSchema);

    // Step 3 – parse and validate response
    const cleaned = stripCodeFences(rawResponse);
    const parsed = JSON.parse(cleaned);
    validated = reviewSchema.parse(parsed);

    console.log(`✅ Review complete — verdict: ${validated.verdict.toUpperCase()}, risk: ${validated.risk_score}/100`);
  } catch (error) {
    console.error("❌ Review pipeline error:", error instanceof Error ? error.message : error);
    validated = failClosedResult(error);
  }

  // Step 4 – output
  if (isGitHubAction) {
    await postPRComment(validated);

    // Exit with non-zero if verdict is "fail" — lets you block merges via required status checks
    if (validated.verdict === "fail") {
      console.error("🚫 Verdict is FAIL — exiting with code 1 to block the PR.");
      process.exit(1);
    }
  } else {
    // Local output: pretty-print JSON for inspection
    console.log(JSON.stringify(validated, null, 2));
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});