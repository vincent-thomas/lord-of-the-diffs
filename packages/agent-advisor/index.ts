/**
 * agent-advisor — a read-only advisory sub-agent, run in-process via the Pi
 * SDK (not a subprocess). ExtensionAPI has no built-in way to spawn a nested
 * session from a tool handler, so this imports createAgentSession directly
 * from the same package ExtensionAPI comes from.
 *
 * Mirrors agent-explorer's isolation, but inverted on model tier: explore
 * hands cheap lookups to a *cheaper* model to keep them off agent-lord's own
 * context; advisor hands hard, stuck-agent problems to a *stronger* model,
 * kept off agent-lord's own turn loop so the frontier model's cost is paid
 * once on a bounded question instead of on every turn of a growing context.
 *
 * - tools allowlist restricts it to read/grep/find/ls — no write, edit, bash.
 *   The advisor can verify claims and inspect code itself rather than
 *   reasoning only over whatever agent-lord chose to paste into the query.
 * - resourceLoader has all discovery (extensions, skills, AGENTS.md, context
 *   files) turned off, so it never inherits agent-lord's own extensions,
 *   system prompt, or skills.
 * - default model is a stronger/frontier one, independent of whatever model
 *   agent-lord itself is running — the whole point of consulting it.
 */
import {
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	SessionManager,
	type ExtensionAPI,
} from "@mariozechner/pi-coding-agent";
import { getModel, type Model } from "@mariozechner/pi-ai";
import { Object as TObject, String as TString } from "typebox";
import { buildAdvicePrompt, formatAdviceResult, hasExceededTurnLimit } from "./logic.ts";

export interface AdvisorExtensionOptions {
	/** Model for the nested advisory session. Default: a stronger/frontier model, independent of agent-lord's own. */
	model?: Model<any>;
}

export function createAdvisorExtension(options: AdvisorExtensionOptions = {}) {
	const model = options.model ?? getModel("anthropic", "claude-opus-4-8");

	return function (pi: ExtensionAPI) {
		pi.registerTool({
			name: "advisor",
			label: "Advisor",
			description:
				"Consult a separate, stronger advisor sub-agent when genuinely stuck — " +
				"repeated failed attempts at the same fix, an ambiguous approach, or a " +
				"hard-to-diagnose bug. Not for routine work. Describe the problem and " +
				"what's already been tried; the advisor can read the repo (read-only) " +
				"to verify claims and returns a terse, direct recommendation.",
			promptSnippet: "Consult a stronger sub-agent when stuck on a hard problem",
			parameters: TObject({
				query: TString({
					description:
						"The problem to get advice on, including what's already been tried and why " +
						"it didn't work, e.g. 'tried X and Y to fix the flaky retry test, both failed " +
						"because Z — what's the actual root cause?'",
				}),
			}),
			async execute(_toolCallId, params, signal, onUpdate, ctx) {
				const notify = (text: string) => onUpdate?.({ content: [{ type: "text", text }] });
				notify(`Consulting advisor: ${params.query}`);

				const agentDir = getAgentDir();
				const resourceLoader = new DefaultResourceLoader({
					cwd: ctx.cwd,
					agentDir,
					noExtensions: true,
					noSkills: true,
					noPromptTemplates: true,
					noThemes: true,
					noContextFiles: true,
				});

				const { session } = await createAgentSession({
					cwd: ctx.cwd,
					agentDir,
					model,
					tools: ["read", "grep", "find", "ls"],
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
					await session.prompt(buildAdvicePrompt(params.query));
				} finally {
					unsubscribe();
					signal?.removeEventListener("abort", onAbort);
					session.dispose();
				}

				const text = formatAdviceResult(session.getLastAssistantText());
				return { content: [{ type: "text" as const, text }] };
			},
		});
	};
}

export default createAdvisorExtension;
