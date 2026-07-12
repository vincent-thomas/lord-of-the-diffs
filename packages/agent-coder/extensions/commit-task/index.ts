/**
 * commit-task extension
 *
 * Provides a structured `commit_task` tool for the code-writing agent.
 * Enforces the What/Why commit message format and prevents multiple commits.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Object as TObject, String as TString } from "typebox";
import {
  type CommitParams,
  executeCommit,
  formatCommitMessage,
  getGitStatus,
  validateCommitParams,
} from "./logic.js";

export default function (pi: ExtensionAPI): void {
  let hasCommitted = false;

  pi.registerTool({
    name: "commit_task",
    label: "Commit Task",
    description:
      "Create a commit for the completed task with structured What/Why message. " +
      "Call this exactly once when your task is complete. After committing, your " +
      "session ends — do NOT continue implementing.",
    promptSnippet: "Commit the completed task",
    parameters: TObject({
      subject: TString({
        description:
          "The commit subject line (same as task.title). Must be ≤72 characters.",
      }),
      what: TString({
        description:
          "2-3 sentences describing the concrete changes you made. Be specific " +
          "about the implementation — mention key functions, files, or patterns. " +
          'Example: \'Adds a useFormValidation hook with async support. Login ' +
          "form calls it for email/password validation. Debounces by 300ms.'",
      }),
      why: TString({
        description:
          "1-2 sentences explaining the motivation. Start with the plan-level " +
          "why (provided in your prompt), then add task-specific context if needed. " +
          'Example: \'Form submissions currently succeed with invalid data, causing ' +
          "backend errors. This validates client-side to catch issues early.'",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      // Prevent multiple commits
      if (hasCommitted) {
        return {
          content: [
            {
              type: "text",
              text: "You already committed this task. Your session should end now — do not continue implementing.",
            },
          ],
        };
      }

      // Validate parameters
      const errors = validateCommitParams(params as CommitParams);
      if (errors.length > 0) {
        return {
          content: [
            {
              type: "text",
              text:
                "Commit rejected — fix these issues and call commit_task again:\n" +
                errors.map((e) => `- ${e}`).join("\n"),
            },
          ],
        };
      }

      // Check for changes
      const status = getGitStatus(ctx.cwd);
      if (!status.trim()) {
        return {
          content: [
            {
              type: "text",
              text: "No changes to commit. Did you implement the task? Check git status.",
            },
          ],
        };
      }

      // Format and execute commit
      try {
        const message = formatCommitMessage(params as CommitParams);
        executeCommit(message, ctx.cwd);
        hasCommitted = true;

        return {
          content: [
            {
              type: "text",
              text:
                `✓ Task committed successfully.\n\n` +
                `Subject: ${params.subject}\n` +
                `Your session is complete — do NOT continue implementing.`,
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text",
              text: `Commit failed: ${err.message}\n\nFix the issue and try again.`,
            },
          ],
        };
      }
    },
  });
}
