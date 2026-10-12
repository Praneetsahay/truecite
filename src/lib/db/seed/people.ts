import { hashPassword } from "@/lib/auth/password";
import { GST_RATE, type Currency, type InvoiceStatus } from "@/lib/domain/constants";
import { invoices, memberships, organizations, subscriptions, users } from "../schema";
import {
  addDays,
  addHours,
  insertRows,
  istTime,
  monthName,
  monthStart,
  rngFor,
  shiftDay,
  shiftMonths,
  type SeedContext,
} from "./util";

/*
  People, accounts and billing: the TrueCite admin, the client teams, their plans,
  subscriptions and invoices. Every password is "truecite".
*/

export type UserKey = "sam" | "priya" | "karan" | "neha" | "arjun" | "emma" | "vikram";
export type OrgKey = "acme" | "woodgrove" | "litware" | "proseware" | "prospects";

export type People = {
  users: Record<UserKey, { id: string; name: string; email: string }>;
  orgs: Record<OrgKey, string>;
};

type UserSeed = {
  key: UserKey;
  name: string;
  email: string;
  title: string | null;
  isAdmin?: boolean;
  twoFactor?: boolean;
  org?: OrgKey;
  role?: "owner" | "member" | "viewer";
  createdDaysAgo: number;
  lastLoginHoursAgo: number;
};

const USERS: UserSeed[] = [
  { key: "sam", name: "Sam Varghese", email: "admin@truecite.example", title: "Founder, TrueCite", isAdmin: true, twoFactor: true, createdDaysAgo: 210, lastLoginHoursAgo: 14 },
  { key: "priya", name: "Priya Raman", email: "priya@acme.example", title: "Head of Corporate Communications", org: "acme", role: "owner", createdDaysAgo: 104, lastLoginHoursAgo: 13 },
  { key: "karan", name: "Karan Shah", email: "karan@acme.example", title: "Brand Manager", org: "acme", role: "member", createdDaysAgo: 103, lastLoginHoursAgo: 40 },
  { key: "neha", name: "Neha Kulkarni", email: "neha@acme.example", title: "Legal Counsel", org: "acme", role: "viewer", twoFactor: true, createdDaysAgo: 88, lastLoginHoursAgo: 75 },
  { key: "arjun", name: "Arjun Menon", email: "arjun@woodgrove.example", title: "Head of PR", org: "woodgrove", role: "owner", createdDaysAgo: 150, lastLoginHoursAgo: 98 },
  { key: "emma", name: "Emma Clarke", email: "emma@litware.example", title: "Communications Director", org: "litware", role: "owner", createdDaysAgo: 120, lastLoginHoursAgo: 44 },
  { key: "vikram", name: "Vikram Iyer", email: "vikram@proseware.example", title: "Marketing Director", org: "proseware", role: "owner", createdDaysAgo: 2, lastLoginHoursAgo: 20 },
];

const ORGS: { key: OrgKey; name: string; plan: "trial" | "starter" | "professional"; country: "IN" | "GB"; currency: Currency; internal?: boolean; createdDaysAgo: number }[] = [
  { key: "prospects", name: "TrueCite prospects", plan: "trial", country: "IN", currency: "INR", internal: true, createdDaysAgo: 210 },
  { key: "woodgrove", name: "Woodgrove Bank", plan: "starter", country: "IN", currency: "INR", createdDaysAgo: 151 },
  { key: "litware", name: "Litware Insurance", plan: "professional", country: "GB", currency: "USD", createdDaysAgo: 121 },
  { key: "acme", name: "Acme", plan: "professional", country: "IN", currency: "INR", createdDaysAgo: 105 },
  { key: "proseware", name: "Proseware", plan: "trial", country: "IN", currency: "INR", createdDaysAgo: 2 },
];

export async function seedPeople(ctx: SeedContext): Promise<People> {
  const { db, anchor } = ctx;
  const orgIds = {} as Record<OrgKey, string>;
  const orgRows = ORGS.map((o) => {
    orgIds[o.key] = ctx.newId();
    return {
      id: orgIds[o.key],
      name: o.name,
      plan: o.plan,
      country: o.country,
      currency: o.currency,
      internal: o.internal ?? false,
      createdAt: addDays(anchor, -o.createdDaysAgo),
    };
  });
  await insertRows(db, organizations, orgRows);

  const hashes = await Promise.all(USERS.map(() => hashPassword("truecite")));
  const userRefs = {} as People["users"];
  const userRows = USERS.map((u, index) => {
    const id = ctx.newId();
    userRefs[u.key] = { id, name: u.name, email: u.email };
    return {
      id,
      name: u.name,
      email: u.email,
      passwordHash: hashes[index],
      title: u.title,
      isAdmin: u.isAdmin ?? false,
      twoFactorEnabled: u.twoFactor ?? false,
      lastLoginAt: addHours(anchor, -u.lastLoginHoursAgo),
      createdAt: addDays(anchor, -u.createdDaysAgo),
    };
  });
  await insertRows(db, users, userRows);

  await insertRows(
    db,
    memberships,
    USERS.filter((u) => u.org).map((u) => ({
      id: ctx.newId(),
      userId: userRefs[u.key].id,
      organizationId: orgIds[u.org!],
      role: u.role ?? "member",
      createdAt: addDays(anchor, -u.createdDaysAgo),
    })),
  );

  await seedBilling(ctx, orgIds);
  return { users: userRefs, orgs: orgIds };
}

