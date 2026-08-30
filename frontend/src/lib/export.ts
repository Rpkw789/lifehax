/**
 * Exporting a finished run.
 *
 * Two audiences, two formats: JSON keeps every field for a developer or a
 * re-import, Markdown is the document a brand forwards to whoever owns the
 * site. The builders are pure so they can be tested without a browser; only
 * `downloadFile` touches the DOM.
 */

import type { Finding, Surface } from "./types";

export interface ExportedAgent {
  id: string;
  persona: string;
  stagesCleared: number;
  outcome: "completed" | "blocked" | "running";
  reason?: string;
}

export interface RunExport {
  runId: string;
  storeUrl: string;
  exportedAt: string;
  catalogueCount: number;
  defence: { score: number; verdict: string };
  surfaceReadability: { score: number; verdict: string };
  agents: ExportedAgent[];
  surfaces: Surface[];
  findings: Finding[];
}

export function buildRunJson(run: RunExport): string {
  return JSON.stringify(run, null, 2);
}

export function buildFindingsMarkdown(run: RunExport): string {
  const lines: string[] = [
    `# Bot exposure — ${run.storeUrl}`,
    "",
    `**${run.defence.score}/100 · ${run.defence.verdict}**`,
    "",
    `Machine readability: ${run.surfaceReadability.score}/100 · ${run.surfaceReadability.verdict}.`,
    "",
    `${run.catalogueCount} products read. Exported ${run.exportedAt}.`,
    "",
    "## Surfaces",
    "",
    "| Surface | Score | Note |",
    "| --- | --- | --- |",
    ...run.surfaces.map((s) => `| ${s.name} | ${s.score} | ${s.note} |`),
    "",
    "## Agents",
    "",
    "An outcome of `completed` means the agent reached checkout unchallenged.",
    "",
    "| Agent | Brief | Stages cleared | Outcome |",
    "| --- | --- | --- | --- |",
    ...run.agents.map(
      (a) =>
        `| ${a.id} | ${a.persona} | ${a.stagesCleared} | ${a.outcome}${a.reason ? ` — ${a.reason}` : ""} |`,
    ),
    "",
  ];

  if (run.findings.length === 0) {
    lines.push("No findings: nothing in this run let an agent through.", "");
    return lines.join("\n");
  }

  lines.push("# Findings", "");
  for (const f of run.findings) {
    lines.push(
      `## ${f.title}`,
      "",
      `**${f.severity}** · ${f.surface} · ${f.effort} · ${f.owner} · ${f.impact}`,
      "",
      `**Observed.** ${f.evidence}`,
      "",
      `**Fix.** ${f.fix}`,
      "",
      `**${f.snippetLabel}**`,
      "",
      "```",
      f.snippet,
      "```",
      "",
    );
  }

  return lines.join("\n");
}

/** Hands the file to the browser. Revokes the object URL so it is not leaked. */
export function downloadFile(filename: string, mime: string, contents: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** `happy2-example-com-2026-08-29`, safe on every filesystem. */
export function exportBasename(storeUrl: string, exportedAt: string): string {
  const host = storeUrl.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9]+/g, "-");
  return `happy2-${host}-${exportedAt.slice(0, 10)}`.replace(/-+/g, "-").toLowerCase();
}
