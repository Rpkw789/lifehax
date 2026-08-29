import {
  createOpenAiResponse,
  openAiOutputText,
  type LlmTransport,
} from "../llm.ts";
import {
  fetchCitedStorePages,
  parseProposal,
  rankingPrompt,
  SHOPPER_OUTPUT_SCHEMA,
  shopperPrompt,
} from "./proposal.ts";
import type {
  SearchCitation,
  WebSearchClient,
  WebSearchRequest,
  WebSearchResponse,
} from "./types.ts";

interface OpenAIOptions {
  apiKey: string;
  model: string;
  transport?: LlmTransport;
}

export class OpenAIWebSearchClient implements WebSearchClient {
  readonly #options: OpenAIOptions;

  constructor(options: OpenAIOptions) {
    this.#options = options;
  }

  async recommend(request: WebSearchRequest): Promise<WebSearchResponse> {
    const started = performance.now();
    const researchResponse = await createOpenAiResponse(
      {
        input: shopperPrompt(request.query, request.locale, request.currency),
        max_output_tokens: 8_000,
        reasoning: { effort: "low" },
        tools: [{ type: "web_search" }],
        tool_choice: "auto",
        include: ["web_search_call.action.sources"],
      },
      { ...this.#options, signal: request.signal },
    );
    const research = parseOpenAiResearch(researchResponse);
    const fetchedPages = await fetchCitedStorePages(
      research.citations,
      request,
    );
    const rankingResponse = await createOpenAiResponse(
      {
        instructions:
          "Return an evidence-grounded shopping shortlist matching the supplied JSON schema.",
        input: rankingPrompt(
          request.query,
          request.locale,
          request.currency,
          research.text,
          research.citations,
          fetchedPages,
        ),
        max_output_tokens: 8_000,
        reasoning: { effort: "low" },
        text: {
          format: {
            type: "json_schema",
            name: "shopper_proposal",
            strict: true,
            schema: SHOPPER_OUTPUT_SCHEMA,
          },
        },
      },
      { ...this.#options, signal: request.signal },
    );

    return {
      proposal: parseProposal(JSON.parse(openAiOutputText(rankingResponse))),
      citations: research.citations,
      fetchedPages: fetchedPages.map(({ url, status }) => ({ url, status })),
      latencyMs: Math.max(0, Math.round(performance.now() - started)),
    };
  }
}

function parseOpenAiResearch(response: {
  output?: unknown[];
}): { text: string; citations: SearchCitation[] } {
  const annotatedCitations: SearchCitation[] = [];
  const consultedSources: SearchCitation[] = [];
  let text = "";
  for (const item of response.output ?? []) {
    if (!isRecord(item)) continue;
    if (item.type === "web_search_call" && isRecord(item.action)) {
      for (const source of Array.isArray(item.action.sources)
        ? item.action.sources
        : []) {
        if (isRecord(source) && nonEmpty(source.url)) {
          consultedSources.push({ title: source.url, url: source.url });
        }
      }
    }
    if (item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (!isRecord(content) || content.type !== "output_text") continue;
      if (typeof content.text === "string") text += content.text;
      for (const annotation of Array.isArray(content.annotations)
        ? content.annotations
        : []) {
        if (
          isRecord(annotation) &&
          annotation.type === "url_citation" &&
          nonEmpty(annotation.url)
        ) {
          annotatedCitations.push({
            title: nonEmpty(annotation.title) ? annotation.title : annotation.url,
            url: annotation.url,
          });
        }
      }
    }
  }
  const unique = uniqueCitations([
    ...annotatedCitations,
    ...consultedSources,
  ]).slice(0, 10);
  if (!text && unique.length === 0) {
    throw new Error("OpenAI web search returned no evidence");
  }
  return { text, citations: unique };
}

function uniqueCitations(citations: SearchCitation[]): SearchCitation[] {
  const seen = new Set<string>();
  return citations.filter(({ url }) => {
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
