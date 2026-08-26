import { dispatchSend, mirrorAudit } from "./dispatch.ts";
import type { SimulatedGuild } from "./discord-sim.ts";
import type { EnvoyStore } from "./store.ts";
import type { Blueprint, DispatchCaller, MemberRow } from "./types.ts";

export type IntakeInput = {
  snowflake: string;
  handle: string;
  callsign?: string;
  accountAgeDays?: number;
  minAccountAgeDays?: number;
};

/** Idempotent: double-click / repeat complete is a no-op with the same member row. */
export async function acceptTerms(
  store: EnvoyStore,
  snowflake: string,
  handle: string,
  guild?: SimulatedGuild,
): Promise<MemberRow> {
  const existing = store.members.get(snowflake);
  if (existing) {
    if (existing.intake_state === "none") existing.intake_state = "terms_accepted";
    existing.updated_at = new Date().toISOString();
    return existing;
  }
  const row: MemberRow = {
    snowflake,
    handle,
    callsign: null,
    intake_state: "terms_accepted",
    grants: [],
    flags: [],
    staff_notes: "",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  store.members.set(snowflake, row);
  const aud = store.appendAudit({ actor: snowflake, action: "intake.terms_accepted", target: snowflake, details: {} });
  if (guild) await mirrorAudit(store, guild, aud.id);
  return row;
}

export async function completeIntake(
  input: IntakeInput,
  ctx: { bp: Blueprint; store: EnvoyStore; guild: SimulatedGuild },
): Promise<{ member: MemberRow; already: boolean }> {
  if (ctx.store.lockdown) {
    throw new Error("lockdown");
  }
  if (input.minAccountAgeDays && (input.accountAgeDays ?? 0) < input.minAccountAgeDays) {
    throw new Error("account_age");
  }
  let member = ctx.store.members.get(input.snowflake);
  if (!member || member.intake_state === "none") {
    member = await acceptTerms(ctx.store, input.snowflake, input.handle, ctx.guild);
  }
  if (member.intake_state === "complete") {
    const initiateRole = ctx.store.blueprintState.get("role.initiate");
    if (initiateRole) {
      if (!ctx.guild.members.has(input.snowflake)) {
        ctx.guild.seedMember(input.snowflake, input.handle, []);
      }
      try {
        await ctx.guild.addRole(input.snowflake, initiateRole);
      } catch {
        /* retry grant on already-complete; Discord 403 is non-fatal here */
      }
    }
    return { member, already: true };
  }

  member.callsign = input.callsign ?? member.callsign;
  member.handle = input.handle;

  const initiateRole = ctx.store.blueprintState.get("role.initiate");
  if (initiateRole) {
    if (!ctx.guild.members.has(input.snowflake)) {
      ctx.guild.seedMember(input.snowflake, input.handle, []);
    }
    await ctx.guild.addRole(input.snowflake, initiateRole);
  }

  member.intake_state = "complete";
  member.updated_at = new Date().toISOString();
  ctx.store.members.set(input.snowflake, member);

  const aud = ctx.store.appendAudit({
    actor: input.snowflake,
    action: "intake.complete",
    target: input.snowflake,
    details: { callsign: member.callsign },
  });
  await mirrorAudit(ctx.store, ctx.guild, aud.id);

  const caller: DispatchCaller = { type: "owner-cli" };
  await dispatchSend(
    {
      channel_key: "staff.inbox",
      template_key: "tpl.staff.intake_receipt",
      fields: {
        snowflake: input.snowflake,
        handle: input.handle,
        callsign: member.callsign ?? "—",
      },
      caller,
    },
    ctx,
  );

  return { member, already: false };
}
