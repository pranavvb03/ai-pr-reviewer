import { z } from "zod";

// ─── Zod Schema (runtime validation) ────────────────────────────────────────

const severityEnum = z.enum(["none", "low", "medium", "high", "critical"]);
const verdictEnum = z.enum(["pass", "warn", "fail"]);
const categoryEnum = z.enum([
  "security",
  "performance",
  "maintainability",
  "correctness",
  "style",
  "dependency",
  "other",
]);

export const findingSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  category: categoryEnum,
  severity: severityEnum,
  summary: z.string().min(1),
  file_path: z.string(),
  line_number: z.number().int().nonnegative(),
  evidence: z.string(),
  recommendations: z.string().min(1),
  cwe_id: z.string().optional(),        // e.g. "CWE-89" for SQL injection
  owasp_category: z.string().optional(), // e.g. "A03:2021 Injection"
});

export const reviewSchema = z.object({
  verdict: verdictEnum,
  summary: z.string().min(1),
  risk_score: z.number().int().min(0).max(100),
  findings: z.array(findingSchema),
  suggestions: z.array(z.string()).optional(), // general improvement tips
  stats: z.object({
    files_changed: z.number().int().nonnegative(),
    issues_found: z.number().int().nonnegative(),
    critical_count: z.number().int().nonnegative(),
    high_count: z.number().int().nonnegative(),
    medium_count: z.number().int().nonnegative(),
    low_count: z.number().int().nonnegative(),
  }).optional(),
});

// ─── JSON Schema (sent to Gemini as the expected output contract) ─────────────

export const reviewJsonSchema = {
  type: "object",
  properties: {
    verdict: {
      type: "string",
      enum: ["pass", "warn", "fail"],
      description: "Overall verdict. 'pass' = safe, 'warn' = minor issues, 'fail' = critical issues found.",
    },
    summary: {
      type: "string",
      description: "A concise 2-3 sentence summary of the overall review.",
    },
    risk_score: {
      type: "number",
      description: "Integer risk score from 0 (safe) to 100 (critically dangerous).",
    },
    findings: {
      type: "array",
      description: "List of specific issues found in the diff.",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "Unique finding ID, e.g. F001, F002." },
          title: { type: "string", description: "Short title of the issue." },
          category: {
            type: "string",
            enum: ["security", "performance", "maintainability", "correctness", "style", "dependency", "other"],
          },
          severity: {
            type: "string",
            enum: ["none", "low", "medium", "high", "critical"],
          },
          summary: { type: "string", description: "Detailed explanation of the issue." },
          file_path: { type: "string", description: "File path where the issue was found. Use 'N/A' if unknown." },
          line_number: { type: "number", description: "Approximate line number. Use 0 if unknown." },
          evidence: { type: "string", description: "The specific code snippet or pattern that is problematic." },
          recommendations: { type: "string", description: "Specific, actionable fix recommendation." },
          cwe_id: { type: "string", description: "Optional CWE identifier, e.g. CWE-89." },
          owasp_category: { type: "string", description: "Optional OWASP Top 10 category, e.g. A03:2021 Injection." },
        },
        required: ["id", "title", "category", "severity", "summary", "file_path", "line_number", "evidence", "recommendations"],
        additionalProperties: false,
      },
    },
    suggestions: {
      type: "array",
      description: "Optional list of general improvement suggestions not tied to a specific finding.",
      items: { type: "string" },
    },
    stats: {
      type: "object",
      description: "Summary statistics for this review.",
      properties: {
        files_changed: { type: "number" },
        issues_found: { type: "number" },
        critical_count: { type: "number" },
        high_count: { type: "number" },
        medium_count: { type: "number" },
        low_count: { type: "number" },
      },
      required: ["files_changed", "issues_found", "critical_count", "high_count", "medium_count", "low_count"],
      additionalProperties: false,
    },
  },
  required: ["verdict", "summary", "risk_score", "findings"],
  additionalProperties: false,
};