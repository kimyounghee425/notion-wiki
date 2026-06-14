import { NotionConnector } from "@repo/core";
import { prisma } from "@/lib/prisma";

/**
 * 페이지 "목록" 동기화 (메타데이터만). 본문은 비싸서 상세 페이지에서 on-demand.
 * last_edited_time 비교로 증분 처리.
 */
export async function syncPageList() {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error("NOTION_TOKEN 환경변수 없음");

  const connector = new NotionConnector(token);
  const pages = await connector.listPages();

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

  return { fetched: pages.length, created, updated, skipped };
}
