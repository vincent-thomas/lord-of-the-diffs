/**
 * git-utils.ts — shared helpers for extensions that intercept git commands.
 *
 * No pi imports — importable from any extension's logic module.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Branch helpers
// ---------------------------------------------------------------------------

/** Returns the current branch name, or null if not in a git repo. */
export function currentBranch(cwd: string): string | null {
	try {
		return (
			execSync("git branch --show-current", {
				cwd,
				stdio: ["pipe", "pipe", "pipe"],
			})
				.toString()
				.trim() || null
		);
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Generic git command scanning
// ---------------------------------------------------------------------------

/**
 * Given a line matcher, scan an arbitrary block of text for matching git
 * commands. Handles multi-line scripts and compound commands (&&, ||, ;).
 * Skips comment lines. Returns the first match, or null.
 */
export function findGitCommandInText(
	text: string,
	matcher: (line: string) => boolean,
): string | null {
	for (const rawLine of text.split("\n")) {
		for (const raw of rawLine.split(/&&|\|\||;/)) {
			const line = raw.replace(/\s+/g, " ").trim();
			if (line.startsWith("#")) continue;
			if (matcher(line)) return line;
		}
	}
	return null;
}

/**
 * Read a script file and scan it for a matching git command.
 */
export function findGitCommandInScript(
	scriptPath: string,
	cwd: string,
	matcher: (line: string) => boolean,
): string | null {
	try {
		const abs = resolve(cwd, scriptPath);
		const content = readFileSync(abs, "utf8");
		return findGitCommandInText(content, matcher);
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Line matchers
// ---------------------------------------------------------------------------

/** Matches if the line starts with `git` (or `sudo git`) as the actual command. */
function isGitCommand(line: string): boolean {
	return /^\s*(?:sudo\s+(?:-[a-zA-Z]\S*\s+)*)?git\s/.test(line);
}

/** Returns true if the line is a `git push` invocation. */
export function isGitPushLine(line: string): boolean {
	return isGitCommand(line) && /\bgit\s+push\b/.test(line);
}

/** Returns true if the line is a `git commit` invocation. */
export function isGitCommitLine(line: string): boolean {
	return isGitCommand(line) && /\bgit\s+commit\b/.test(line);
}

// ---------------------------------------------------------------------------
// Convenience wrappers
// ---------------------------------------------------------------------------

export function findGitPushInText(text: string): string | null {
	return findGitCommandInText(text, isGitPushLine);
}

export function findGitPushInScript(scriptPath: string, cwd: string): string | null {
	return findGitCommandInScript(scriptPath, cwd, isGitPushLine);
}

export function findGitCommitInText(text: string): string | null {
	return findGitCommandInText(text, isGitCommitLine);
}

export function findGitCommitInScript(scriptPath: string, cwd: string): string | null {
	return findGitCommandInScript(scriptPath, cwd, isGitCommitLine);
}

// ---------------------------------------------------------------------------
// Script path extraction
// ---------------------------------------------------------------------------

/**
 * Extracts shell-script file paths that a bash command is about to execute.
 *
 * Handles:
 *   bash [-flags] script.sh      sh / zsh / ksh / dash too
 *   source file                  . file
 *   ./script.sh   /abs/script
 *
 * Does NOT extract from `bash -c '...'` — inline text is already scanned
 * by the text scanners above.
 */
export function extractScriptPaths(command: string): string[] {
	const paths: string[] = [];
	const segments = command.split(/[;&|]+/);

	for (const seg of segments) {
		const s = seg.trim();

		if (/^\s*(?:bash|sh|zsh|ksh|dash)\b.*\s-c\s/.test(s)) continue;

		const shellExecMatch = s.match(/^\s*(?:bash|sh|zsh|ksh|dash)\s+((?:-[a-zA-Z]+\s+)*)(\S+)/);
		if (shellExecMatch) {
			const candidate = shellExecMatch[2];
			if (!candidate.startsWith("-")) {
				paths.push(candidate);
				continue;
			}
		}

		const sourceMatch = s.match(/^\s*(?:source|\.)\s+(\S+)/);
		if (sourceMatch) {
			paths.push(sourceMatch[1]);
			continue;
		}

		const directMatch = s.match(/^\s*(\.\/\S+|\/\S+)/);
		if (directMatch) {
			paths.push(directMatch[1]);
		}
	}

	return paths;
}
