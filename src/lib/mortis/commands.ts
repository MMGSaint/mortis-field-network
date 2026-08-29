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
    if (c.name === "faq") {
      base.options = [
        {
          name: "topic",
          description: "Optional topic. Leave blank for the full list.",
          type: 3,
          required: false,
          choices: [
            { name: "start", value: "start" },
            { name: "communication", value: "communication" },
            { name: "conduct", value: "conduct" },
            { name: "tickets", value: "tickets" },
            { name: "accessibility", value: "accessibility" },
            { name: "world", value: "world" },
            { name: "notifications", value: "notifications" },
            { name: "help", value: "help" },
          ],
        },
      ];
    }
    if (c.name === "notifications") {
      base.options = [
        {
          name: "channel",
          description: "Which category",
          type: 3,
          required: true,
          choices: [
            { name: "notice", value: "notice" },
            { name: "dispatches", value: "dispatches" },
            { name: "tickets_own", value: "tickets_own" },
          ],
        },
        {
          name: "enabled",
          description: "on to hear, off to mute",
          type: 3,
          required: true,
          choices: [
            { name: "on", value: "on" },
            { name: "off", value: "off" },
          ],
        },
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
