import { z } from "zod";
import { PermissionError } from "@/lib/auth/dal";
import { EngineError, EngineNotReadyError } from "@/lib/engine/errors";

/** The state a form's Server Action returns to useActionState. */
export type ActionState = {
  ok?: boolean;
  message?: string;
  fieldErrors?: Partial<Record<string, string>>;
};

export const idle: ActionState = {};

/** Field errors from a failed zod parse, one message per field. */
export function fieldErrors(error: z.ZodError): Partial<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    result[key] ??= issue.message;
  }
  return result;
}

/**
 * Turns a thrown error into a message for the person. Errors we expect
 * (permissions, engine availability, engine problems) keep their message;
 * anything else gets a plain next step. Framework control flow such as
 * redirect() must be rethrown by the caller before this is used.
 */
export function actionError(error: unknown): ActionState {
  if (error instanceof PermissionError || error instanceof EngineNotReadyError || error instanceof EngineError) {
    return { ok: false, message: error.message };
  }
  if (error instanceof z.ZodError) {
    return { ok: false, fieldErrors: fieldErrors(error), message: "Some fields need attention." };
  }
  console.error(error);
  return { ok: false, message: "That didn't save. Try again, and if it keeps happening, contact support." };
}
