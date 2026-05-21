export * as PermissionV2 from "./permission"

import { Schema } from "effect"
import { Wildcard } from "./util/wildcard"

export const Action = Schema.Literals(["allow", "deny", "ask"]).annotate({ identifier: "PermissionV2.Action" })
export type Action = typeof Action.Type

export const Rule = Schema.Struct({
  permission: Schema.String,
  pattern: Schema.String,
  action: Action,
}).annotate({ identifier: "PermissionV2.Rule" })
export type Rule = typeof Rule.Type

export const Ruleset = Schema.Array(Rule).annotate({ identifier: "PermissionV2.Ruleset" })
export type Ruleset = typeof Ruleset.Type

const EDIT_TOOLS = ["edit", "write", "apply_patch"]

export function evaluate(permission: string, pattern: string, ...rulesets: Ruleset[]): Rule {
  return select(permission, pattern, rulesets.flat())?.rule ?? { action: "ask", permission, pattern: "*" }
}

export function merge(...rulesets: Ruleset[]): Ruleset {
  return rulesets.flat()
}

export function disabled(tools: string[], ruleset: Ruleset): Set<string> {
  return new Set(
    tools.filter((tool) => {
      const permission = EDIT_TOOLS.includes(tool) ? "edit" : tool
      if (
        ruleset.some(
          (rule) => Wildcard.match(permission, rule.permission) && rule.pattern !== "*" && rule.action !== "deny",
        )
      ) {
        return false
      }
      return evaluate(permission, "*", ruleset).action === "deny"
    }),
  )
}

function select(permission: string, pattern: string, ruleset: Ruleset) {
  return ruleset.reduce<Selected | undefined>((best, rule, index) => {
    if (!Wildcard.match(permission, rule.permission) || !Wildcard.match(pattern, rule.pattern)) return best
    const next = { rule, index, permission: specificity(rule.permission), pattern: specificity(rule.pattern) }
    if (!best) return next
    return compare(next, best) >= 0 ? next : best
  }, undefined)
}

type Selected = {
  rule: Rule
  index: number
  permission: Specificity
  pattern: Specificity
}

type Specificity = {
  wildcard: number
  literal: number
}

function specificity(pattern: string): Specificity {
  return {
    wildcard: [...pattern.matchAll(/[?*]/g)].length,
    literal: pattern.replace(/[?*]/g, "").length,
  }
}

function compare(a: Selected, b: Selected) {
  return (
    b.permission.wildcard - a.permission.wildcard ||
    a.permission.literal - b.permission.literal ||
    b.pattern.wildcard - a.pattern.wildcard ||
    a.pattern.literal - b.pattern.literal ||
    a.index - b.index
  )
}
