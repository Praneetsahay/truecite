/*
  The Fix Playbook: standard fixes for each type of error. TrueCite shows the
  relevant steps inside every issue. Add to it as you learn from real clients.
*/

export type PlaybookEntry = {
  label: string;
  cause: string;
  steps: string[];
};

export const PLAYBOOK = {
  wrong_price: {
    label: "Wrong price",
    cause: "Old review articles, old pricing pages that are still live, or outdated listings.",
    steps: [
      "Update the pricing page so every price is written as plain text.",
      "Redirect old pricing pages to the current one.",
      "Ask publishers of outdated reviews to update their articles.",
      "Add a pricing FAQ that states current prices and the date they took effect.",
    ],
  },
  product_status: {
    label: "Product described as discontinued, or a product that doesn't exist",
    cause: "Old press releases, or retired product pages without redirects.",
    steps: [
      "Publish a clear page that lists current products.",
      "Redirect retired product pages to their replacements.",
      "Update directory and marketplace listings.",
    ],
  },
  confused_company: {
    label: "Confused with another company",
    cause: "A similar name, or company details that differ across the web.",
    steps: [
      "Add a clear description of the company to the About page.",
      "Keep the company name and details consistent on LinkedIn, Crunchbase and directories.",
      "Add Organization structured data that links to official profiles.",
    ],
  },
  false_scandal: {
    label: "False scandal or legal claim",
    cause: "Misattributed news, or rumors on forums.",
    steps: [
      "Publish a factual clarification on your website.",
      "Ask the publisher for a correction.",
      "Involve your PR team.",
      "Have your lawyers review anything that may be defamatory.",
    ],
  },
  outdated_facts: {
    label: "Outdated leadership or company facts",
    cause: "Old bios and press kits.",
    steps: [
      "Update the leadership page and the press kit.",
      "Update company and leadership details on LinkedIn.",
      "For Wikipedia, request changes on the article's talk page instead of editing it directly, as its conflict-of-interest guideline expects.",
    ],
  },
  wrong_policy: {
    label: "Wrong policy (refunds, warranty, fees)",
    cause: "Old policy pages or third-party summaries.",
    steps: [
      "Update policy pages and show the date each one took effect.",
      "Add an FAQ that answers the policy question directly.",
      "Remove or redirect old versions of the policy.",
    ],
  },
  unreadable_pages: {
    label: "AI cannot read your pages",
    cause: "AI crawlers blocked in robots.txt, or pages that need JavaScript to show content.",
    steps: [
      "Allow the AI crawlers you want in robots.txt.",
      "Make key pages readable without JavaScript.",
    ],
  },
  old_reviews: {
    label: "Negative answers based on old reviews",
    cause: "Few recent reviews on major platforms.",
    steps: [
      "Respond to reviews publicly.",
      "Encourage recent customers to leave honest reviews.",
    ],
  },
  other: {
    label: "Other error",
    cause: "Several possible sources.",
    steps: [
      "Check the cited sources and correct anything you control.",
      "Make sure the correct fact is stated plainly on your website.",
    ],
  },
} as const satisfies Record<string, PlaybookEntry>;

export type ErrorType = keyof typeof PLAYBOOK;
export const ERROR_TYPE_IDS = Object.keys(PLAYBOOK) as ErrorType[];

export const PLAYBOOK_TIMING_NOTE =
  "TrueCite never promises that an AI assistant will change its answer by a certain date. Assistants that use live web search often update within days or weeks, while answers based on training data can take months.";
