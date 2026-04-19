// Emoji maps for visual scanning in GitHub comments
const VERDICT_EMOJI = { pass: "✅", warn: "⚠️", fail: "❌" };
const SEVERITY_EMOJI = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🔵",
  none: "⚪",
};
const CATEGORY_EMOJI = {
  security: "🔒",
  performance: "⚡",
  maintainability: "🔧",
  correctness: "🐛",
  style: "🎨",
  dependency: "📦",
  other: "📝",
};

/**
 * Converts a validated review result into a rich GitHub Markdown comment.
 *
 * @param {object} review - Validated review result from Zod
 * @returns {string}      - Markdown string
 */
export function toMarkdown(review) {
  const { verdict, summary, risk_score, findings = [], suggestions = [], stats } = review;

  const verdictEmoji = VERDICT_EMOJI[verdict] ?? "❓";
  const riskStatus = getRiskStatusEmoji(risk_score ?? 0);

  let md = "";

  // ── Header ──────────────────────────────────────────────────────────────────
  md += `## ${verdictEmoji} AI PR Review — \`${verdict.toUpperCase()}\`\n\n`;
  md += `> Powered by Google Gemini \n\n`;

  // ── Risk score ───────────────────────────────────────────────────────────────
  if (risk_score !== undefined) {
    md += `**Risk Score:** ${risk_score}/100 ${riskStatus}\n\n`;
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  md += `**Summary:** ${summary}\n\n`;

  // ── Stats table ───────────────────────────────────────────────────────────────
  if (stats) {
    md += `<details>\n<summary>📊 Review Statistics</summary>\n\n`;
    md += `| Metric | Count |\n|--------|-------|\n`;
    md += `| Files changed | ${stats.files_changed} |\n`;
    md += `| Issues found | ${stats.issues_found} |\n`;
    md += `| 🔴 Critical | ${stats.critical_count} |\n`;
    md += `| 🟠 High | ${stats.high_count} |\n`;
    md += `| 🟡 Medium | ${stats.medium_count} |\n`;
    md += `| 🔵 Low | ${stats.low_count} |\n`;
    md += `\n</details>\n\n`;
  }

  // ── Findings ────────────────────────────────────────────────────────────────
  if (findings.length === 0) {
    md += `### ✅ No issues found\n\nThis diff looks clean. No security, correctness, or quality issues were detected.\n\n`;
  } else {
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, none: 4 };
    const sorted = [...findings].sort(
      (a, b) => (severityOrder[a.severity] ?? 5) - (severityOrder[b.severity] ?? 5)
    );

    md += `### 🔍 Findings (${findings.length})\n\n`;

    for (const f of sorted) {
      const sevEmoji = SEVERITY_EMOJI[f.severity] ?? "❓";
      const catEmoji = CATEGORY_EMOJI[f.category] ?? "📝";

      md += `<details>\n`;
      md += `<summary>${sevEmoji} <strong>[${f.id}] ${f.title}</strong> — ${catEmoji} ${f.category} · ${f.severity.toUpperCase()}</summary>\n\n`;
      md += `**Summary:** ${f.summary}\n\n`;
      md += `| Field | Value |\n|-------|-------|\n`;
      md += `| File | \`${f.file_path}\` |\n`;
      md += `| Line | ${f.line_number > 0 ? f.line_number : "N/A"} |\n`;

      if (f.cwe_id) {
        md += `| CWE | [${f.cwe_id}](https://cwe.mitre.org/data/definitions/${f.cwe_id.replace("CWE-", "")}.html) |\n`;
      }
      if (f.owasp_category) {
        md += `| OWASP | ${f.owasp_category} |\n`;
      }

      md += `\n**Evidence:**\n\`\`\`\n${f.evidence}\n\`\`\`\n\n`;
      md += `**Recommendation:** ${f.recommendations}\n\n`;
      md += `</details>\n\n`;
    }
  }

  if (suggestions && suggestions.length > 0) {
    md += `### 💡 General Suggestions\n\n`;
    for (const s of suggestions) {
      md += `- ${s}\n`;
    }
    md += `\n`;
  }

  md += `---\n`;
  md += `*This review was generated automatically. A human reviewer should make the final merge decision.*\n`;

  return md;
}

/**
 * Returns only the color emoji associated with the risk score.
 * @param {number} score - 0–100
 * @returns {string}
 */
function getRiskStatusEmoji(score) {
  if (score >= 80) return "🔴";
  if (score >= 50) return "🟠";
  if (score >= 20) return "🟡";
  return "🟢";
}