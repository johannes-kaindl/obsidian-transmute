export type RiskRule = "nested-quantifier" | "quantified-alternation" | "unbounded-backreference";
export type PatternRisk = { ok: true } | { ok: false; rule: RiskRule };
