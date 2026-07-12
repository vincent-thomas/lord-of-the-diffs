/**
 * explore extension
 *
 * Wires the `explore` tool from @vt-pi/agent-explorer — delegates read-only
 * search/exploration queries to a separate, cheaper sub-agent session so
 * agent-lord doesn't burn its own (pricier) model on multi-file lookups.
 */
import { createExploreExtension } from "@vt-pi/agent-explorer";

export default createExploreExtension();
