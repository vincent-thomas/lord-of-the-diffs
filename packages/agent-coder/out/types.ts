/**
 * Type definitions for plan and task structures.
 * Matches the actual output from agent-planner's submit_plan tool.
 */

export interface PlanTask {
	/** Imperative one-line summary. */
	title: string;
	/** What changes and why — the intent, not step-by-step instructions. */
	goal: string;
	/** Concrete, checkable done criteria. */
	acceptance: string;
	/** What to avoid or preserve ("none" if truly nothing). */
	constraints: string;
}

export interface Plan {
	/**
	 * Precisely what the change is — concrete enough that an engineer could carry
	 * it out from this alone: the specific behavior or structure to add or alter,
	 * and where.
	 */
	what: string;
	/**
	 * Why the change is needed — the problem, context, or goal it serves, so a
	 * reader understands the motivation without any external context.
	 */
	why: string;
	/**
	 * The single-piece tasks. This is an ordered list: the tasks land as a flat,
	 * linear commit history, so array position IS the implementation/commit order
	 * and each task builds on the ones before it.
	 */
	tasks: PlanTask[];
}

export interface TaskExecutionContext {
	plan: Plan;
	task: PlanTask;
	taskIndex: number;
	cwd: string;
}

export interface CommitParams {
	subject: string;
	what: string;
	why: string;
}
