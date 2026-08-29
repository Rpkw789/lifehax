import { describe, expect, test } from "bun:test";
import type { DraftFinding, Rule } from "./types";
import { rankDrafts } from "./rank";

function draft(severity: DraftFinding["severity"], runs: string[]): DraftFinding {
  return {
    severity,
    title: "t",
    evidence: [{ agent_run_id: null, fact: "f", references: ["site_audit.llms_txt"] }],
    derived_from: runs,
    addresses_failure_codes: ["NO_LLMS_TXT"],
    recommendation: {
      action: "a", surface: "discoverability", effort: "low", owner: "web",
      snippet_label: "l", snippet: "s",
    },
  };
}

const rule = (id: string): Rule => ({ id, evaluate: () => null });

describe("rankDrafts", () => {
  test("orders by number of runs unblocked, descending", () => {
    const out = rankDrafts([
      { rule: rule("b"), draft: draft("high", ["ar_001"]) },
      { rule: rule("a"), draft: draft("high", ["ar_001", "ar_002"]) },
    ]);
    expect(out.map((f) => f.derived_from.length)).toEqual([2, 1]);
  });

  test("breaks a count tie by severity", () => {
    const out = rankDrafts([
      { rule: rule("a"), draft: draft("medium", ["ar_001"]) },
      { rule: rule("b"), draft: draft("critical", ["ar_001"]) },
    ]);
    expect(out.map((f) => f.severity)).toEqual(["critical", "medium"]);
  });

  test("breaks a remaining tie by rule id, so ordering is deterministic", () => {
    const out = rankDrafts([
      { rule: rule("protocol.llms_txt"), draft: draft("medium", ["ar_001"]) },
      { rule: rule("content.shipping"), draft: draft("medium", ["ar_001"]) },
    ]);
    expect(out.map((f) => f.finding_id)).toEqual(["F001", "F002"]);
  });

  test("assigns ids from rank order", () => {
    const out = rankDrafts([
      { rule: rule("a"), draft: draft("high", ["ar_001"]) },
      { rule: rule("b"), draft: draft("critical", ["ar_001", "ar_002"]) },
    ]);
    expect(out.map((f) => f.finding_id)).toEqual(["F001", "F002"]);
    expect(out[0].severity).toBe("critical");
  });
});
