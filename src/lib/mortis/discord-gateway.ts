/**
 * Gateway interaction listener. INTERACTION_CREATE needs no privileged intents.
 * Scratch sandbox is not a stable Discord HTTP endpoint, so we ACK over REST.
 *
 * S71 — heartbeat ACK tracking. Missing ACK before the next heartbeat is a
 * zombie: close with 4000 and reconnect. RESUME with session_id+seq if we
 * had one, otherwise fresh identify.
 *
 * S72 — OP7 (Reconnect) triggers a graceful close-and-RESUME. OP9 (invalid
 * session) triggers a fresh identify, honoring the resumable flag. Every
 * reconnect scheduling goes through one guarded scheduler that prevents
 * duplicate timers when close+op7+op9+error races overlap.
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
  /** S71 — last heartbeat ACK count for observability. */
  ackCount?: number;
  /** S71 — number of zombie detections since start. */
  zombieResets?: number;
  /** S72 — number of RESUME attempts since start. */
  resumeAttempts?: number;
  /** S72 — how many duplicate reconnect timers have been suppressed. */
  duplicateReconnectSuppressed?: number;
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
  return startGatewayInternal(opts);
}

/** Internal entry point — exported for test injection via {@link startTestableGateway}. */
export function startGatewayInternal(opts: {
  token: string;
  ctx: () => EnvoyContext;
  handle: (payload: Record<string, unknown>, ctx: EnvoyContext) => Promise<Response>;
  wsFactory?: () => WebSocket;
  /** Only used by tests — inject a fake timer. */
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (t: ReturnType<typeof setTimeout>) => void;
}): { stop: () => void; status: () => GatewayStatus } {
  let ws: WebSocket | null = null;
  let hb: ReturnType<typeof setInterval> | null = null;
  let seq: number | null = null;
  let sessionId: string | undefined;
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  // S71 — heartbeat ACK bookkeeping.
  let lastHeartbeatAt = 0;
  let lastAckAt = 0;
  let ackCount = 0;
  let zombieResets = 0;
  let resumeAttempts = 0;
  let duplicateReconnectSuppressed = 0;
  const setTimer = opts.setTimer ?? setTimeout;
  const clearTimer = opts.clearTimer ?? clearTimeout;

  const st: GatewayStatus = {
    connected: false,
    lastEvent: "starting",
    ackCount,
    zombieResets,
    resumeAttempts,
    duplicateReconnectSuppressed,
  };

  const syncStats = () => {
    st.ackCount = ackCount;
    st.zombieResets = zombieResets;
    st.resumeAttempts = resumeAttempts;
    st.duplicateReconnectSuppressed = duplicateReconnectSuppressed;
  };

  const stop = () => {
    stopped = true;
    if (hb) clearInterval(hb);
    hb = null;
    if (reconnectTimer) {
      clearTimer(reconnectTimer);
      reconnectTimer = null;
    }
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

  /**
   * S72 — one guarded reconnect scheduler. If a timer is already pending, the
   * caller's request is ignored and the suppression is counted. Races between
   * close, op9, op7, and error handlers no longer stack timers.
   */
  const scheduleReconnect = (delayMs: number) => {
    if (stopped) return;
    if (reconnectTimer) {
      duplicateReconnectSuppressed += 1;
      syncStats();
      return;
    }
    reconnectTimer = setTimer(() => {
      reconnectTimer = null;
      connect();
    }, delayMs);
  };

  /** Drop the socket in a way that always leaves ws null and hb cleared. */
  const teardownSocket = () => {
    if (hb) clearInterval(hb);
    hb = null;
    try {
      ws?.close(4000);
    } catch {
      /* */
    }
    ws = null;
    st.connected = false;
  };

  /** S71 — the heartbeat tick. If the last heartbeat had no ACK, treat as zombie. */
  const heartbeatTick = () => {
    if (lastHeartbeatAt > 0 && lastAckAt < lastHeartbeatAt) {
      // Zombie: last heartbeat unacknowledged. Reset and reconnect.
      zombieResets += 1;
      st.lastError = "heartbeat ack missing (zombie)";
      syncStats();
      teardownSocket();
      if (!stopped) {
        attempt += 1;
        scheduleReconnect(Math.min(1500 * attempt, 15000));
      }
      return;
    }
    lastHeartbeatAt = nowMs();
    send({ op: 1, d: seq });
  };

  /** Slim wrapper so tests can stub `Date.now()`. */
  const nowMs = (): number => {
    try {
      return Date.now();
    } catch {
      return 0;
    }
  };

  const onPacket = async (msg: Packet) => {
    if (typeof msg.s === "number") seq = msg.s;
    st.lastEvent = `op${msg.op}${msg.t ? `:${msg.t}` : ""}`;
    if (msg.op === 10) {
      const interval = Number(msg.d?.heartbeat_interval ?? 41250);
      if (hb) clearInterval(hb);
      // Reset ACK counters and send the first heartbeat immediately.
      lastAckAt = nowMs();
      lastHeartbeatAt = nowMs();
      send({ op: 1, d: seq });
      hb = setInterval(heartbeatTick, interval);
      // If we already have a session, RESUME instead of identifying fresh.
      if (sessionId && seq !== null) {
        resumeAttempts += 1;
        syncStats();
        send({
          op: 6,
          d: { token: opts.token, session_id: sessionId, seq },
        });
      } else {
        send({
          op: 2,
          d: {
            token: opts.token,
            intents: 0,
            compress: false,
            properties: { os: "linux", browser: "mortis-envoy", device: "mortis-envoy" },
          },
        });
      }
      st.lastError = undefined;
      return;
    }
    if (msg.op === 11) {
      // Heartbeat ACK.
      lastAckAt = nowMs();
      ackCount += 1;
      syncStats();
      return;
    }
    if (msg.op === 1) {
      // Server-side heartbeat request.
      send({ op: 1, d: seq });
      return;
    }
    if (msg.op === 7) {
      // Reconnect: close and RESUME.
      st.lastError = "reconnect requested (op 7)";
      teardownSocket();
      if (!stopped) {
        // Do not reset seq/sessionId — they are needed for RESUME.
        attempt += 1;
        scheduleReconnect(Math.min(1500 * attempt, 5000));
      }
      return;
    }
    if (msg.op === 9) {
      // Invalid session. `d` is a boolean — true means resumable.
      const resumable = Boolean(msg.d);
      st.lastError = "identify rejected (op 9)";
      st.connected = false;
      if (!resumable) {
        sessionId = undefined;
        seq = null;
      }
      teardownSocket();
      if (!stopped) {
        attempt += 1;
        scheduleReconnect(Math.min(3000 * attempt, 15000));
      }
      return;
    }
    if (msg.op === 0 && msg.t === "READY") {
      st.connected = true;
      st.lastError = undefined;
      sessionId = String(msg.d?.session_id ?? "");
      st.sessionId = sessionId;
      attempt = 0;
      return;
    }
    if (msg.op === 0 && msg.t === "RESUMED") {
      st.connected = true;
      st.lastError = undefined;
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
    const impl = opts.wsFactory
      ? opts.wsFactory
      : () => {
          const Impl = globalThis.WebSocket;
          if (!Impl) throw new Error("WebSocket constructor missing");
          return new Impl(GATEWAY);
        };
    try {
      ws = impl();
    } catch (e) {
      st.lastError = e instanceof Error ? e.message : String(e);
      scheduleReconnect(4000);
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
      const code = (ev as CloseEvent).code;
      st.lastError = `close ${code} ${(ev as CloseEvent).reason}`.trim();
      if (hb) clearInterval(hb);
      hb = null;
      // Discord codes 4004/4010/4011/4012/4013/4014 are unrecoverable.
      const fatal = code === 4004 || code === 4010 || code === 4011 || code === 4012 || code === 4013 || code === 4014;
      if (fatal) {
        stopped = true;
        return;
      }
      if (!stopped) {
        attempt += 1;
        scheduleReconnect(Math.min(3000 * attempt, 15000));
      }
    });
    ws.addEventListener("error", () => {
      st.lastError = st.lastError ?? "gateway socket error";
    });
  };

  setImmediate(connect);
  return {
    stop,
    status: () => {
      syncStats();
      return { ...st };
    },
  };
}

/**
 * Testable entry point. Never talks to the real network — the caller must
 * supply a fake WebSocket implementation. Exercises the same code path as
 * {@link startInteractionGateway}.
 */
export function startTestableGateway(opts: {
  token: string;
  ctx: () => EnvoyContext;
  handle: (payload: Record<string, unknown>, ctx: EnvoyContext) => Promise<Response>;
  wsFactory: () => WebSocket;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (t: ReturnType<typeof setTimeout>) => void;
}) {
  return startGatewayInternal(opts);
}

/**
 * Test-friendly packet handler that returns the produced status without
 * network side effects. Deprecated in favour of {@link startTestableGateway}.
 */
export type { Packet as GatewayPacket };
