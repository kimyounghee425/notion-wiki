import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { NotionConnector } from "@repo/core";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function NotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const note = await prisma.note.findUnique({ where: { id } });
  if (!note) notFound();

  // 본문 캐시가 없으면 Notion 에서 on-demand 로 가져와 저장 (첫 방문만 느림)
  let markdown = note.markdown;
  if (!markdown) {
    const token = process.env.NOTION_TOKEN;
    if (token) {
      const connector = new NotionConnector(token);
      markdown = await connector.fetchPageMarkdown(note.notionId);
      await prisma.note.update({
        where: { id: note.id },
        data: { markdown, syncedAt: new Date() },
      });
    }
  }

  // 변환기가 가독성용 들여쓰기를 넣어서, 표준 markdown 으로 렌더하려면 줄 앞 공백 제거.
  // (v1: 중첩 깊이는 평탄화됨. 헤딩/리스트/굵게/링크는 정상 렌더)
  const clean = (markdown || "").replace(/^[ \t]+/gm, "");

  return (
    <main className="min-h-screen bg-white text-zinc-900">
      <div className="mx-auto max-w-3xl p-6">
        <Link href="/" className="text-sm text-blue-600 hover:underline">
          ← 목록
        </Link>
        <h1 className="mt-3 text-2xl font-bold">{note.title || "(제목 없음)"}</h1>
        <a
          href={note.url}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-zinc-400 hover:underline"
        >
          Notion에서 열기 ↗
        </a>
        <article className="prose prose-zinc prose-sm mt-6 max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {clean || "_본문이 없습니다._"}
          </ReactMarkdown>
        </article>
      </div>
    </main>
  );
}
