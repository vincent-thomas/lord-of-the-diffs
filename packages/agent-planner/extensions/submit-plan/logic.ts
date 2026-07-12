/**
 * logic.ts — pure helpers for the submit_plan tool. No Pi imports: the SDK
 * wiring (tool registration, file write) lives in index.ts.
 *
 * These functions define the plan artifact's shape and integrity rules — the
 * contract the implementation phase consumes — independent of how it's emitted.
 */
import { isAbsolute, join } from "node:path";

export interface PlanTask {
	/** Stable identifier, e.g. "T1". Unique within the plan. */
	id: string;
	/** Imperative one-line summary. */
	title: string;
	/** What changes and why — the intent, not step-by-step instructions. */
	goal: string;
	/** Concrete, checkable done criteria. */
	acceptance: string;
	/** Files or module the change is expected to touch. */
	files: string;
	/** What to avoid or preserve ("none" if truly nothing). */
	constraints: string;
	/** Task ids this one builds on; empty when independent. */
	dependsOn: string[];
	/** Which specialist implements it, e.g. "code-writer". */
	specialist: string;
}

export interface Plan {
	/** Short approach summary for the whole request. */
	approach: string;
	/** The ordered single-piece tasks. */
	tasks: PlanTask[];
}

/** Environment variable naming where the plan artifact is written. */
export const PLAN_OUTPUT_ENV = "PLANNER_OUTPUT";

/** Default artifact filename, relative to the planner's cwd. */
export const DEFAULT_PLAN_FILENAME = "plan.json";

/**
 * Integrity checks the plan must pass before it's written. Returns a list of
 * human-readable problems (empty = valid), so the tool can hand them back to
 * the planner to fix and resubmit rather than emit a broken artifact.
 */
export function validatePlan(plan: Plan): string[] {
	const errors: string[] = [];
	const tasks = plan.tasks ?? [];

	if (tasks.length === 0) {
		errors.push("Plan has no tasks.");
	}

	const ids = new Set<string>();
	for (const task of tasks) {
		const id = task.id?.trim();
		if (!id) {
			errors.push("A task has an empty id.");
			continue;
		}
		if (ids.has(id)) {
			errors.push(`Duplicate task id: ${id}`);
		}
		ids.add(id);
	}

	for (const task of tasks) {
		for (const dep of task.dependsOn ?? []) {
			if (dep === task.id) {
				errors.push(`Task ${task.id} depends on itself.`);
			} else if (!ids.has(dep)) {
				errors.push(`Task ${task.id} depends on unknown task ${dep}.`);
			}
		}
	}

	return errors;
}

/** Canonical JSON serialization of the plan artifact (stable, trailing newline). */
export function serializePlan(plan: Plan): string {
	return JSON.stringify(plan, null, 2) + "\n";
}

/**
 * Resolve where to write the artifact: the PLANNER_OUTPUT env value if set,
 * else plan.json; relative paths are anchored at the planner's cwd so the
 * orchestrator gets a predictable absolute location.
 */
export function resolveOutputPath(envValue: string | undefined, cwd: string): string {
	const target = envValue && envValue.trim() ? envValue.trim() : DEFAULT_PLAN_FILENAME;
	return isAbsolute(target) ? target : join(cwd, target);
}
