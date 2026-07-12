/**
 * advisor extension
 *
 * Wires the `advisor` tool from @vt-pi/agent-advisor — lets agent-lord
 * consult a separate, stronger sub-agent when genuinely stuck, instead of
 * grinding through more turns on its own (growing) context at its own
 * model's price.
 */
import { createAdvisorExtension } from "@vt-pi/agent-advisor";

export default createAdvisorExtension();
