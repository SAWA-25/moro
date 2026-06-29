export interface ForumTrendTestItem {
  title: string;
  source: string;
  url?: string;
  heat?: number;
  tags?: string[];
}

export interface ForumTrendTestPack {
  items: ForumTrendTestItem[];
  fetchedAt: number;
  expiresAt: number;
  sources: string[];
  errors: string[];
}

export const __forumTrendsTest: {
  parseForumTrendXml(xml: string, source: string, limit?: number): ForumTrendTestItem[];
  mergeForumTrendItems(groups: ForumTrendTestItem[][], limit?: number): ForumTrendTestItem[];
  buildForumTrendPack(now?: number, fetcher?: typeof fetch): Promise<ForumTrendTestPack>;
};

export const __xhsLiteTest: unknown;

declare const worker: {
  fetch(request: Request, env?: unknown, ctx?: unknown): Promise<Response>;
};

export default worker;
