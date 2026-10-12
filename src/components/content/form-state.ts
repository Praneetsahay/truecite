import type { ActionState } from "@/lib/actions";

/**
 * The state the content forms return. `values` carries what the person typed
 * back to the form, so a failed save never empties it (forms reset after
 * their action runs). `key` changes after a successful add to clear it.
 */
export type ContentFormState = ActionState & {
  values?: Record<string, string>;
  key?: number;
};

export type ContentAction = (state: ContentFormState, formData: FormData) => Promise<ContentFormState>;
