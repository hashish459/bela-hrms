"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { markNoticeRead } from "@/modules/selfservice/desk";
import { requireSelf } from "@/modules/selfservice/guard";

export type ReadState = { ok?: boolean; error?: string };

const schema = z.object({ noticeId: z.string().uuid() });

/**
 * Marks a notice read for the signed-in employee.
 *
 * The employee id is never accepted from the form — `requireSelf()` reads it
 * from the session, so this action cannot be replayed to mark a notice read on
 * somebody else's behalf. The notice id is validated as a uuid before it reaches
 * a query.
 */
export async function markRead(_prev: ReadState, formData: FormData): Promise<ReadState> {
  const ctx = await requireSelf("self.notice.read");

  const parsed = schema.safeParse({ noticeId: formData.get("noticeId") });
  if (!parsed.success) return { error: "That notice no longer exists." };

  await markNoticeRead(ctx, parsed.data.noticeId);

  revalidatePath("/me/notices");
  revalidatePath("/me");
  return { ok: true };
}
