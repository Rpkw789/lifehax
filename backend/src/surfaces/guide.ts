export interface GuideTarget {
  name: string;
  canonical_url: string;
}

export interface GuideLink {
  label: string;
  url: string;
  note: string | null;
  section: string | null;
}

export interface ParsedLlmsTxt {
  title: string | null;
  summary: string | null;
  sections: { heading: string; links: GuideLink[] }[];
  links: GuideLink[];
  target_covered: boolean;
  facts: string[];
}

const MARKDOWN_LINK = /^\s*(?:[-*]\s+)?\[([^\]]+)]\(([^)]+)\)(?:\s*:\s*(.+))?\s*$/;

export function parseLlmsTxt(
  body: string,
  target: GuideTarget,
): ParsedLlmsTxt {
  let title: string | null = null;
  let summary: string | null = null;
  let currentSection: string | null = null;
  const links: GuideLink[] = [];
  const sectionLinks = new Map<string, GuideLink[]>();

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!title && /^#\s+/.test(line) && !/^##\s+/.test(line)) {
      title = line.replace(/^#\s+/, "").trim() || null;
      continue;
    }
    if (!summary && line.startsWith(">")) {
      summary = line.replace(/^>\s?/, "").trim() || null;
      continue;
    }
    if (/^##\s+/.test(line)) {
      currentSection = line.replace(/^##\s+/, "").trim() || null;
      if (currentSection && !sectionLinks.has(currentSection)) {
        sectionLinks.set(currentSection, []);
      }
      continue;
    }
    const match = line.match(MARKDOWN_LINK);
    if (!match?.[1] || !match[2]) continue;
    const link: GuideLink = {
      label: match[1].trim(),
      url: match[2].trim(),
      note: match[3]?.trim() || null,
      section: currentSection,
    };
    links.push(link);
    if (currentSection) sectionLinks.get(currentSection)?.push(link);
  }

  const targetKey = resourceKey(target.canonical_url);
  const targetCovered = links.some((link) => resourceKey(link.url) === targetKey);
  const facts = [
    title ? `H1 title: ${title}` : "Required H1 title is missing",
    `${links.length} Markdown links parsed`,
    targetCovered
      ? `Target product is linked directly: ${target.name}`
      : `Target product is not linked directly: ${target.name}`,
  ];

  return {
    title,
    summary,
    sections: [...sectionLinks].map(([heading, section]) => ({
      heading,
      links: section,
    })),
    links,
    target_covered: targetCovered,
    facts,
  };
}

export function selectRelevantGuideLinks(
  parsed: ParsedLlmsTxt,
  brief: string,
  origin: string,
  limit: number,
): string[] {
  const expectedOrigin = new URL(origin).origin;
  const briefTokens = tokens(brief);
  const normalizedBrief = brief.toLowerCase();

  return parsed.links
    .map((link, index) => ({ link, index, score: relevance(link, briefTokens, normalizedBrief) }))
    .filter(({ link, score }) => score > 0 && isSameHttpOrigin(link.url, expectedOrigin))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, Math.max(0, limit))
    .map(({ link }) => new URL(link.url).href);
}

function relevance(
  link: GuideLink,
  briefTokens: Set<string>,
  normalizedBrief: string,
): number {
  const text = [link.label, link.note, link.section]
    .filter((value): value is string => Boolean(value))
    .join(" ");
  let score = [...tokens(text)].filter((token) => briefTokens.has(token)).length;
  if (normalizedBrief.includes(link.label.toLowerCase())) score += 3;
  return score;
}

function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length > 2),
  );
}

function isSameHttpOrigin(rawUrl: string, origin: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.origin === origin
    );
  } catch {
    return false;
  }
}

function resourceKey(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    const pathname = url.pathname.length > 1
      ? url.pathname.replace(/\/+$/, "")
      : url.pathname;
    return `${url.origin}${pathname}`;
  } catch {
    return null;
  }
}
