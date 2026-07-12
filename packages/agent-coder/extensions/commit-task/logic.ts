/**
 * commit-task logic — pure functions for formatting and executing commits.
 * No Pi imports; testable logic extracted from the tool handler.
 */
import type { CommitParams } from "../../types.ts";
import { execSync } from "node:child_process";

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
		errors.push(`Subject too long (${params.subject.length} chars, max 72)`);
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
	try {
		execSync("git diff --cached --quiet", { cwd, encoding: "utf-8" });
		// No diff = nothing to commit
		throw new Error(
			"No changes to commit. Did you forget to modify files?",
		);
	} catch (err: any) {
		// Non-zero exit means there ARE changes (diff --quiet exits 1 if there's a diff)
		if (!err.message.includes("Command failed")) {
			throw err;
		}
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
