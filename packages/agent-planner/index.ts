/**
 * agent-planner — a read-only planning sub-agent, run in-process via the Pi
 * SDK (not a subprocess). ExtensionAPI has no built-in way to spawn a nested
 * session from a tool handler, so this imports createAgentSession directly
 * from the same package ExtensionAPI comes from.
 *
 * Mirrors agent-advisor's isolation and model tier, but a different job:
 * advisor unblocks a stuck implementor on one hard problem; the planner sits
 * UPSTREAM of implementation, turning a feature request into an ordered set of
 * single-piece tasks — each sized to exactly one commit — for downstream
 * code-writing agents. It plans; it never implements.
 *
 * - tools allowlist restricts it to read/grep/find/ls plus explore — no write,
 *   edit, bash. Decomposition must be grounded in the real codebase, so the
 *   planner reads and searches it directly, but it produces only a plan.
 * - it also gets its own `explore` tool (the agent-explorer extension, loaded
 *   via extensionFactories) backed by a *cheaper* model. Broad, multi-file
 *   "where does X live / how does Y flow" questions go there so the raw search
 *   churn is distilled by the cheap model and never lands in this frontier
 *   session's context — while precise, targeted reads it does directly.
 * - resourceLoader has all disk discovery (extensions, skills, AGENTS.md,
 *   context files) turned off, so it never inherits agent-lord's own
 *   extensions, system prompt, or skills; only the explicitly injected explore
 *   extension is loaded (extensionFactories run regardless of noExtensions).
 * - default model is a stronger/frontier one, independent of whatever model
 *   the caller is running — decomposition quality gates everything downstream.
 */
import {
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	SessionManager,
	type ExtensionAPI,
} from "@mariozechner/pi-coding-agent";
import { getModel, type Model } from "@mariozechner/pi-ai";
import { createExploreExtension } from "@vt-pi/agent-explorer";
import { Object as TObject, String as TString } from "typebox";
import { buildPlanPrompt, formatPlanResult, hasExceededTurnLimit } from "./logic.ts";

export interface PlannerExtensionOptions {
	/** Model for the nested planning session. Default: a stronger/frontier model, independent of the caller's own. */
	model?: Model<any>;
	/**
	 * Model for the `explore` sub-agent the planner delegates broad searches to.
	 * Default: agent-explorer's own cheap/fast default — keep it cheaper than
	 * `model`, since the point is to keep raw search churn off this session.
	 */
	exploreModel?: Model<any>;
}

export function createPlannerExtension(options: PlannerExtensionOptions = {}) {
	const model = options.model ?? getModel("anthropic", "claude-opus-4-8");
	const exploreExtension = createExploreExtension(options.exploreModel ? { model: options.exploreModel } : {});

	return function (pi: ExtensionAPI) {
		pi.registerTool({
			name: "plan",
			label: "Plan",
			description:
				"Decompose a feature request into an ordered set of single-piece " +
				"implementation tasks, each sized to exactly one commit, for downstream " +
				"code-writing agents. Runs a separate read-only planning sub-agent that " +
				"grounds the plan in the actual codebase (it can read and explore, but " +
				"cannot write, edit, or run shell commands). Returns the task list, not " +
				"an implementation.",
			promptSnippet: "Decompose a feature request into single-piece implementation tasks",
			parameters: TObject({
				request: TString({
					description:
						"The feature request or goal to decompose, e.g. 'add rate limiting to " +
						"the public API' — include any constraints or acceptance criteria known up front.",
				}),
			}),
			async execute(_toolCallId, params, signal, onUpdate, ctx) {
				const notify = (text: string) => onUpdate?.({ content: [{ type: "text", text }] });
				notify(`Planning: ${params.request}`);

				const agentDir = getAgentDir();
				const resourceLoader = new DefaultResourceLoader({
					cwd: ctx.cwd,
					agentDir,
					// noExtensions suppresses only disk discovery; the explicitly
					// injected explore extension still loads.
					noExtensions: true,
					extensionFactories: [exploreExtension],
					noSkills: true,
					noPromptTemplates: true,
					noThemes: true,
					noContextFiles: true,
				});

				const { session } = await createAgentSession({
					cwd: ctx.cwd,
					agentDir,
					model,
					tools: ["read", "grep", "find", "ls", "explore"],
					resourceLoader,
					sessionManager: SessionManager.inMemory(ctx.cwd),
				});

				let turnCount = 0;
				const unsubscribe = session.subscribe((event) => {
					if (event.type === "turn_end") {
						turnCount++;
						if (hasExceededTurnLimit(turnCount)) {
							void session.abort();
						}
					}
				});

				const onAbort = () => void session.abort();
				signal?.addEventListener("abort", onAbort, { once: true });

				try {
					await session.prompt(buildPlanPrompt(params.request));
				} finally {
					unsubscribe();
					signal?.removeEventListener("abort", onAbort);
					session.dispose();
				}

				const text = formatPlanResult(session.getLastAssistantText());
				return { content: [{ type: "text" as const, text }] };
			},
		});
	};
}

export default createPlannerExtension;
