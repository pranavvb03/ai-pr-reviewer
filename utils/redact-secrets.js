/**
 * Redacts common secret patterns from a diff before sending to an LLM.
 * Covers API keys, tokens, passwords, private keys, connection strings, JWTs, and more.
 *
 * @param {string} input - Raw diff text
 * @returns {string}     - Diff with secrets replaced by [REDACTED]
 */

const SECRET_PATTERNS = [
  // Generic key/token/secret assignments (both = and : forms)
  /(?:api[_-]?key|apikey)\s*[:=]\s*["']?[A-Za-z0-9\-_.~+/]{16,}["']?/gi,
  /(?:access[_-]?token|auth[_-]?token|bearer)\s*[:=]\s*["']?[A-Za-z0-9\-_.~+/]{16,}["']?/gi,
  /(?:secret|client_secret|app_secret)\s*[:=]\s*["']?[A-Za-z0-9\-_.~+/]{16,}["']?/gi,
  /(?:password|passwd|pwd)\s*[:=]\s*["'][^"']{4,}["']/gi,

  // AWS
  /(?:AKIA|ASIA|AROA)[A-Z0-9]{16}/g,
  /aws[_-]?secret[_-]?access[_-]?key\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}["']?/gi,

  // Google / GCP
  /AIza[0-9A-Za-z\-_]{35}/g,
  /ya29\.[0-9A-Za-z\-_]+/g,

  // GitHub Personal Access Tokens (classic and fine-grained)
  /ghp_[A-Za-z0-9]{36}/g,
  /github_pat_[A-Za-z0-9_]{22,}/g,
  /gho_[A-Za-z0-9]{36}/g,

  // Stripe
  /sk_(?:live|test)_[A-Za-z0-9]{24,}/g,
  /pk_(?:live|test)_[A-Za-z0-9]{24,}/g,

  // Slack
  /xox[baprs]-[A-Za-z0-9\-]{10,}/g,

  // Twilio
  /AC[0-9a-f]{32}/g,
  /SK[0-9a-f]{32}/g,

  // JWT tokens
  /eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_.+/]*/g,

  // Private keys (PEM blocks)
  /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA )?PRIVATE KEY-----/g,

  // Database connection strings (postgres, mysql, mongodb)
  /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^:]+:[^@]+@[^\s"']+/gi,

  // Generic high-entropy quoted strings (32+ hex chars) – catches many token formats
  /["'][0-9a-f]{32,64}["']/gi,
];

export function redactSecrets(input) {
  let output = input;
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, "[REDACTED]");
  }
  return output;
}