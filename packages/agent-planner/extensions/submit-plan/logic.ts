/**
 * logic.ts — pure helpers for the submit_plan tool. No Pi imports: the SDK
 * wiring (tool registration, file write) lives in index.ts.
 *
 * These functions define the plan artifact's shape and integrity rules — the
 * contract the implementation phase consumes — independent of how it's emitted.
 */
import { execSync } from "node:child_process";
import { isAbsolute, join } from "node:path";

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
   * Git branch name for this work — the branch that will be created or switched
   * to before implementation begins.
   */
  branchName: string;
  /**
   * The single-piece tasks. This is an ordered list: the tasks land as a flat,
   * linear commit history, so array position IS the implementation/commit order
   * and each task builds on the ones before it. The orchestrator assigns its
   * own ids for tracking; the planner does not.
   */
  tasks: PlanTask[];
}

/** Environment variable naming where the plan artifact is written. */
export const PLAN_OUTPUT_ENV = "PLANNER_OUTPUT";

/** Default artifact filename, relative to the planner's cwd. */
export const DEFAULT_PLAN_FILENAME = "../plan.json";

/**
 * Integrity checks the plan must pass before it's written. Returns a list of
 * human-readable problems (empty = valid), so the tool can hand them back to
 * the planner to fix and resubmit rather than emit a broken artifact.
 */
export function validatePlan(plan: Plan): string[] {
  const errors: string[] = [];
  const tasks = plan.tasks ?? [];

  if (!plan.what?.trim()) {
    errors.push(
      "Plan is missing `what` (a precise description of the change).",
    );
  }
  if (!plan.why?.trim()) {
    errors.push("Plan is missing `why` (the motivation for the change).");
  }
  if (!plan.branchName?.trim()) {
    errors.push("Plan is missing `branchName` (the git branch for this work).");
  }

  if (plan.branchName?.trim()) {
    try {
      execSync(`git check-ref-format --branch '${plan.branchName.trim().replace(/'/g, "'\\''")}'`, {
        encoding: 'utf-8',
        stdio: 'pipe'
      });
    } catch {
      errors.push(
        `Branch name "${plan.branchName}" is invalid (git ref-name rules). ` +
        `Use letters, numbers, underscores, hyphens. Avoid special characters.`
      );
    }
  }

  if (tasks.length === 0) {
    errors.push("Plan has no tasks.");
  }

  return errors;
}

/** Canonical JSON serialization of the plan artifact (stable, trailing newline). */
export function serializePlan(plan: Plan): string {
  return JSON.stringify(plan, null, 2) + "\n";
}

/**
 * Resolve where to write the artifact: the PLANNER_OUTPUT env value if set,
 * else ../plan.json; relative paths are anchored at the planner's cwd so the
 * orchestrator gets a predictable absolute location.
 */
export function resolveOutputPath(
  envValue: string | undefined,
  cwd: string,
): string {
  const target =
    envValue && envValue.trim() ? envValue.trim() : DEFAULT_PLAN_FILENAME;
  return isAbsolute(target) ? target : join(cwd, target);
}
