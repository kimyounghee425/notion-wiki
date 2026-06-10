import type { Client } from "@notionhq/client";

/**
 * Notion 블록 트리 → markdown 변환기.
 * (scratch/notion-probe.ts 에서 실제 데이터로 검증한 로직을 옮긴 것)
 *
 * ⚠️ Notion 엔 "페이지 통째로" API 가 없다. 중첩 블록마다 children.list 를 호출하므로
 *    깊은 페이지 1개가 수십~백 번 호출될 수 있다 (실측: 깊은 페이지 98회/34초).
 *    → 호출 수를 ctx 로 추적하고 상한(circuit breaker)을 둔다. 동시성/캐싱은 상위에서.
 */

const DEFAULT_MAX_API_CALLS = 500;

export interface ConvertContext {
  apiCalls: number;
  maxApiCalls: number;
}

/** rich_text 배열 → markdown 인라인 문자열 (bold/italic/code/strike/링크 반영) */
function richText(rich: any[] = []): string {
  return rich
    .map((t) => {
      let s: string = t.plain_text ?? "";
      const a = t.annotations ?? {};
      if (a.code) s = `\`${s}\``;
      if (a.bold) s = `**${s}**`;
      if (a.italic) s = `*${s}*`;
      if (a.strikethrough) s = `~~${s}~~`;
      if (t.href) s = `[${s}](${t.href})`;
      return s;
    })
    .join("");
}

async function walk(
  notion: Client,
  blockId: string,
  indent: number,
  ctx: ConvertContext
): Promise<string> {
  const pad = "  ".repeat(indent);
  const lines: string[] = [];

  let cursor: string | undefined = undefined;
  do {
    if (ctx.apiCalls >= ctx.maxApiCalls) {
      lines.push(`${pad}<!-- ⚠️ API 호출 상한(${ctx.maxApiCalls}) 도달, 일부 누락 -->`);
      break;
    }
    ctx.apiCalls++;
    const res: any = await notion.blocks.children.list({
      block_id: blockId,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const b of res.results as any[]) {
      const type: string = b.type;
      const data = b[type];

      switch (type) {
        case "paragraph":
          lines.push(pad + richText(data.rich_text));
          break;
        case "heading_1":
          lines.push(`${pad}# ${richText(data.rich_text)}`);
          break;
        case "heading_2":
          lines.push(`${pad}## ${richText(data.rich_text)}`);
          break;
        case "heading_3":
          lines.push(`${pad}### ${richText(data.rich_text)}`);
          break;
        case "bulleted_list_item":
          lines.push(`${pad}- ${richText(data.rich_text)}`);
          break;
        case "numbered_list_item":
          lines.push(`${pad}1. ${richText(data.rich_text)}`);
          break;
        case "to_do":
          lines.push(`${pad}- [${data.checked ? "x" : " "}] ${richText(data.rich_text)}`);
          break;
        case "toggle":
          lines.push(`${pad}- ${richText(data.rich_text)}`);
          break;
        case "quote":
          lines.push(`${pad}> ${richText(data.rich_text)}`);
          break;
        case "callout":
          lines.push(`${pad}> ${data.icon?.emoji ?? "💡"} ${richText(data.rich_text)}`);
          break;
        case "code":
          lines.push(
            `${pad}\`\`\`${data.language ?? ""}\n${richText(data.rich_text)}\n${pad}\`\`\``
          );
          break;
        case "divider":
          lines.push(`${pad}---`);
          break;
        case "child_page":
          lines.push(`${pad}📄 (하위 페이지) ${data.title}`);
          break;
        default:
          // 처리 안 한 타입은 표시만 (어떤 타입을 더 채울지 파악용)
          lines.push(`${pad}<!-- 미지원 블록: ${type} -->`);
      }

      // 자식 재귀. child_page(별도 페이지), child_database(쿼리 필요)는 제외.
      // 한 블록 에러가 전체를 죽이지 않게 격리.
      const skipRecurse = type === "child_page" || type === "child_database";
      if (b.has_children && !skipRecurse) {
        try {
          const child = await walk(notion, b.id, indent + 1, ctx);
          if (child.trim()) lines.push(child);
        } catch (e: any) {
          lines.push(`${pad}  <!-- 자식 로드 실패(${type}): ${e?.code ?? e?.message ?? "?"} -->`);
        }
      }
    }

    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  return lines.join("\n");
}

export async function blocksToMarkdown(
  notion: Client,
  pageId: string,
  maxApiCalls: number = DEFAULT_MAX_API_CALLS
): Promise<{ markdown: string; apiCalls: number }> {
  const ctx: ConvertContext = { apiCalls: 0, maxApiCalls };
  const markdown = await walk(notion, pageId, 0, ctx);
  return { markdown, apiCalls: ctx.apiCalls };
}
