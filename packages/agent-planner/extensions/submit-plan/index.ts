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
	pi.registerTool({
		name: "submit_plan",
		label: "Submit Plan",
		description:
			"Emit the final decomposition as the machine-readable plan artifact and " +
			"finish planning. Call this exactly once, at the end, with the complete " +
			"task list — do NOT paste the plan as prose, put it here. The tasks are an " +
			"ordered list (they land as a linear commit history, so order is the " +
			"sequence); the plan is written as JSON to PLANNER_OUTPUT (default " +
			"./plan.json) for the implementation phase to consume.",
		promptSnippet: "Emit the final plan as a JSON artifact",
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
						description: "What changes and why — the intent, not step-by-step instructions.",
					}),
					acceptance: TString({
						description: "Concrete, checkable done criteria (tests pass, behavior X).",
					}),
					files: TString({
						description: "Files or module the change is expected to touch.",
					}),
					constraints: TString({
						description: 'What to avoid or preserve ("none" if truly nothing).',
					}),
					specialist: TString({
						description: 'Which specialist implements it, e.g. "code-writer".',
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
}
