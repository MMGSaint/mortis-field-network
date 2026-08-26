/**
 * Gateway interaction listener. INTERACTION_CREATE needs no privileged intents.
 * Scratch sandbox is not a stable Discord HTTP endpoint, so we ACK over REST.
 */
import type { EnvoyContext } from "./envoy.ts";

const GATEWAY = "wss://gateway.discord.gg/?v=10&encoding=json";
const API = "https://discord.com/api/v10";
const UA = "MortisFieldNetwork-Envoy/phase1 (scratch-validation)";

export type GatewayStatus = {
  connected: boolean;
  sessionId?: string;
  lastEvent?: string;
  lastError?: string;
};

type Packet = { op: number; t?: string | null; s?: number | null; d?: Record<string, unknown> | null };

/** Modal openers must ACK type 9 only. Never type 5 first. */
export function interactionOpensModal(itype: number, customId: string): boolean {
  return itype === 3 && (customId === "ticket_create" || customId === "intake_start");
}

export function startInteractionGateway(opts: {
  token: string;
  ctx: () => EnvoyContext;
  handle: (payload: Record<string, unknown>, ctx: EnvoyContext) => Promise<Response>;
}): { stop: () => void; status: () => GatewayStatus } {
  let ws: WebSocket | null = null;
  let hb: ReturnType<typeof setInterval> | null = null;
  let seq: number | null = null;
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  const st: GatewayStatus = { connected: false, lastEvent: "starting" };

  const stop = () => {
    stopped = true;
    if (hb) clearInterval(hb);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    try {
      ws?.close(1000);
    } catch {
      /* */
    }
    ws = null;
    st.connected = false;
  };

  const send = (payload: unknown) => {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify(payload));
  };

  const ack = async (id: string, token: string, body: unknown) => {
    const res = await fetch(`${API}/interactions/${id}/${token}/callback`, {
      method: "POST",
      headers: {
        authorization: `Bot ${opts.token}`,
        "content-type": "application/json",
        "user-agent": UA,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      st.lastError = `callback ${res.status} ${text.slice(0, 180)}`;
    }
  };

  const followup = async (appId: string, token: string, content: string) => {
    if (!appId || !token) return;
    const res = await fetch(`${API}/webhooks/${appId}/${token}`, {
      method: "POST",
      headers: {
        authorization: `Bot ${opts.token}`,
        "content-type": "application/json",
        "user-agent": UA,
      },
      body: JSON.stringify({ content: content.slice(0, 1900), flags: 64 }),
    });
    if (!res.ok) {
      const text = await res.text();
      st.lastError = `followup ${res.status} ${text.slice(0, 180)}`;
    }
  };

  const onPacket = async (msg: Packet) => {
    if (typeof msg.s === "number") seq = msg.s;
    st.lastEvent = `op${msg.op}${msg.t ? `:${msg.t}` : ""}`;
    if (msg.op === 10) {
      const interval = Number(msg.d?.heartbeat_interval ?? 41250);
      if (hb) clearInterval(hb);
      send({ op: 1, d: seq });
      hb = setInterval(() => send({ op: 1, d: seq }), interval);
      send({
        op: 2,
        d: {
          token: opts.token,
          intents: 0,
          compress: false,
          properties: { os: "linux", browser: "mortis-envoy", device: "mortis-envoy" },
        },
      });
      st.lastError = undefined;
      return;
    }
    if (msg.op === 9) {
      st.lastError = "identify rejected (op 9)";
      st.connected = false;
      st.sessionId = undefined;
      seq = null;
      try {
        ws?.close(1000);
      } catch {
        /* */
      }
      ws = null;
      if (!stopped) {
        attempt += 1;
        reconnectTimer = setTimeout(connect, Math.min(3000 * attempt, 15000));
      }
      return;
    }
    if (msg.op === 0 && msg.t === "READY") {
      st.connected = true;
      st.lastError = undefined;
      st.sessionId = String(msg.d?.session_id ?? "");
      attempt = 0;
      return;
    }
    if (msg.op === 0 && msg.t === "INTERACTION_CREATE") {
      const d = (msg.d ?? {}) as Record<string, unknown>;
      const id = String(d.id ?? "");
      const token = String(d.token ?? "");
      const appId = String(d.application_id ?? "");
      const itype = Number(d.type ?? 0);
      const data = (d.data ?? {}) as { custom_id?: string };
      const cid = String(data.custom_id ?? "");
      const opensModal = interactionOpensModal(itype, cid);
      let deferred = false;
      if (!opensModal && (itype === 2 || itype === 3 || itype === 5) && id && token) {
        try {
          await ack(id, token, { type: 5, data: { flags: 64 } });
          deferred = true;
        } catch (e) {
          st.lastError = e instanceof Error ? e.message : String(e);
        }
      }
      try {
        const res = await opts.handle(d, opts.ctx());
        const body = (await res.json().catch(() => ({}))) as { type?: number; data?: { content?: string; flags?: number } };
        if (opensModal) {
          if (id && token) await ack(id, token, body);
          return;
        }
        const content = body.data?.content ?? "Acknowledged.";
        if (deferred) await followup(appId, token, content);
        else if (id && token) await ack(id, token, body);
      } catch (e) {
        const err = e as Error & { body?: string };
        const content = `${err.message}${err.body && !err.message.includes(err.body) ? ` ${err.body}` : ""}`.slice(0, 180);
        st.lastError = content;
        if (deferred) await followup(appId, token, content).catch(() => undefined);
        else if (id && token) {
          await ack(id, token, { type: 4, data: { content, flags: 64 } }).catch(() => undefined);
        }
      }
    }
  };

  const connect = () => {
    if (stopped) return;
    const Impl = globalThis.WebSocket;
    if (!Impl) {
      st.lastError = "WebSocket constructor missing";
      reconnectTimer = setTimeout(connect, 4000);
      return;
    }
    try {
      ws = new Impl(GATEWAY);
    } catch (e) {
      st.lastError = e instanceof Error ? e.message : String(e);
      reconnectTimer = setTimeout(connect, 4000);
      return;
    }
    st.lastEvent = "opening";
    ws.addEventListener("open", () => {
      st.lastEvent = "open";
    });
    ws.addEventListener("message", (ev) => {
      try {
        const data = (ev as MessageEvent).data;
        const raw = typeof data === "string" ? data : String(data);
        void onPacket(JSON.parse(raw) as Packet);
      } catch (e) {
        st.lastError = e instanceof Error ? e.message : String(e);
      }
    });
    ws.addEventListener("close", (ev) => {
      st.connected = false;
      st.lastError = `close ${(ev as CloseEvent).code} ${(ev as CloseEvent).reason}`.trim();
      if (hb) clearInterval(hb);
      hb = null;
      if (!stopped) {
        attempt += 1;
        reconnectTimer = setTimeout(connect, Math.min(3000 * attempt, 15000));
      }
    });
    ws.addEventListener("error", () => {
      st.lastError = st.lastError ?? "gateway socket error";
    });
  };

  setImmediate(connect);
  return { stop, status: () => ({ ...st }) };
}
