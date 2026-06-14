import { syncPageList } from "@/lib/sync";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    return Response.json(await syncPageList());
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "sync 실패";
    return Response.json({ error: message }, { status: 500 });
  }
}
