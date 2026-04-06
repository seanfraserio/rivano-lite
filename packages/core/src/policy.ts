import type { Policy, PolicyAction, PolicyCondition } from "./types.js";
import safe from "safe-regex2";

interface PolicyEvalContext {
  text: string;
  injectionScore: number;
  piiDetected: boolean;
}

export function evaluateCondition(
  condition: PolicyCondition,
  context: PolicyEvalContext,
): boolean {
  if (condition.contains !== undefined) {
    if (!context.text.includes(condition.contains)) return false;
  }

  if (condition.regex !== undefined) {
    try {
      if (!safe(condition.regex)) return false;
      const regex = new RegExp(condition.regex);
      const truncated = context.text.slice(0, 10_000);
      if (!regex.test(truncated)) return false;
    } catch {
      return false;
    }
  }

  if (condition.injection_score !== undefined) {
    const score = context.injectionScore;
    if (typeof condition.injection_score === "number") {
      if (score < condition.injection_score) return false;
    } else {
      const t = condition.injection_score;
      if (t.gt !== undefined && !(score > t.gt)) return false;
      if (t.gte !== undefined && !(score >= t.gte)) return false;
      if (t.lt !== undefined && !(score < t.lt)) return false;
      if (t.lte !== undefined && !(score <= t.lte)) return false;
    }
  }

  if (condition.pii_detected !== undefined) {
    if (context.piiDetected !== condition.pii_detected) return false;
  }

  if (condition.length_exceeds !== undefined) {
    if (context.text.length <= condition.length_exceeds) return false;
  }

  return true;
}

export function evaluatePolicy(
  policy: Policy,
  context: PolicyEvalContext,
): { action: PolicyAction | null; message?: string } {
  const matched = evaluateCondition(policy.condition, context);
  return {
    action: matched ? policy.action : null,
    message: matched ? policy.message : undefined,
  };
}

export function evaluatePolicies(
  policies: Policy[],
  context: PolicyEvalContext,
): { action: PolicyAction | "continue"; matchedPolicy?: Policy; message?: string } {
  for (const policy of policies) {
    const result = evaluatePolicy(policy, context);
    if (result.action !== null) {
      return {
        action: result.action,
        matchedPolicy: policy,
        message: result.message,
      };
    }
  }

  return { action: "continue" };
}
