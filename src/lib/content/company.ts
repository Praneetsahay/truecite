/*
  Facts about TrueCite itself, used on the contact and legal pages.
  Change them here so every page says the same thing.
*/

export const COMPANY = {
  name: "TrueCite",
  email: "contact@truecite.example",
  /** Shown on the contact page and in the legal pages until the business is registered. */
  registeredAddress: null as string | null,
  supportHours: "Monday to Friday, 10:00 to 18:00 India time",
  replyTime: "one working day",
} as const;

/** Every legal page carries this date as static text. Update it whenever a policy changes. */
export const LEGAL_LAST_UPDATED = "11 October 2026";
