import Link from "next/link";
import type { ReactNode } from "react";
import { GST_RATE, type Currency } from "@/lib/domain/constants";
import { formatMoney } from "@/lib/domain/format";
import { cx } from "@/lib/cx";

/*
  Pieces of the public pricing page. Every price in rupees carries "+ 18% GST",
  so no figure on the page can be mistaken for the total.
*/

export const gstLabel = `+ ${Math.round(GST_RATE * 100)}% GST`;

/** A price as a figure, with its period and, in rupees, the GST note. */
export function Price({
  amount,
  currency,
  per,
  prefix,
  size = "lg",
}: {
  amount: number;
  currency: Currency;
  per?: string;
  prefix?: string;
  size?: "lg" | "sm";
}) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
      {prefix ? <span className="text-graphite">{prefix}</span> : null}
      <span
        className={cx(
          "font-medium text-ink",
          size === "lg" ? "text-2xl tracking-[-0.02em]" : "text-base",
        )}
      >
        {formatMoney(amount, currency)}
      </span>
      {per ? <span className="text-graphite">{per}</span> : null}
      {currency === "INR" ? <span className="text-sm whitespace-nowrap text-graphite">{gstLabel}</span> : null}
    </span>
  );
}

/** Two links that switch the page between dollars and rupees. */
export function CurrencySwitch({ currency, detected }: { currency: Currency; detected: boolean }) {
  const options: { value: Currency; label: string; href: string }[] = [
    { value: "USD", label: "US dollars", href: "/pricing?currency=usd" },
    { value: "INR", label: "Indian rupees", href: "/pricing?currency=inr" },
  ];
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
      <nav aria-label="Currency" className="inline-flex self-start rounded-md border border-rule-strong bg-sheet p-0.5">
        {options.map((option) => {
          const active = option.value === currency;
          return (
            <Link
              key={option.value}
              href={option.href}
              scroll={false}
              aria-current={active ? "true" : undefined}
              className={cx(
                "inline-flex h-8 items-center rounded-sm px-3 text-sm transition-colors",
                active ? "bg-wash font-medium text-ink" : "text-graphite hover:text-ink",
              )}
            >
              {option.label}
            </Link>
          );
        })}
      </nav>
      <p className="text-sm text-graphite">
        {currency === "INR"
          ? `Prices exclude ${Math.round(GST_RATE * 100)}% GST. Indian companies receive GST invoices.`
          : "Prices in US dollars, for companies outside India."}
        {detected ? " Chosen from your location." : null}
      </p>
    </div>
  );
}

/** One row of a hairline list: a name, what it is, and its price. */
export function OfferRow({
  name,
  children,
  price,
  note,
}: {
  name: string;
  children: ReactNode;
  price: ReactNode;
  note?: ReactNode;
}) {
  return (
    <li className="grid gap-2 border-b border-rule py-6 md:grid-cols-[10rem_minmax(0,1fr)_minmax(0,18rem)] md:gap-8">
      <h3 className="text-xl font-semibold tracking-[-0.01em] text-ink">{name}</h3>
      <div className="text-ink">{children}</div>
      <div>
        <div>{price}</div>
        {note ? <div className="mt-1 text-sm text-graphite">{note}</div> : null}
      </div>
    </li>
  );
}
