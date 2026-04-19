import { Octokit } from "@octokit/rest";
import { toMarkdown } from "./utils/to-markdown.js";

const BOT_COMMENT_MARKER = "<!-- gemini-ai-pr-reviewer -->";

/**
 * Posts (or updates) the AI review comment on a GitHub Pull Request.
 *
 * On the first run it creates a new comment.
 * On subsequent runs (e.g. force-push) it finds and updates the existing comment
 * so the PR timeline doesn't get cluttered with duplicate AI comments.
 *
 * @param {object} reviewResult - Validated review result
 */
export async function postPRComment(reviewResult) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.REPO;
  const prNumber = Number(process.env.PR_NUMBER);

  if (!token) throw new Error("GITHUB_TOKEN environment variable is not set.");
  if (!repo)  throw new Error("REPO environment variable is not set (expected format: owner/repo).");
  if (!prNumber || isNaN(prNumber)) throw new Error("PR_NUMBER environment variable is missing or not a number.");

  const [owner, repoName] = repo.split("/");
  if (!owner || !repoName) {
    throw new Error(`REPO must be in the format "owner/repo". Got: "${repo}"`);
  }

  const octokit = new Octokit({ auth: token });
  const body = `${BOT_COMMENT_MARKER}\n\n${toMarkdown(reviewResult)}`;

  // ── Try to find an existing bot comment to update ───────────────────────────
  let existingCommentId = null;

  try {
    const { data: comments } = await octokit.issues.listComments({
      owner,
      repo: repoName,
      issue_number: prNumber,
      per_page: 100,
    });

    const existing = comments.find((c) => c.body?.includes(BOT_COMMENT_MARKER));
    if (existing) {
      existingCommentId = existing.id;
    }
  } catch (err) {
    // Non-fatal: if we can't list comments, just try creating a new one
    console.warn("Warning: Could not list existing PR comments:", err.message);
  }

  // ── Update existing or create new ───────────────────────────────────────────
  if (existingCommentId) {
    await octokit.issues.updateComment({
      owner,
      repo: repoName,
      comment_id: existingCommentId,
      body,
    });
    console.log(`✅ Updated existing review comment (ID: ${existingCommentId})`);
  } else {
    const { data } = await octokit.issues.createComment({
      owner,
      repo: repoName,
      issue_number: prNumber,
      body,
    });
    console.log(`✅ Created new review comment (ID: ${data.id})`);
  }
}