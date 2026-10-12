import type { Metadata } from "next";
import { ActionButton } from "@/components/account/action-button";
import { TextLink } from "@/components/ui/button";
import { Meta, PageHeader, Section } from "@/components/ui/page";
import { RowHead, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireClient } from "@/lib/auth/dal";
import { PLANS, ROLES, type Role } from "@/lib/domain/constants";
import { formatDate, formatDateTime, formatRelative, plural } from "@/lib/domain/format";
import { getTeam } from "@/lib/queries/account";
import { removeMember, revokeInvite } from "./actions";
import { InviteForm } from "./invite-form";
import { RoleForm } from "./role-form";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const ctx = await requireClient();
  const { members, invites } = await getTeam(ctx.organization.id);
  const plan = PLANS[ctx.organization.plan];
  const owners = members.filter((member) => member.role === "owner").length;
  const seats = members.length + invites.length;
  const atLimit = typeof plan.teamMembers === "number" && seats >= plan.teamMembers;
  const seatLine =
    typeof plan.teamMembers === "number"
      ? `${seats} of ${plan.teamMembers} places on the ${plan.label} plan are in use, counting invitations.`
      : `${plural(seats, "person", "people")}, counting invitations.`;

  return (
    <>
      <PageHeader
        title="Team"
        description={`Who can see and change ${ctx.organization.name}'s TrueCite account. Owners invite people and set their roles.`}
      />

      <Section id="members" title="Members" rule={false} description={seatLine}>
        <Table className="relative" caption="Team members">
          <THead>
            <TR>
              <TH>Name</TH>
              <TH className="hidden md:table-cell">Email</TH>
              <TH>Role</TH>
              <TH>Last login</TH>
              {ctx.isOwner ? (
                <TH>
                  <span className="sr-only">Actions</span>
                </TH>
              ) : null}
            </TR>
          </THead>
          <TBody>
            {members.map((member) => {
              const isYou = member.userId === ctx.user.id;
              const onlyOwner = member.role === "owner" && owners <= 1;
              return (
                <TR key={member.membershipId}>
                  <RowHead className="min-w-44">
                    <span className="font-medium text-ink">{member.name}</span>
                    {isYou ? <Meta className="ml-2">You</Meta> : null}
                    {member.title ? <span className="mt-0.5 block text-sm text-graphite">{member.title}</span> : null}
                    <span className="mt-0.5 block text-sm break-all text-graphite md:hidden">{member.email}</span>
                  </RowHead>
                  <TD className="hidden text-graphite md:table-cell">{member.email}</TD>
                  <TD className="whitespace-nowrap">
                    {ctx.isOwner && !onlyOwner ? (
                      <RoleForm membershipId={member.membershipId} role={member.role} name={member.name} />
                    ) : (
                      <span>
                        {ROLES[member.role].label}
                        {onlyOwner && ctx.isOwner ? <Meta className="ml-2">Only owner</Meta> : null}
                      </span>
                    )}
                  </TD>
                  <TD className="whitespace-nowrap text-graphite">
                    {member.lastLoginAt ? (
                      <time dateTime={member.lastLoginAt.toISOString()} title={formatDateTime(member.lastLoginAt)}>
                        {formatRelative(member.lastLoginAt, ctx.now)}
                      </time>
                    ) : (
                      "Not yet"
                    )}
                  </TD>
                  {ctx.isOwner ? (
                    <TD className="text-right">
                      {!isYou && !onlyOwner ? (
                        <ActionButton
                          action={removeMember}
                          fields={{ membershipId: member.membershipId }}
                          label="Remove"
                          target={member.name}
                          className="justify-items-end"
                          confirm={{ question: `Remove ${member.name}?`, confirmLabel: "Remove" }}
                        />
                      ) : null}
                    </TD>
                  ) : null}
                </TR>
              );
            })}
          </TBody>
        </Table>
      </Section>

      {invites.length > 0 ? (
        <Section id="invites" title="Pending invitations" description="People who have not joined yet.">
          <Table className="relative" caption="Pending invitations">
            <THead>
              <TR>
                <TH>Email</TH>
                <TH>Role</TH>
                <TH>Invited by</TH>
                <TH>Sent</TH>
                {ctx.isOwner ? (
                  <TH>
                    <span className="sr-only">Actions</span>
                  </TH>
                ) : null}
              </TR>
            </THead>
            <TBody>
              {invites.map((invite) => (
                <TR key={invite.id}>
                  <RowHead className="min-w-48 text-ink">{invite.email}</RowHead>
                  <TD className="whitespace-nowrap">{ROLES[invite.role].label}</TD>
                  <TD className="whitespace-nowrap text-graphite">{invite.invitedBy ?? "–"}</TD>
                  <TD className="whitespace-nowrap text-graphite">{formatDate(invite.createdAt)}</TD>
                  {ctx.isOwner ? (
                    <TD className="text-right">
                      <ActionButton
                        action={revokeInvite}
                        fields={{ inviteId: invite.id }}
                        label="Revoke"
                        target={`invitation for ${invite.email}`}
                        className="justify-items-end"
                        confirm={{ question: "Revoke this invitation?", confirmLabel: "Revoke" }}
                      />
                    </TD>
                  ) : null}
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      ) : null}

      {ctx.isOwner ? (
        <Section id="invite" title="Invite someone" description="They get an email with a link to join. You can change their role later.">
          <div className="max-w-2xl">
            {atLimit ? (
              <p className="text-graphite">
                Every place on the {plan.label} plan is in use. Remove someone or revoke an invitation to invite someone
                new, or <TextLink href="/app/billing">ask to change plan</TextLink>.
              </p>
            ) : (
              <InviteForm />
            )}
          </div>
        </Section>
      ) : (
        <p className="mt-6 text-sm text-graphite">Only an owner can invite people or change roles.</p>
      )}

      <Section id="roles" title="Roles">
        <dl className="max-w-2xl border-t border-rule">
          {(Object.keys(ROLES) as Role[]).map((role) => (
            <div key={role} className="grid gap-1 border-b border-rule py-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-6">
              <dt className="font-medium text-ink">{ROLES[role].label}</dt>
              <dd className="text-graphite">{ROLES[role].description}.</dd>
            </div>
          ))}
        </dl>
      </Section>
    </>
  );
}

export const instant = false;
