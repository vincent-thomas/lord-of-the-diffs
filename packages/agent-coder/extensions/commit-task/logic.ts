import { execSync } from "node:child_process";

export interface CommitParams {
  subject: string;
  what: string;
  why: string;
}

/**
 * Format the commit message according to the What/Why structure.
 */
export function formatCommitMessage(params: CommitParams): string {
  const { subject, what, why } = params;

  // Validate subject line length
  if (subject.length > 72) {
    throw new Error(
      `Subject line too long (${subject.length} chars, max 72): ${subject}`,
    );
  }

  // Build the message
  return `${subject}\n\nWhat: ${what}\n\nWhy: ${why}`;
}

/**
 * Validate commit parameters.
 */
export function validateCommitParams(params: CommitParams): string[] {
  const errors: string[] = [];

  if (!params.subject?.trim()) {
    errors.push("Subject is required");
  }
  if (!params.what?.trim()) {
    errors.push("What is required — describe the changes you made");
  }
  if (!params.why?.trim()) {
    errors.push("Why is required — explain the motivation");
  }

  if (params.subject && params.subject.length > 72) {
    errors.push(
      `Subject too long (${params.subject.length} chars, max 72)`,
    );
  }

  // Check for common mistakes in What/Why
  if (params.what && params.what.toLowerCase().includes("because")) {
    errors.push(
      'What should describe the change, not the reason (save "because" for Why)',
    );
  }

  return errors;
}

/**
 * Execute the git commit.
 */
export function executeCommit(message: string, cwd: string): void {
  // First, stage all changes
  execSync("git add -A", { cwd, encoding: "utf-8" });

  // Check if there's anything to commit
  // git diff --cached --quiet exits 0 if no changes, 1 if there are changes
  try {
    execSync("git diff --cached --quiet", { cwd, encoding: "utf-8" });
    // If we got here, exit code was 0 = no changes
    throw new Error("No changes to commit. Did you forget to modify files?");
  } catch (err: any) {
    // Exit code 1 means there ARE changes - this is what we want
    // Any other error (not status 1) is a real problem
    if (err.status !== 1) {
      throw err;
    }
    // Status 1 = changes exist, continue to commit
  }

  // Commit with the message
  const escapedMessage = message.replace(/'/g, "'\\''");
  execSync(`git commit -m '${escapedMessage}'`, { cwd, encoding: "utf-8" });
}

/**
 * Get git status to check for uncommitted changes.
 */
export function getGitStatus(cwd: string): string {
  return execSync("git status --short", { cwd, encoding: "utf-8" });
}
