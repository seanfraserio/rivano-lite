export type { DeployResult } from "./deploy.js";
export { deploy, validate } from "./deploy.js";
export type { AgentDiff, DiffAction } from "./diff.js";
export { computeDiff, formatDiff } from "./diff.js";
export type { AgentState, DeploymentState } from "./state.js";
export { hashConfig, loadState, saveState } from "./state.js";
