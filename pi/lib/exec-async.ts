/**
 * exec-async.ts — shared async exec with abort-signal support.
 *
 * Provides a promisified child_process.exec that:
 *  - Threads through AbortSignal (Ctrl+C kills child processes)
 *  - Attaches stdout/stderr to the rejection error for callers that need them
 *
 * No pi imports — importable from any extension's logic module.
 */

import { exec, type ChildProcess } from "node:child_process";

interface ExecResult {
	stdout: string;
	stderr: string;
}

// node:child_process.exec defaults maxBuffer to 1MB per stream (stdout,
// stderr checked separately) and kills the child if either is exceeded —
// not truncates, kills, so the caller gets nothing at all. Several callers
// legitimately produce more than that: `gh run view --log` on a verbose CI
// run, or `gh api --paginate` against a PR with many check runs. Raised well
// above any of this codebase's real payloads while still bounding a runaway
// process.
const DEFAULT_MAX_BUFFER = 50 * 1024 * 1024;

/** An exec failure, with stdout/stderr attached so callers can show what the command actually printed. */
interface ExecError extends Error {
	stdout: string;
	stderr: string;
}

/**
 * Async exec that kills the child process when the signal fires.
 * Rejects on non-zero exit or timeout.
 */
export function execAsync(
	command: string,
	options: { cwd?: string; timeout?: number; signal?: AbortSignal; maxBuffer?: number },
): Promise<ExecResult> {
	if (options.signal?.aborted) {
		return Promise.reject(
			Object.assign(new Error("The operation was aborted."), {
				stdout: "",
				stderr: "AbortError: signal already aborted",
			}),
		);
	}

	return new Promise((resolve, reject) => {
		let child: ChildProcess;

		const onAbort = () => {
			child.kill();
		};

		const cleanup = () => {
			options.signal?.removeEventListener("abort", onAbort);
		};

		child = exec(
			command,
			{
				cwd: options.cwd,
				timeout: options.timeout,
				maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
			},
			(err, stdout, stderr) => {
				cleanup();
				if (err) {
					// Attach stdout/stderr to the error for callers that need them.
					const execError = err as ExecError;
					execError.stdout = stdout;
					execError.stderr = stderr;
					reject(execError);
				} else {
					resolve({ stdout: String(stdout), stderr: String(stderr) });
				}
			},
		);

		options.signal?.addEventListener("abort", onAbort, { once: true });
	});
}

/**
 * Extract readable output from an exec error.
 * Prefers stderr, then stdout, falls back to toString.
 */
export function extractErrorOutput(err: unknown): string {
	if (err instanceof Error) {
		const { stdout, stderr } = err as Partial<ExecError>;
		if (stderr) return stderr;
		if (stdout) return stdout;
	}
	return String(err);
}