/**
 * No Scripting Languages Extension
 *
 * Blocks execution of scripting languages that are better replaced with
 * native bash tools or Pi's first-class file tools.
 *
 * Blocked languages:
 * - Python (python, python3, python3.x)
 * - Perl (perl, perl5, perl5.x)
 * - awk (awk, gawk, mawk, nawk)
 *
 * All variants are blocked in any form:
 * - Inline code: `python -c "..."`, `perl -e "..."`, `awk '...'`
 * - Script files: `python script.py`, `perl script.pl`, `awk -f script.awk`
 * - Heredocs: `python <<EOF`, `perl <<EOF`
 * - Wrapped: `env python`, `/usr/bin/python`, etc.
 * - In pipelines and command substitutions
 */

import { createBanCommandExtension } from "../lib/ban-command-extension.ts";
import { isPythonCommand, isPerlCommand, isAwkCommand } from "../lib/command-utils.ts";

export default createBanCommandExtension([
	{
		name: "Python",
		emoji: "🐍",
		matcher: isPythonCommand,
		reason:
			`This covers \`python\`/\`python3\`, \`-c\` snippets, running scripts, ` +
			`heredocs (\`python <<EOF\`), and \`env python …\`. ` +
			`Prefer other bash tools — for example, use \`jq\` to parse JSON.`,
	},
	{
		name: "Perl",
		emoji: "🐪",
		matcher: isPerlCommand,
		reason:
			`This covers \`perl\`/\`perl5\`, \`-e\` snippets, running scripts, ` +
			`heredocs (\`perl <<EOF\`), and \`env perl …\`. ` +
			`Prefer other bash tools — for example, use \`jq\` to parse JSON.`,
	},
	{
		name: "awk",
		emoji: "🚫",
		matcher: isAwkCommand,
		reason:
			`This covers \`awk\`, \`gawk\`, \`mawk\`, \`nawk\`, inline scripts, ` +
			`script files (\`awk -f\`), and \`env awk …\`. ` +
			`Use the \`read\` tool with offset/limit parameters to read specific lines, ` +
			`or prefer simpler bash tools like \`head\`, \`tail\`, \`wc\`, or \`grep\`.`,
	},
]);
