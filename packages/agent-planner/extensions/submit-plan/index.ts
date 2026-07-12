/**
 * submit-plan extension
 *
 * `submit_plan` tool — the planner's structured output channel. It takes the
 * full decomposition as typed parameters, validates it, and writes it as a
 * JSON artifact to disk (PLANNER_OUTPUT, default ./plan.json), separate from
 * everything the planner narrates while working. This is what makes planning a
 * distinct, machine-consumable phase: the orchestrator reads the artifact, not
 * the transcript.
 *
 * The planner is otherwise read-only; this is its one sanctioned write, and
 * only of its own deliverable — never repo code.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Array as TArray, Object as TObject, String as TString } from "typebox";
import { writeFileSync } from "node:fs";
import {
  PLAN_OUTPUT_ENV,
  resolveOutputPath,
  serializePlan,
  validatePlan,
  type Plan,
} from "./logic.ts";

export default function (pi: ExtensionAPI) {
  let submitPlanCalled = false;
  let forcingAttempts = 0;

  pi.registerTool({
    name: "submit_plan",
    label: "Submit Plan",
    description:
      "**CALL THIS THE MOMENT YOU SPOT THE FIRST FIXABLE ISSUE.** Do not wait. " +
      "Do not find more issues. Do not compare options. The instant you identify " +
      "ANY fixable issue (a bug, missing test, outdated docs, incorrect code, etc.), " +
      "IMMEDIATELY call this tool with a plan to fix that ONE thing. If you have " +
      "already identified multiple issues, pick the FIRST one you found and call " +
      "this tool NOW. Continuing to explore after finding an issue is a failure. " +
      "Listing multiple issues is a failure. Call this tool with ONE plan. " +
      "The plan is written as JSON to PLANNER_OUTPUT (default ./plan.json).",
    promptSnippet: "Submit plan for the ONE issue you found",
    parameters: TObject({
      what: TString({
        description:
          "Precisely what the change is — concrete enough that an engineer could " +
          "carry it out from this alone: the specific behavior or structure to " +
          "add or alter, and where.",
      }),
      why: TString({
        description:
          "Why the change is needed — the problem, context, or goal it serves, so " +
          "a reader understands the motivation without any external context.",
      }),
      tasks: TArray(
        TObject({
          title: TString({ description: "Imperative one-line summary." }),
          goal: TString({
            description:
              "What changes and why — the intent, not step-by-step instructions.",
          }),
          acceptance: TString({
            description:
              "Concrete, checkable done criteria (tests pass, behavior X).",
          }),
          constraints: TString({
            description: 'What to avoid or preserve ("none" if truly nothing).',
          }),
        }),
        {
          description:
            "The single-piece tasks, in the order they should be implemented and " +
            "committed (they land as a linear history). Each must be implementable " +
            "as exactly one commit.",
        },
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const plan = params as Plan;

      const errors = validatePlan(plan);
      if (errors.length > 0) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                "Plan rejected — fix these and call submit_plan again:\n" +
                errors.map((e) => `- ${e}`).join("\n"),
            },
          ],
        };
      }

      submitPlanCalled = true;
      const path = resolveOutputPath(process.env[PLAN_OUTPUT_ENV], ctx.cwd);
      writeFileSync(path, serializePlan(plan));

      return {
        content: [
          {
            type: "text" as const,
            text: `Wrote plan (${plan.tasks.length} task(s)) to ${path}`,
          },
        ],
      };
    },
  });

  // Force submit_plan to be called before the agent ends
  pi.on("agent_end", (event) => {
    if (!submitPlanCalled && forcingAttempts < 10) {
      forcingAttempts++;

      // Inject a forcing prompt
      event.preventDefault();
      event.continueWith(
        "You have NOT called submit_plan yet. Your task is INCOMPLETE until you call " +
          "that tool with a plan. If you haven't found an issue yet, continue exploring " +
          "(read files, check documentation). Once you find ONE issue, create a plan to " +
          "fix it and call submit_plan immediately. Do this now.",
      );
    }
  });
}
