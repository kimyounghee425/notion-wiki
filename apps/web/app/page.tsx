import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { SyncButton } from "@/components/SyncButton";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [notes, sync] = await Promise.all([
    prisma.note.findMany({ orderBy: { lastEditedTime: "desc" } }),
    prisma.syncState.findUnique({ where: { id: "singleton" } }),
  ]);

  return (
    <main className="min-h-screen bg-white text-zinc-900">
      <div className="mx-auto max-w-3xl p-6">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">내 Notion 노트</h1>
            <p className="mt-1 text-sm text-zinc-500">
              {notes.length}개 · 마지막 동기화{" "}
              {sync?.lastSyncedAt
                ? new Date(sync.lastSyncedAt).toLocaleString("ko-KR")
                : "없음"}
            </p>
          </div>
          <SyncButton />
        </header>

        {notes.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-zinc-500">
            아직 노트가 없어요. &quot;Notion 동기화&quot;를 눌러 가져오세요.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200">
            {notes.map((n) => (
              <li key={n.id}>
                <Link
                  href={`/notes/${n.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-zinc-50"
                >
                  <span className="truncate font-medium">{n.title || "(제목 없음)"}</span>
                  <span className="shrink-0 text-xs text-zinc-400">
                    {new Date(n.lastEditedTime).toLocaleDateString("ko-KR")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
