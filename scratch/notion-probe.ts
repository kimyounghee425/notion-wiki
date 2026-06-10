/**
 * Phase 0 스파이크 — Notion API 구조 확인용
 *
 * 목적:
 *   1) 내 integration 토큰으로 "공유된" 페이지/DB 목록 가져오기
 *   2) 페이지 1개의 블록(block) 트리가 어떻게 생겼는지 raw JSON으로 확인
 *   3) notion-to-md로 그 페이지를 markdown으로 변환해서 출력
 *
 * 실행:  pnpm probe   (또는 npm run probe)
 *
 * 주의:
 *   - integration에 "공유(Connect)"된 페이지만 보인다. 안 보이면 그게 정상.
 *     Notion 페이지 → ··· → 연결(Connections) → 내 integration 선택.
 *   - 토큰은 .env 의 NOTION_TOKEN 에서 읽는다. 코드에 하드코딩 금지.
 */

import "dotenv/config";
import { Client } from "@notionhq/client";

const token = process.env.NOTION_TOKEN;
if (!token) {
  console.error("❌ NOTION_TOKEN 이 없습니다. .env 에 토큰을 넣으세요.");
  process.exit(1);
}

const notion = new Client({ auth: token });

// API 호출 수를 세서, 큰 페이지에서 얼마나 호출되는지 체감한다 (rate limit 감각용)
let apiCalls = 0;

