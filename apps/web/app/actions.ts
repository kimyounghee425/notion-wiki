"use server";

import { revalidatePath } from "next/cache";
import { syncPageList } from "@/lib/sync";

/** 목록 페이지의 "Notion 동기화" 버튼이 호출하는 서버 액션 */
export async function syncAction() {
  const result = await syncPageList();
  revalidatePath("/");
  return result;
}
