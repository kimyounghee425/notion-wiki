import { NotionConnector } from "@repo/core";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * 페이지 "목록" 동기화 (메타데이터만). 본문(markdown)은 비싸서(페이지당 수십~백 콜)
 * 별도 단계에서 가져온다. last_edited_time 비교로 증분 처리.
 */
export async function POST() {
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    return Response.json({ error: "NOTION_TOKEN 환경변수 없음" }, { status: 500 });
  }

  const connector = new NotionConnector(token);
  const pages = await connector.listPages();

  // 기존 노트의 notionId → lastEditedTime 맵 (증분 판단용)
  const existing = await prisma.note.findMany({
    select: { notionId: true, lastEditedTime: true },
  });
  const seen = new Map(existing.map((n) => [n.notionId, n.lastEditedTime.getTime()]));

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const p of pages) {
    const lastEdited = p.lastEditedTime ? new Date(p.lastEditedTime) : new Date();
    const prev = seen.get(p.id);

    if (prev === undefined) {
      await prisma.note.create({
        data: { notionId: p.id, title: p.title, url: p.url, lastEditedTime: lastEdited },
      });
      created++;
    } else if (prev !== lastEdited.getTime()) {
      await prisma.note.update({
        where: { notionId: p.id },
        data: { title: p.title, url: p.url, lastEditedTime: lastEdited },
      });
      updated++;
    } else {
      skipped++;
    }
  }

  await prisma.syncState.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", lastSyncedAt: new Date() },
    update: { lastSyncedAt: new Date() },
  });

  return Response.json({
    fetched: pages.length,
    created,
    updated,
    skipped, // 변경 없어 건너뛴 수 (증분 동작 확인용)
  });
}