/** search 결과 객체에서 사람이 읽을 제목을 최대한 뽑아낸다 (페이지/DB 형태가 달라서 방어적으로) */
function getTitle(obj: any): string {
  // 데이터베이스: title 배열이 최상위에 있음
  if (Array.isArray(obj.title) && obj.title.length) {
    return obj.title.map((t: any) => t.plain_text).join("");
  }
  // 페이지: properties 중 type === "title" 인 것을 찾는다
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

/** rich_text 배열 → 마크다운 인라인 문자열 (bold/italic/code/링크 반영) */
function richText(rich: any[] = []): string {
  return rich
    .map((t) => {
      let s = t.plain_text ?? "";
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

/**
 * 직접 만든 블록 → 마크다운 변환기 (Phase 1 NotionConnector 의 미니 프로토타입).
 * 핵심 블록 타입만 처리하고, has_children 인 블록은 재귀로 자식까지 가져온다.
 * indent 는 중첩 리스트/토글의 들여쓰기 단계.
 */
const MAX_API_CALLS = 300; // 폭주 방지 circuit breaker

async function blocksToMarkdown(blockId: string, indent = 0): Promise<string> {
  const pad = "  ".repeat(indent);
  const lines: string[] = [];

  // 페이지네이션: 한 블록의 자식이 100개 넘으면 cursor 로 이어 받는다
  let cursor: string | undefined = undefined;
  do {
    if (apiCalls >= MAX_API_CALLS) {
      lines.push(`${pad}<!-- ⚠️ API 호출 상한(${MAX_API_CALLS}) 도달, 중단 -->`);
      break;
    }
    apiCalls++;
    // 실시간 진행 로그 (stderr 라 즉시 보임) — 어디서 멈추는지/느린지 확인용
    process.stderr.write(`  · API #${apiCalls} (depth ${indent}) block=${blockId.slice(0, 8)}…\n`);
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
          lines.push(`${pad}\`\`\`${data.language ?? ""}\n${richText(data.rich_text)}\n${pad}\`\`\``);
          break;
        case "divider":
          lines.push(`${pad}---`);
          break;
        case "child_page":
          lines.push(`${pad}📄 (하위 페이지) ${data.title}`);
          break;
        default:
          // 처리 안 한 타입은 일단 표시만 (어떤 타입이 더 필요한지 Phase 0 에서 파악)
          lines.push(`${pad}<!-- 미지원 블록: ${type} -->`);
      }

      // 자식 블록 재귀. child_page(별도 페이지), child_database(쿼리 필요)는 제외.
      // 한 블록에서 에러 나도 전체가 죽지 않게 try/catch 로 격리.
      const skipRecurse = type === "child_page" || type === "child_database";
      if (b.has_children && !skipRecurse) {
        try {
          const child = await blocksToMarkdown(b.id, indent + 1);
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

async function main() {
  console.log("🔍 공유된 페이지/DB 검색 중...\n");

  // search() 는 integration 에 공유된 항목만 반환한다. (한 번에 최대 100개; 더 있으면 next_cursor 로 페이지네이션)
  const search = await notion.search({ page_size: 100 });

  if (search.results.length === 0) {
    console.log(
      "⚠️ 보이는 항목이 0개입니다.\n" +
        "   → Notion 에서 테스트 페이지를 열고 ··· → 연결(Connections) → integration 을 연결했는지 확인하세요."
    );
    return;
  }

  console.log(
    `✅ ${search.results.length}개 항목 발견` +
      (search.has_more ? " (⚠️ 100개 상한에 걸림 — 더 있음. 목록도 페이지네이션 필요!)" : "") +
      ". 처음 10개만 표시:\n"
  );
  search.results.slice(0, 10).forEach((r: any, i: number) => {
    console.log(`  [${i}] ${r.object.padEnd(8)} | ${getTitle(r)}  (${r.id})`);
  });

  // 첫 번째 "page" 를 골라서 깊이 들여다본다
  const firstPage: any = search.results.find((r: any) => r.object === "page");
  if (!firstPage) {
    console.log("\n(페이지가 없습니다. 데이터베이스만 공유된 상태일 수 있어요.)");
    return;
  }

  console.log("\n" + "=".repeat(70));
  console.log(`📄 페이지 상세: ${getTitle(firstPage)} (${firstPage.id})`);
  console.log("=".repeat(70));

  // 1) raw 블록 구조 — Notion 의 데이터 모델(블록 트리)을 눈으로 확인
  console.log("\n--- [1] 최상위 블록 raw JSON (1개만) ---\n");
  const blocks = await notion.blocks.children.list({ block_id: firstPage.id, page_size: 10 });
  console.log(JSON.stringify(blocks.results.slice(0, 1), null, 2));
  console.log(`\n(이 페이지의 최상위 블록 수: ${blocks.results.length}, has_more=${blocks.has_more})`);
  console.log("※ has_children=true 인 블록은 자식 블록을 재귀로 또 가져와야 함 — 이게 동기화 로직의 핵심 난점.");

  // 2) 직접 만든 변환기 — notion-to-md(블랙박스) 버리고 우리가 블록을 직접 변환
  //    (Phase 1 NotionConnector 의 미니 프로토타입. 핵심 블록 타입 + 자식 재귀)
  console.log("\n--- [2] 자체 변환기로 markdown 생성 ---\n");
  const t0 = Date.now();
  const myMarkdown = await blocksToMarkdown(firstPage.id);
  const ms = Date.now() - t0;
  console.log(myMarkdown || "(빈 페이지)");

  console.log("\n" + "-".repeat(40));
  console.log(`⏱️  변환 시간: ${ms}ms,  Notion API 호출 수: ${apiCalls}회`);
  const unsupported = [...myMarkdown.matchAll(/미지원 블록: (\w+)/g)].map((m) => m[1]);
  if (unsupported.length) {
    console.log(`⚠️  미지원 블록 타입 발견: ${[...new Set(unsupported)].join(", ")}`);
    console.log("   → 이 타입들을 blocksToMarkdown 의 switch 에 추가하면 됩니다.");
  } else {
    console.log("✅ 미지원 블록 없음 — 이 페이지는 완전히 변환됨.");
  }
  console.log("   → 이 blocksToMarkdown 이 Phase 1 NotionConnector 의 뼈대가 됩니다.");
}

main().catch((err) => {
  console.error("\n❌ 에러 발생:");
  console.error(err?.body ?? err);
  process.exit(1);
});
