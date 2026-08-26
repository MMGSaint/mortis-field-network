import { createTicket } from "./tickets.ts";
import type { MortisRuntime } from "./runtime.ts";

export type WalkthroughStep = { id: string; pass: boolean; detail: string };

/** Simulated first-time player: knows nothing, should not see lore dumps or staff. */
export async function runFirstPlayerWalkthrough(rt: MortisRuntime): Promise<{
  pass: boolean;
  steps: WalkthroughStep[];
}> {
  const steps: WalkthroughStep[] = [];
  const push = (id: string, pass: boolean, detail: string) => steps.push({ id, pass, detail });

  await rt.apply();
  const guest = rt.guild.seedMember("walk_guest", "newcomer", []);
  const arrival = rt.store.blueprintState.get("arrival.notice")!;
  const guide = rt.store.blueprintState.get("arrival.guide");
  const network = rt.store.blueprintState.get("network.traffic")!;
  const staffOps = rt.store.blueprintState.get("staff.ops")!;
  const reference = rt.store.blueprintState.get("network.reference");
  const world = rt.store.blueprintState.get("community.vrchat");

  push("entry", rt.guild.canView(guest.id, arrival) && !rt.guild.canView(guest.id, network) && !rt.guild.canView(guest.id, staffOps), "guest sees ARRIVAL only");
  push("guide", Boolean(guide) && rt.guild.canView(guest.id, guide!), "HOW TO BEGIN visible before intake");
  push("world_hidden", Boolean(world) && !rt.guild.canView(guest.id, world!), "WORLD ACCESS hidden before intake");

  const { already } = await rt.intake({ snowflake: guest.id, handle: "newcomer", callsign: "Walker" });
  const initiate = rt.store.blueprintState.get("role.initiate")!;
  const member = rt.guild.members.get(guest.id);
  if (member && !member.roles.includes(initiate)) member.roles.push(initiate);

  push("intake", already === false && rt.store.members.get(guest.id)?.intake_state === "complete", "intake completes once");
  push("after", rt.guild.canView(guest.id, network) && !rt.guild.canView(guest.id, staffOps), "initiate sees NETWORK, not STAFF");
  push("reference", Boolean(reference) && rt.guild.canView(guest.id, reference!), "REFERENCE visible after intake");
  push("world", Boolean(world) && rt.guild.canView(guest.id, world!), "WORLD ACCESS visible after intake");

  const t = await createTicket({ opener: guest.id, handle: "newcomer", category: "general", body: "I do not know where to start." }, rt);
  const playerFacing = ["network.dispatches", "network.status", "arrival.notice"];
  const leaked = playerFacing.some((key) => {
    const id = rt.store.blueprintState.get(key);
    const ch = id ? rt.guild.channelById(id) : undefined;
    return (ch?.messages ?? []).some((m) => m.content.includes("I do not know where to start"));
  });
  push("ticket", t.status === "open" && !leaked, leaked ? "ticket body leaked to player channel" : `ticket ${t.id} private`);

  const blocked = await rt.dispatch({
    channel_key: "network.dispatches",
    template_key: "tpl.ops.deployment",
    fields: { status: "ok" },
    caller: { type: "staff", snowflake: guest.id },
  });
  push("no_post", blocked.ok === false && blocked.step === 1, "player cannot /post");

  const faq = rt.bp.templates.find((x) => x.key === "tpl.network.reference")!;
  const dirty = /Season 3|Ashwright|True Name|sprint|canon/i.test(`${faq.title}\n${faq.body}`);
  push("faq_clean", !dirty, dirty ? "FAQ contains restricted or dev vocabulary" : "FAQ player-safe");

  const orientBody = JSON.stringify({ type: 2, data: { name: "orient" }, user: { id: guest.id, username: "newcomer" } });
  const ts = String(Math.floor(Date.now() / 1000));
  const signed = await rt.signDiscordBody(orientBody, ts);
  const orient = await rt.fetch(
    new Request("https://envoy.local/interactions", {
      method: "POST",
      headers: { "x-signature-ed25519": signed.signature, "x-signature-timestamp": ts },
      body: orientBody,
    }),
  );
  const orientJson = (await orient.json()) as { data?: { content?: string; flags?: number } };
  const orientText = orientJson.data?.content ?? "";
  push(
    "orient",
    orient.status === 200 && orientText.includes("HOW TO BEGIN") && !/Season 3|Ashwright|sprint/i.test(orientText),
    "slash /orient is player-safe",
  );

  return { pass: steps.every((s) => s.pass), steps };
}
