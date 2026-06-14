export default function Loading() {
  return (
    <main className="min-h-screen bg-white text-zinc-900">
      <div className="mx-auto max-w-3xl p-6">
        <p className="text-sm text-zinc-500">
          본문을 Notion에서 가져오는 중… (처음 여는 노트는 시간이 걸릴 수 있어요)
        </p>
      </div>
    </main>
  );
}
