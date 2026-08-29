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
  structurally_valid: boolean;
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
  let h1Count = 0;
  let malformedLinkCount = 0;
  const links: GuideLink[] = [];
  const sectionLinks = new Map<string, GuideLink[]>();

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^#\s+/.test(line) && !/^##\s+/.test(line)) {
      h1Count += 1;
      if (!title) title = line.replace(/^#\s+/, "").trim() || null;
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
    if (!match?.[1] || !match[2]) {
      if (/^\s*(?:[-*]\s+)?\[/.test(line)) malformedLinkCount += 1;
      continue;
    }
    const link: GuideLink = {
      label: match[1].trim(),
      url: match[2].trim(),
      note: match[3]?.trim() || null,
      section: currentSection,
    };
    links.push(link);
    if (currentSection) sectionLinks.get(currentSection)?.push(link);
  }

  const origin = new URL(target.canonical_url).origin;
  const linkKeys = links.map((link) => resourceKey(link.url, origin));
  const targetKey = resourceKey(target.canonical_url, origin);
  const targetCovered = linkKeys.some((key) => key === targetKey);
  const safeKeys = linkKeys.filter((key): key is string => key !== null);
  const duplicateCount = safeKeys.length - new Set(safeKeys).size;
  const unsafeCount = links.length - safeKeys.length + malformedLinkCount;
  const offOriginCount = links.filter((link) => {
    const resolved = safeHttpUrl(link.url, origin);
    return resolved !== null && resolved.origin !== origin;
  }).length;
  const structurallyValid = h1Count === 1 && unsafeCount === 0;
  const facts = [
    h1Count === 1 && title
      ? `H1 title: ${title}`
      : h1Count === 0
        ? "Required H1 title is missing"
        : `${h1Count} H1 titles found; exactly one is required`,
    summary ? "Summary blockquote is present" : "Summary blockquote is absent",
    `${body.length} characters in llms.txt`,
    `${sectionLinks.size} H2 link sections parsed`,
    `${links.length} Markdown links parsed`,
    `${duplicateCount} duplicate links found`,
    `${unsafeCount} unsafe or invalid links found`,
    `${offOriginCount} off-origin links found`,
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
    structurally_valid: structurallyValid,
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
    .map(({ link }) => new URL(link.url, expectedOrigin).href);
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
  return safeHttpUrl(rawUrl, origin)?.origin === origin;
}

function resourceKey(rawUrl: string, origin: string): string | null {
  const url = safeHttpUrl(rawUrl, origin);
  if (url) {
    const pathname = url.pathname.length > 1
      ? url.pathname.replace(/\/+$/, "")
      : url.pathname;
    return `${url.origin}${pathname}`;
  }
  return null;
}

function safeHttpUrl(rawUrl: string, origin: string): URL | null {
  try {
    if (/\s/.test(rawUrl.trim())) return null;
    const url = new URL(rawUrl, origin);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}
