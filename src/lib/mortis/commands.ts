import type { SimulatedGuild } from "./discord-sim.ts";
import type { Blueprint } from "./types.ts";

export type SlashCommandPayload = {
  name: string;
  description: string;
  type: 1;
  options?: Array<{
    name: string;
    description: string;
    type: number;
    required?: boolean;
    choices?: Array<{ name: string; value: string }>;
  }>;
};

/** Guild-scoped slash commands. Authorization is envoy's, not Discord's. */
export function commandPayloads(bp: Blueprint): SlashCommandPayload[] {
  return bp.commands.map((c) => {
    const base: SlashCommandPayload = {
      name: c.name,
      description: c.description.slice(0, 100),
      type: 1,
    };
    if (c.name === "ticket") {
      // Discord requires required options before optional ones.
      base.options = [
        {
          name: "category",
          description: "Ticket category",
          type: 3,
          required: true,
          choices: [
            { name: "general", value: "general" },
            { name: "report", value: "report" },
            { name: "appeal", value: "appeal" },
            { name: "accessibility", value: "accessibility" },
          ],
        },
        { name: "body", description: "What you need", type: 3, required: true },
      ];
    }
    if (c.name === "post") {
      base.options = [
        { name: "channel", description: "Blueprint channel key", type: 3, required: false },
        { name: "template", description: "Blueprint template key", type: 3, required: false },
        { name: "status", description: "Status field", type: 3, required: false },
      ];
    }
    return base;
  });
}

export async function registerGuildCommands(
  bp: Blueprint,
  guild: SimulatedGuild,
  appId: string,
): Promise<{ ok: boolean; count: number; warning?: string }> {
  if (!appId) return { ok: false, count: 0, warning: "application id missing — slash commands not registered" };
  const payload = commandPayloads(bp);
  try {
    await guild.putGuildCommands(appId, payload);
    return { ok: true, count: payload.length };
  } catch (err) {
    const e = err as Error & { status?: number; body?: string };
    return {
      ok: false,
      count: 0,
      warning: `commands ${e.status ?? ""} ${e.message}${e.body ? ` ${e.body}` : ""}`.trim().slice(0, 240),
    };
  }
}
