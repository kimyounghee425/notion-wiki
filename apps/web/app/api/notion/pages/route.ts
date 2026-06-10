import { NotionConnector } from "@repo/core";

// Notion 호출이 있으므로 항상 동적 실행 (빌드 시 미실행)
export const dynamic = "force-dynamic";

export async function GET() {
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    return Response.json(
      { error: "NOTION_TOKEN 환경변수가 없습니다. apps/web/.env.local 에 넣으세요." },
      { status: 500 }
    );
  }

  const connector = new NotionConnector(token);
  const pages = await connector.listPages();

  return Response.json({ count: pages.length, pages });
}
