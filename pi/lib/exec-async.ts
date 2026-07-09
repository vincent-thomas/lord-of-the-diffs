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

export interface ExecResult {
	stdout: string;
	stderr: string;
}

/** An exec failure, with stdout/stderr attached so callers can show what the command actually printed. */
export interface ExecError extends Error {
	stdout: string;
	stderr: string;
}

/**
 * Async exec that kills the child process when the signal fires.
 * Rejects on non-zero exit or timeout.
 */
export function execAsync(
	command: string,
	options: { cwd?: string; timeout?: number; signal?: AbortSignal },
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
			{ cwd: options.cwd, timeout: options.timeout },
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