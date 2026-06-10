/**
 * 노트 소스 추상화.
 * v1 구현체: NotionConnector. 나중에: NotionOAuthConnector, ObsidianConnector 등이
 * 이 인터페이스를 구현하면 상위 로직(동기화/위키 생성)은 그대로 재사용된다.
 */

/** 페이지 1개의 메타데이터 (목록/변경 감지용). 본문은 따로 fetch 한다. */
export interface RawPage {
  id: string;
  title: string;
  url: string;
  /** ISO 8601. Notion 의 last_edited_time → 증분 동기화의 핵심 키 */
  lastEditedTime: string;
}

export interface SourceConnector {
  /** 접근 가능한 모든 페이지의 메타데이터. 페이지네이션은 구현체 내부에서 처리. */
  listPages(): Promise<RawPage[]>;

  /** 페이지 1개를 markdown 본문으로 변환. 중첩 블록 재귀 포함. */
  fetchPageMarkdown(pageId: string): Promise<string>;
}
