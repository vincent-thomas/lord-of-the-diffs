/**
 * validate-plan extension
 *
 * Provides tools for validating implementation against plan:
 * - not_correct: Flag when implementation doesn't match plan
 * - approve_plan_implementation: Approve when implementation matches plan
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export function createValidationExtension() {
  return function (pi: ExtensionAPI) {
    // ── Tool: not_correct ──────────────────────────────────────────────────
    pi.registerTool({
      name: "not_correct",
      label: "Implementation Does Not Match Plan",
      description:
        "Call this when the implementation does not match what was planned. " +
        "Provide detailed reasons explaining what's wrong and what was expected.",
      parameters: Type.Object({
        reason: Type.String({
          description:
            "Detailed explanation of why the implementation doesn't match the plan. " +
            "Be specific: which tasks are incomplete, what's missing, what was done wrong.",
        }),
        missing_tasks: Type.Optional(
          Type.Array(Type.Number(), {
            description: "Task indices (1-based) that were not implemented or are incomplete.",
          }),
        ),
        extra_changes: Type.Optional(
          Type.String({
            description:
              "Description of significant changes made that were NOT in the plan " +
              "(minor extras are OK, but major scope creep should be flagged).",
          }),
        ),
      }),

      async execute(toolCallId, params, signal, onUpdate, ctx) {
        const lines: string[] = [];
        lines.push("## ❌ Implementation Does Not Match Plan");
        lines.push("");
        lines.push(params.reason);
        lines.push("");

        if (params.missing_tasks && params.missing_tasks.length > 0) {
          lines.push("### Missing/Incomplete Tasks");
          for (const taskNum of params.missing_tasks) {
            lines.push(`- Task ${taskNum}`);
          }
          lines.push("");
        }

        if (params.extra_changes) {
          lines.push("### Scope Creep");
          lines.push(params.extra_changes);
          lines.push("");
        }

        lines.push(
          "The implementation needs to be fixed to match the plan before proceeding to CI validation.",
        );

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details: {
            approved: false,
            reason: params.reason,
            missing_tasks: params.missing_tasks,
            extra_changes: params.extra_changes,
          },
        };
      },
    });

    // ── Tool: approve_plan_implementation ──────────────────────────────────
    pi.registerTool({
      name: "approve_plan_implementation",
      label: "Approve Implementation",
      description:
        "Call this when the implementation correctly matches the plan. " +
        "All tasks should be complete, acceptance criteria met, and constraints respected.",
      parameters: Type.Object({
        summary: Type.String({
          description:
            "Brief summary of what was validated and confirmed. " +
            "Example: 'All 3 tasks implemented: User model, auth endpoints, tests. " +
            "Acceptance criteria met.'",
        }),
        notes: Type.Optional(
          Type.String({
            description:
              "Optional notes about minor extras or implementation choices that differ from " +
              "the plan but are acceptable.",
          }),
        ),
      }),

      async execute(toolCallId, params, signal, onUpdate, ctx) {
        const lines: string[] = [];
        lines.push("## ✅ Implementation Approved");
        lines.push("");
        lines.push(params.summary);
        lines.push("");

        if (params.notes) {
          lines.push("### Notes");
          lines.push(params.notes);
          lines.push("");
        }

        lines.push(
          "The implementation matches the plan. Ready to proceed with CI validation " +
            "(push_and_check_ci).",
        );

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details: {
            approved: true,
            summary: params.summary,
            notes: params.notes,
          },
        };
      },
    });
  };
}

export default createValidationExtension;
