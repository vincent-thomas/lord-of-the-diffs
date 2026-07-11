/**
 * Command policy definitions for shell command allow rules.
 */

import { CommandPolicyStatus, type CommandPolicyEntry } from "@vt-pi/command-policy";
import { isAwkCommand, isPerlCommand, isPythonCommand } from "./predicates.ts";
import { BANNED_FOLDERS, findBannedFolderPath, findMakefilePath } from "../../lib/folder-guard.ts";

export const COMMAND_POLICY_SYSTEM_PROMPT = `
Only run shell commands that are explicitly allowed by the command policy.
The policy can allow or ban commands by command, subcommand, and flag.
When a command is banned, follow the policy description for what to do instead.
Prefer Pi tools over shell commands when possible: use read for file contents,
write/edit for file changes, rg for search, and fd for file discovery.
`;

export const COMMAND_POLICY_ENTRIES: CommandPolicyEntry[] = [
	// Checked before any other entry (first match wins in evaluateCommand) so
	// a command that would otherwise be allowed (cp, mv, rm, mkdir, …) is
	// still blocked when its args target a protected folder — shared with the
	// folder-protector extension's write/edit checks via ../../lib/folder-guard.ts.
	{
		name: "protected folder",
		status: CommandPolicyStatus.Banned,
		command: (use) => findBannedFolderPath(use, BANNED_FOLDERS) !== null,
		description:
			"Files inside .git, node_modules, or target should not be modified directly via shell commands. " +
			"Use the write or edit tool instead, or ask the user.",
	},
	// Also checked ahead of the allow entries: write-guard blocks the write and
	// edit tools from touching a Makefile, but without this entry the shell
	// could still delete or replace it (`rm Makefile`, `mv other Makefile`,
	// `git rm Makefile`) — and lib/precheck.ts silently passes when no Makefile
	// exists, so that would neutralize every pre-commit check.
	{
		name: "Makefile",
		status: CommandPolicyStatus.Banned,
		command: (use) => findMakefilePath(use) !== null,
		description:
			"The Makefile defines the project's validation contract and must not be created, " +
			"replaced, or deleted via shell commands. If the Makefile really needs to change, " +
			"tell the user what change is needed and why, and ask them to make it.",
	},
	{ name: "sudo", status: CommandPolicyStatus.Banned, command: "sudo", description: "It is banned to try to gain superuser access" },
	{ name: "doas", status: CommandPolicyStatus.Banned, command: "doas", description: "It is banned to try to gain superuser access" },
	{ name: "cat", status: CommandPolicyStatus.Banned, command: "cat", description: "Use the read tool to view file contents." },
	{ name: "grep", status: CommandPolicyStatus.Banned, command: "grep", description: "Use rg for searching instead." },
	{ name: "find", status: CommandPolicyStatus.Banned, command: "find", description: "Use fd for file discovery instead." },
	{ name: "tee", status: CommandPolicyStatus.Banned, command: "tee", description: "Use the write or edit tool to write file contents." },
	{ name: "sed", status: CommandPolicyStatus.Banned, command: "sed", description: "Use the edit tool for find-and-replace edits." },
	{
		name: "Python",
		status: CommandPolicyStatus.Banned,
		command: (use) => isPythonCommand(use.name),
		description: "Use safer shell tools or Pi tools instead. For JSON, prefer jq.",
	},
	{
		name: "Perl",
		status: CommandPolicyStatus.Banned,
		command: (use) => isPerlCommand(use.name),
		description: "Use safer shell tools or Pi tools instead. For JSON, prefer jq.",
	},
	{
		name: "awk",
		status: CommandPolicyStatus.Banned,
		command: (use) => isAwkCommand(use.name),
		description: "Use the read tool with offset/limit, or simpler tools like head, tail, wc, or rg.",
	},
	{ name: "ls", status: CommandPolicyStatus.Allowed, command: "ls" },
	{ name: "pwd", status: CommandPolicyStatus.Allowed, command: "pwd" },
	{ name: "echo", status: CommandPolicyStatus.Allowed, command: "echo" },
	{ name: "head", status: CommandPolicyStatus.Allowed, command: "head" },
	{ name: "tail", status: CommandPolicyStatus.Allowed, command: "tail" },
	{ name: "wc", status: CommandPolicyStatus.Allowed, command: "wc" },
	{ name: "sort", status: CommandPolicyStatus.Allowed, command: "sort" },
	{ name: "uniq", status: CommandPolicyStatus.Allowed, command: "uniq" },
	{ name: "rg", status: CommandPolicyStatus.Allowed, command: "rg" },
	{ name: "fd", status: CommandPolicyStatus.Allowed, command: "fd" },
	{ name: "jq", status: CommandPolicyStatus.Allowed, command: "jq" },
	{ name: "true", status: CommandPolicyStatus.Allowed, command: "true" },
	{ name: "false", status: CommandPolicyStatus.Allowed, command: "false" },
	{ name: "test", status: CommandPolicyStatus.Allowed, command: "test" },
	{ name: "mkdir", status: CommandPolicyStatus.Allowed, command: "mkdir" },
	{ name: "rm", status: CommandPolicyStatus.Allowed, command: "rm", bannedFlags: ["-r", "-R", "-rf", "-fr", "--recursive"] },
	{ name: "cp", status: CommandPolicyStatus.Allowed, command: "cp", bannedFlags: ["-r", "-R", "--recursive", "-a", "--archive", "-t", "--target-directory"] },
	{ name: "mv", status: CommandPolicyStatus.Allowed, command: "mv", bannedFlags: ["-t", "--target-directory"] },
	{ name: "chmod", status: CommandPolicyStatus.Allowed, command: "chmod", bannedFlags: ["-R", "--recursive"] },
	{ name: "nix", status: CommandPolicyStatus.Allowed, command: "nix", subcommand: [["build"], ["flake", "check"], ["log"]] },
	{
		name: "git config",
		status: CommandPolicyStatus.Banned,
		command: "git",
		subcommand: [["config"]],
		description: "Do not inspect or modify Git configuration from Pi.",
	},
	{
		name: "git status",
		status: CommandPolicyStatus.Allowed,
		command: "git",
		subcommand: [["status"]],
		allowedFlags: ["--short", "--porcelain", "-s"],
	},
	{
		name: "git branch",
		status: CommandPolicyStatus.Banned,
		command: "git",
		subcommand: [["branch"]],
		description: "Use the git_commit or push_and_check_ci tools for branch management.",
	},
	{
		name: "git push",
		status: CommandPolicyStatus.Banned,
		command: "git",
		subcommand: [["push"]],
		description: "Do not run git push directly in bash. Use the push_and_check_ci tool instead — it pushes your code and automatically waits for CI checks to complete.",
	},
	{
		name: "git commit",
		status: CommandPolicyStatus.Banned,
		command: "git",
		subcommand: [["commit"]],
		description: "Do not run git commit directly in bash. Use the git_commit tool instead.",
	},
	{
		name: "git",
		status: CommandPolicyStatus.Allowed,
		command: "git",
		subcommand: [
			["diff"],
			["log"],
			["show"],
			["ls-files"],
			["add"],
			["restore"],
			["rev-parse"],
			["merge-base"],
		],
	},
	{
		name: "git rm",
		status: CommandPolicyStatus.Allowed,
		command: "git",
		subcommand: [["rm"]],
		bannedFlags: ["-r", "-R", "-rf", "-fr", "--recursive"],
		description: "Recursive git rm is not allowed. Remove files individually instead.",
	},
	{
		name: "git checkout",
		status: CommandPolicyStatus.Allowed,
		command: "git",
		subcommand: [["checkout"]],
		bannedFlags: ["-b", "-B", "--orphan"],
	},
];
