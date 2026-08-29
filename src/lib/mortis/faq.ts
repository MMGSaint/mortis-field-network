/**
 * Player-facing FAQ text served by /faq. Central single source so REFERENCE
 * (the blueprint template) and the slash command stay in step.
 *
 * Answers stay functional. No invented lore. No restricted terms. No
 * developer vocabulary. Where source material does not define an answer,
 * the copy stays neutral rather than inventing.
 */

export const FAQ_TOPICS = [
  "start",
  "communication",
  "conduct",
  "tickets",
  "accessibility",
  "world",
  "notifications",
  "help",
] as const;

export type FaqTopic = (typeof FAQ_TOPICS)[number];

export const FAQ_ENTRIES: Record<FaqTopic, { title: string; body: string }> = {
  start: {
    title: "How do I get started?",
    body:
      "HOW TO BEGIN in ARRIVAL. Read CONDUCT AND TERMS, press Accept, then " +
      "go to ENTRY and press Begin Intake. Give a callsign. That is intake. " +
      "There is no lore dump and no progress track.",
  },
  communication: {
    title: "How does communication work?",
    body:
      "OPEN CHANNEL is in-character traffic. QUESTIONS is out-of-character " +
      "and clear. NOTICES are posted, not debated. NETWORK STATUS carries " +
      "technical notices (maintenance, outage, restored).",
  },
  conduct: {
    title: "Basic conduct?",
    body:
      "Read CONDUCT AND TERMS. Consent for lasting harm to a character. " +
      "Do not publish private real-world information. Staff can remove " +
      "content. Appeals exist — open an appeal ticket.",
  },
  tickets: {
    title: "How do tickets work?",
    body:
      "SUPPORT DESK → Open ticket, or /ticket. Private channel. Categories: " +
      "general, report, appeal, accessibility. Report and appeal tickets go " +
      "only to OWNER and OPERATIONS. Two open tickets at a time per opener.",
  },
  accessibility: {
    title: "What is an accessibility ticket?",
    body:
      "A private request at SUPPORT DESK. Same privacy as any other ticket. " +
      "You do not owe anyone a story to ask for help.",
  },
  world: {
    title: "How do Discord, the world, and the terminal relate?",
    body:
      "What you witness is the world. What you can verify is your terminal. " +
      "What you hear here is traffic. Discord does not decide what is true.",
  },
  notifications: {
    title: "How do notifications work?",
    body:
      "Use /notifications to choose which categories you hear: notice, " +
      "dispatches, and your own ticket replies. Preferences are reversible " +
      "and only settable after intake completes.",
  },
  help: {
    title: "How do I get help?",
    body:
      "SUPPORT DESK for anything private. QUESTIONS for non-private asks. " +
      "If arrival is closed, wait for a further notice — that is a safety " +
      "action, not a hidden exam.",
  },
};

export function faqTopic(topic: string): { title: string; body: string } | null {
  if (!(FAQ_TOPICS as readonly string[]).includes(topic)) return null;
  return FAQ_ENTRIES[topic as FaqTopic];
}

export function faqAll(): string {
  const lines: string[] = ["FAQ — Field Network", ""];
  for (const key of FAQ_TOPICS) {
    const entry = FAQ_ENTRIES[key];
    lines.push(entry.title);
    lines.push(entry.body);
    lines.push("");
  }
  lines.push("This is not an archive of record. Ask staff if you need something not listed.");
  return lines.join("\n");
}
