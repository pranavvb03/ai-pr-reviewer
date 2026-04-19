/**
 * Returns a safe "fail-closed" review result when the model response
 * cannot be parsed or validated. This ensures the pipeline never silently
 * passes a PR due to an AI or validation failure.
 *
 * @param {unknown} error - The caught error
 * @returns {import('../schema.js').ReviewResult}
 */
export function failClosedResult(error) {
  const message = error instanceof Error ? error.message : String(error);

  return {
    verdict: "fail",
    risk_score: 100,
    summary:
      "The AI review pipeline encountered an error and could not produce a valid structured response. " +
      "This PR is blocked as a precaution (fail-closed policy).",
    findings: [
      {
        id: "F000",
        title: "Review Pipeline Error",
        category: "other",
        severity: "high",
        summary:
          "The model output did not pass schema validation. This may indicate a model error, " +
          "an unexpected response format, or a prompt injection that disrupted the output.",
        file_path: "N/A",
        line_number: 0,
        evidence: message.slice(0, 500), // cap to avoid leaking huge stack traces
        recommendations:
          "Re-run the review. If this persists, inspect the raw model output in the Actions log " +
          "and verify the schema contract has not changed.",
      },
    ],
    suggestions: [
      "Check the GEMINI_MODEL environment variable points to a supported model.",
      "Verify GEMINI_API_KEY is valid and has quota remaining.",
      "Inspect the raw model output in the GitHub Actions logs for clues.",
    ],
    stats: {
      files_changed: 0,
      issues_found: 1,
      critical_count: 0,
      high_count: 1,
      medium_count: 0,
      low_count: 0,
    },
  };
}