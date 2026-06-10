import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** DB 에 캐시된 노트 목록 (최근 수정순). Notion 재호출 없이 로컬에서 즉시. */
export async function GET() {
  const [count, notes, sync] = await Promise.all([
    prisma.note.count(),
    prisma.note.findMany({
      orderBy: { lastEditedTime: "desc" },
      select: { notionId: true, title: true, url: true, lastEditedTime: true },
    }),
    prisma.syncState.findUnique({ where: { id: "singleton" } }),
  ]);

  return Response.json({ count, lastSyncedAt: sync?.lastSyncedAt ?? null, notes });
}
