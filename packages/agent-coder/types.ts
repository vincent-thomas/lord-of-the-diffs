/**
 * Coder-specific type definitions.
 *
 * The plan-artifact types (`Plan`, `PlanTask`) are owned by
 * `@vt-pi/agent-planner` — the package whose `submit_plan` tool produces the
 * plan.json this agent consumes. We import them here rather than maintaining a
 * second copy that can drift from the tool's actual schema.
 */
import type { Plan, PlanTask } from "@vt-pi/agent-planner";

export type { Plan, PlanTask };

/** Everything the coder needs to implement one task from a plan. */
export interface TaskExecutionContext {
  plan: Plan;
  task: PlanTask;
  taskIndex: number;
  cwd: string;
}