async function seedBilling(ctx: SeedContext, orgs: Record<OrgKey, string>): Promise<void> {
  const { db, anchor, anchorDay } = ctx;
  const nextMonth = monthStart(anchorDay, 1);

  await insertRows(db, subscriptions, [
    {
      id: ctx.newId(),
      organizationId: orgs.acme,
      provider: "manual",
      plan: "professional",
      status: "active",
      amount: 35000,
      currency: "INR",
      interval: "month",
      founding: false,
      renewsAt: nextMonth,
      createdAt: addDays(anchor, -80),
    },
    {
      id: ctx.newId(),
      organizationId: orgs.woodgrove,
      provider: "razorpay",
      plan: "starter",
      status: "active",
      amount: 12000,
      currency: "INR",
      interval: "month",
      founding: true,
      priceLockedUntil: shiftMonths(anchorDay, 10),
      renewsAt: nextMonth,
      createdAt: addDays(anchor, -150),
    },
    {
      id: ctx.newId(),
      organizationId: orgs.litware,
      provider: "paddle",
      plan: "professional",
      status: "active",
      amount: 2500,
      currency: "USD",
      interval: "month",
      founding: false,
      renewsAt: nextMonth,
      createdAt: addDays(anchor, -120),
    },
  ]);

  type Draft = {
    organizationId: string;
    description: string;
    amount: number;
    tax: number;
    currency: Currency;
    status: InvoiceStatus;
    issuedOn: string;
    dueOn: string;
    paidOn: string | null;
  };
  const drafts: Draft[] = [];
  const monthly = (org: string, label: string, amount: number, currency: Currency, termsDays: number, startDay: string) => {
    for (let m = -3; m <= 0; m++) {
      const first = monthStart(anchorDay, m);
      const issuedOn = first < startDay && m === -3 ? startDay : first;
      const current = m === 0;
      const rng = rngFor("invoice", org, m);
      drafts.push({
        organizationId: org,
        description: `${label}, ${monthName(first)} ${first.slice(0, 4)}`,
        amount,
        tax: currency === "INR" ? Math.round(amount * GST_RATE) : 0,
        currency,
        status: current ? "due" : "paid",
        issuedOn,
        dueOn: shiftDay(issuedOn, termsDays),
        paidOn: current ? null : shiftDay(issuedOn, rng.int(9, termsDays - 3)),
      });
    }
  };
  monthly(orgs.acme, "Professional plan", 35000, "INR", 30, shiftDay(anchorDay, -80));
  monthly(orgs.woodgrove, "Starter plan, founding price", 12000, "INR", 30, shiftDay(anchorDay, -150));
  monthly(orgs.litware, "Professional plan", 2500, "USD", 15, shiftDay(anchorDay, -120));
  const auditIssued = shiftDay(anchorDay, -95);
  drafts.push({
    organizationId: orgs.acme,
    description: "Full audit",
    amount: 15000,
    tax: Math.round(15000 * GST_RATE),
    currency: "INR",
    status: "paid",
    issuedOn: auditIssued,
    dueOn: shiftDay(auditIssued, 15),
    paidOn: shiftDay(auditIssued, 6),
  });

  drafts.sort((a, b) => a.issuedOn.localeCompare(b.issuedOn) || a.organizationId.localeCompare(b.organizationId));
  await insertRows(
    db,
    invoices,
    drafts.map((d, index) => ({
      id: ctx.newId(),
      ...d,
      number: `TC-${d.issuedOn.slice(0, 4)}-${String(29 + index).padStart(4, "0")}`,
    })),
  );
}

/** A time during Indian working hours, n days from the anchor. */
export function workTime(ctx: SeedContext, daysFromAnchor: number, hour: number, minute = 0): Date {
  return istTime(shiftDay(ctx.anchorDay, daysFromAnchor), hour, minute);
}
