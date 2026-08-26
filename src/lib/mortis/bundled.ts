import guild from "../../../blueprint/guild.json" with { type: "json" };
import templates from "../../../blueprint/templates.json" with { type: "json" };
import restricted from "../../../blueprint/terms/restricted.json" with { type: "json" };
import developer from "../../../blueprint/terms/developer.json" with { type: "json" };
import type { Blueprint, TemplateBlueprint } from "./types.ts";
import type { TermList } from "./terms.ts";

export const BUNDLED_GUILD = guild as Omit<Blueprint, "templates">;
export const BUNDLED_TEMPLATES = templates as { templates: TemplateBlueprint[] };
export const BUNDLED_RESTRICTED = restricted as TermList;
export const BUNDLED_DEVELOPER = developer as TermList;
export const BUNDLED_BLUEPRINT: Blueprint = {
  ...BUNDLED_GUILD,
  templates: BUNDLED_TEMPLATES.templates,
};
