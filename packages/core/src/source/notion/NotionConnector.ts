import { Client } from "@notionhq/client";
import type { RawPage, SourceConnector } from "../SourceConnector";
import { blocksToMarkdown } from "./blocksToMarkdown";

/** search 결과 객체에서 사람이 읽을 제목 추출 (페이지/DB 형태 차이 방어) */
function extractTitle(obj: any): string {
  if (Array.isArray(obj.title) && obj.title.length) {
    return obj.title.map((t: any) => t.plain_text).join("") || "(제목 없음)";
  }
  if (obj.properties) {
    for (const key of Object.keys(obj.properties)) {
      const prop = obj.properties[key];
      if (prop?.type === "title" && Array.isArray(prop.title)) {
        return prop.title.map((t: any) => t.plain_text).join("") || "(제목 없음)";
      }
    }
  }
  return "(제목 없음)";
}

/**
 * Notion integration 토큰 기반 SourceConnector (v1: 단일 사용자).
 * 멀티유저는 나중에 OAuth 토큰을 주입하는 식으로 확장한다.
 */
export class NotionConnector implements SourceConnector {
  private notion: Client;

  constructor(token: string) {
    this.notion = new Client({ auth: token });
  }

  /** 공유된 모든 페이지 메타. search 100개 상한을 next_cursor 로 모두 순회. */
  async listPages(): Promise<RawPage[]> {
    const pages: RawPage[] = [];
    let cursor: string | undefined = undefined;

    do {
      const res: any = await this.notion.search({
        page_size: 100,
        start_cursor: cursor,
        filter: { property: "object", value: "page" },
      });

      for (const r of res.results as any[]) {
        pages.push({
          id: r.id,
          title: extractTitle(r),
          url: r.url ?? "",
          lastEditedTime: r.last_edited_time ?? "",
        });
      }

      cursor = res.has_more ? res.next_cursor : undefined;
    } while (cursor);

    return pages;
  }

  async fetchPageMarkdown(pageId: string): Promise<string> {
    const { markdown } = await blocksToMarkdown(this.notion, pageId);
    return markdown;
  }
}
