/**
 * shell-quote.ts — POSIX single-quote escaping for values interpolated into
 * shell command strings run via execAsync/exec.
 *
 * Self-contained: no dependency on anything else in the vt-pi workspace,
 * mirroring packages/agent-lord/lib/shell-quote.ts.
 */

/**
 * Wrap `value` in single quotes, safe to splice into a shell command string
 * executed by `/bin/sh -c` (the exec-async / node:child_process exec path).
 *
 * Single quotes suppress all shell interpretation of their contents, so the
 * only case to handle is a literal `'` inside the value: it closes the
 * quote, contributes an escaped literal quote (`\'`), then reopens quoting.
 *
 * Needed anywhere a value isn't a fixed literal — e.g. a git branch name or
 * GitHub login pulled from `gh`/`git` output. git's ref-name rules don't
 * forbid shell metacharacters (`;`, `` ` ``, `$()`, even `'`), so an
 * unescaped branch name spliced into a shell command is a real injection
 * vector, not just a theoretical one.
 */
export function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}
