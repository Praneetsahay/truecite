"use server";

import { refresh } from "next/cache";
import { actionError, type ActionState } from "@/lib/actions";
import { requireEditor } from "@/lib/auth/dal";
import { startScan } from "@/lib/engine";
import { hasActiveScan } from "@/lib/queries/dashboard";

/**
 * "Run a scan now": asks every active question on the brand's platforms, the
 * same as a scheduled scan. Members and owners only; one full scan at a time.
 */
export async function runScanNow(_state: ActionState, _formData: FormData): Promise<ActionState> {
  void _state;
  void _formData;
  try {
    const ctx = await requireEditor();
    if (await hasActiveScan(ctx.brand.id)) {
      return {
        ok: false,
        message: "A scan is already running. Its progress is shown on this page, and results appear when it finishes.",
      };
    }
    await startScan({ brandId: ctx.brand.id, type: "manual", triggeredBy: ctx.user.id, note: "Started from the dashboard" });
  } catch (error) {
    return actionError(error);
  }
  refresh();
  return { ok: true, message: "Scan started. Progress appears here as answers come in." };
}
