"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncAction } from "@/app/actions";

export function SyncButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  function onClick() {
    setMsg(null);
    start(async () => {
      try {
        const r = await syncAction();
        setMsg(`완료 · 신규 ${r.created} / 수정 ${r.updated} / 유지 ${r.skipped}`);
        router.refresh();
      } catch (e: unknown) {
        setMsg(`실패: ${e instanceof Error ? e.message : "에러"}`);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={onClick}
        disabled={pending}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
      >
        {pending ? "동기화 중…" : "Notion 동기화"}
      </button>
      {msg && <span className="text-xs text-zinc-500">{msg}</span>}
    </div>
  );
}
