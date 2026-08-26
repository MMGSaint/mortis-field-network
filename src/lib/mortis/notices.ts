import type { MortisRuntime } from "./runtime.ts";
import type { DispatchResult } from "./types.ts";

export type OperationalNoticeKind =
  | "maintenance"
  | "outage"
  | "deployment"
  | "lockdown"
  | "application_update"
  | "intake";

const MAP: Record<OperationalNoticeKind, { channel_key: string; template_key: string }> = {
  maintenance: { channel_key: "network.status", template_key: "tpl.ops.maintenance" },
  outage: { channel_key: "network.status", template_key: "tpl.ops.outage" },
  deployment: { channel_key: "network.status", template_key: "tpl.ops.deployment" },
  lockdown: { channel_key: "arrival.notice", template_key: "tpl.ops.lockdown" },
  application_update: { channel_key: "network.dispatches", template_key: "tpl.ops.release_notice" },
  intake: { channel_key: "network.status", template_key: "tpl.ops.intake" },
};

/**
 * Operational notices only. NARRATIVE material is not accepted here.
 * Delivery is exclusively through dispatch.send.
 * application_update requires a signed release excerpt (tpl.ops.release_notice).
 */
export async function postOperationalNotice(
  rt: MortisRuntime,
  kind: OperationalNoticeKind,
  fields: Record<string, string>,
): Promise<DispatchResult> {
  const dest = MAP[kind];
  if (!dest) {
    return { ok: false, step: 6, reason: "unknown operational kind", audit_id: "" };
  }
  return rt.dispatch({
    channel_key: dest.channel_key,
    template_key: dest.template_key,
    fields,
    caller: { type: "owner-cli" },
  });
}
