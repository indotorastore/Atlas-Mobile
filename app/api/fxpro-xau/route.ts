import { connect, type TLSSocket } from "node:tls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FeedEvent = { type: "status" | "quote" | "feed-error"; data: unknown };
type FixSettings = {
  host: string;
  port: number;
  username: string;
  password: string;
  senderCompId: string;
  symbolId: string;
};
type FxProFeed = {
  subscribers: Set<(event: FeedEvent) => void>;
  socket: TLSSocket | null;
  buffer: Buffer;
  settings: FixSettings;
  sequence: number;
  requestId: string;
  retryCount: number;
  reconnectTimer: NodeJS.Timeout | null;
  heartbeatTimer: NodeJS.Timeout | null;
  state: "connecting" | "live" | "reconnecting";
  bid: number | null;
  ask: number | null;
};

const feedGlobal = globalThis as typeof globalThis & { atlasFxProXauFeed?: FxProFeed };

const soh = "\x01";
const feedError = (message: string) => ({ type: "feed-error", data: { message } }) satisfies FeedEvent;

function getSettings(): FixSettings | string {
  const required = [
    "FXPRO_FIX_HOST",
    "FXPRO_FIX_PORT",
    "FXPRO_FIX_USERNAME",
    "FXPRO_FIX_PASSWORD",
    "FXPRO_FIX_SENDER_COMP_ID",
    "FXPRO_FIX_XAUUSD_SYMBOL_ID",
  ] as const;
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) return `FxPro FIX belum dikonfigurasi: ${missing.join(", ")}.`;

  const host = process.env.FXPRO_FIX_HOST!;
  const port = Number(process.env.FXPRO_FIX_PORT);
  const username = process.env.FXPRO_FIX_USERNAME!;
  const password = process.env.FXPRO_FIX_PASSWORD!;
  const senderCompId = process.env.FXPRO_FIX_SENDER_COMP_ID!;
  const symbolId = process.env.FXPRO_FIX_XAUUSD_SYMBOL_ID!;
  if (!/^[\w.-]+$/.test(host)
    || !Number.isInteger(port)
    || port < 1
    || port > 65_535
    || !/^\d+$/.test(username)
    || !/^[\x20-\x7E]+$/.test(password)
    || !/^[\x20-\x7E]+$/.test(senderCompId)
    || !/^\d+$/.test(symbolId)) {
    return "Konfigurasi FxPro FIX tidak valid. Periksa host, port, login, SenderCompID, dan ID simbol.";
  }
  return { host, port, username, password, senderCompId, symbolId };
}

function buildMessage(feed: FxProFeed, type: string, fields: [string, string][] = []) {
  const isoTimestamp = new Date().toISOString();
  const timestamp = `${isoTimestamp.slice(0, 10).replace(/-/g, "")}-${isoTimestamp.slice(11, 19)}.${isoTimestamp.slice(20, 23)}`;
  const header = [
    `35=${type}`,
    `49=${feed.settings.senderCompId}`,
    "56=CSERVER",
    `34=${feed.sequence++}`,
    `52=${timestamp}`,
    "50=QUOTE",
    "57=QUOTE",
  ];
  const body = [...header, ...fields.map(([tag, value]) => `${tag}=${value}`)].join(soh) + soh;
  const prefix = `8=FIX.4.4${soh}9=${Buffer.byteLength(body, "ascii")}${soh}${body}`;
  const checksum = [...Buffer.from(prefix, "ascii")].reduce((sum, byte) => sum + byte, 0) % 256;
  return `${prefix}10=${checksum.toString().padStart(3, "0")}${soh}`;
}

function sendMessage(feed: FxProFeed, type: string, fields: [string, string][] = []) {
  if (!feed.socket || feed.socket.destroyed) return;
  feed.socket.write(buildMessage(feed, type, fields));
}

function publish(feed: FxProFeed, event: FeedEvent) {
  for (const subscriber of feed.subscribers) subscriber(event);
}

function parseFrame(frame: string) {
  if (!frame.startsWith(`8=FIX.4.4${soh}`)) throw new Error("Invalid FIX message header");
  const firstSeparator = frame.indexOf(soh);
  const secondSeparator = frame.indexOf(soh, firstSeparator + 1);
  const bodyLength = Number(frame.slice(firstSeparator + 1, secondSeparator).replace("9=", ""));
  const checksumIndex = frame.lastIndexOf("10=");
  if (!Number.isInteger(bodyLength) || checksumIndex < 0
    || Buffer.byteLength(frame.slice(secondSeparator + 1, checksumIndex), "ascii") !== bodyLength) {
    throw new Error("Invalid FIX message length");
  }
  const expectedChecksum = Number(frame.slice(checksumIndex + 3, checksumIndex + 6));
  const actualChecksum = [...Buffer.from(frame.slice(0, checksumIndex), "ascii")]
    .reduce((sum, byte) => sum + byte, 0) % 256;
  if (!Number.isInteger(expectedChecksum) || actualChecksum !== expectedChecksum) {
    throw new Error("Invalid FIX message checksum");
  }
  return frame.slice(secondSeparator + 1, checksumIndex)
    .split(soh)
    .filter(Boolean)
    .map((field) => {
      const separator = field.indexOf("=");
      return [field.slice(0, separator), field.slice(separator + 1)] as const;
    });
}

function handleMessage(feed: FxProFeed, fields: readonly (readonly [string, string])[]) {
  const first = (tag: string) => fields.find(([fieldTag]) => fieldTag === tag)?.[1];
  const type = first("35");

  if (type === "A") {
    feed.retryCount = 0;
    feed.state = "live";
    publish(feed, { type: "status", data: { state: "live" } });
    sendMessage(feed, "V", [
      ["262", feed.requestId],
      ["263", "1"],
      ["264", "1"],
      ["265", "1"],
      ["146", "1"],
      ["55", feed.settings.symbolId],
      ["267", "2"],
      ["269", "0"],
      ["269", "1"],
    ]);
    return;
  }

  if (type === "0") return;
  if (type === "1") {
    const requestId = first("112");
    sendMessage(feed, "0", requestId ? [["112", requestId]] : []);
    return;
  }
  if (type === "5" || type === "3" || type === "j") {
    publish(feed, feedError("FxPro FIX menolak atau menutup sesi harga. Periksa konfigurasi dan akses market data."));
    feed.socket?.destroy();
    return;
  }
  if (type !== "W" && type !== "X") return;

  const messageSymbol = first("55");
  if (messageSymbol && messageSymbol !== feed.settings.symbolId) return;
  if (type === "W") {
    feed.bid = null;
    feed.ask = null;
  }

  let entryType: string | null = null;
  let deletedEntry = false;
  for (const [tag, value] of fields) {
    if (tag === "279") deletedEntry = value === "2";
    if (tag === "269") {
      entryType = value;
      if (deletedEntry) {
        if (value === "0") feed.bid = null;
        if (value === "1") feed.ask = null;
      }
      deletedEntry = false;
    }
    if (tag === "270" && !deletedEntry) {
      const price = Number(value);
      if (!Number.isFinite(price) || price <= 0) continue;
      if (entryType === "0") feed.bid = price;
      if (entryType === "1") feed.ask = price;
    }
  }

  if (feed.bid === null || feed.ask === null || feed.bid <= 0 || feed.ask <= 0) return;
  publish(feed, {
    type: "quote",
    data: { bid: feed.bid, ask: feed.ask, price: (feed.bid + feed.ask) / 2, timestamp: Date.now() },
  });
}

function stopFeed(feed: FxProFeed) {
  if (feed.reconnectTimer) clearTimeout(feed.reconnectTimer);
  if (feed.heartbeatTimer) clearInterval(feed.heartbeatTimer);
  feed.reconnectTimer = null;
  feed.heartbeatTimer = null;
  feed.socket?.destroy();
  feed.socket = null;
  feed.buffer = Buffer.alloc(0);
  feed.bid = null;
  feed.ask = null;
}

function connectFeed(feed: FxProFeed) {
  if (feed.subscribers.size === 0) return;
  feed.state = feed.retryCount === 0 ? "connecting" : "reconnecting";
  publish(feed, { type: "status", data: { state: feed.state } });
  feed.sequence = 1;
  feed.buffer = Buffer.alloc(0);
  feed.bid = null;
  feed.ask = null;

  const socket = connect({
    host: feed.settings.host,
    port: feed.settings.port,
    servername: feed.settings.host,
    rejectUnauthorized: true,
  });
  feed.socket = socket;
  socket.setTimeout(90_000);
  socket.once("secureConnect", () => {
    if (feed.socket !== socket) return;
    sendMessage(feed, "A", [
      ["98", "0"],
      ["108", "30"],
      ["141", "Y"],
      ["553", feed.settings.username],
      ["554", feed.settings.password],
    ]);
  });

  const reconnect = () => {
    if (feed.socket !== socket) return;
    feed.socket = null;
    if (feed.heartbeatTimer) clearInterval(feed.heartbeatTimer);
    feed.heartbeatTimer = null;
    socket.destroy();
    if (feed.subscribers.size === 0 || feed.reconnectTimer) return;
    feed.retryCount += 1;
    feed.state = "reconnecting";
    publish(feed, { type: "status", data: { state: "reconnecting" } });
    const delay = Math.min(1_000 * 2 ** Math.min(feed.retryCount - 1, 5), 30_000);
    feed.reconnectTimer = setTimeout(() => {
      feed.reconnectTimer = null;
      connectFeed(feed);
    }, delay);
  };

  socket.on("data", (chunk: Buffer) => {
    if (feed.socket !== socket) return;
    feed.buffer = Buffer.concat([feed.buffer, chunk]);
    while (true) {
      const terminator = feed.buffer.indexOf(`${soh}10=`);
      if (terminator < 0) break;
      const end = feed.buffer.indexOf(soh, terminator + 5);
      if (end < 0) break;
      const frame = feed.buffer.subarray(0, end + 1).toString("ascii");
      feed.buffer = feed.buffer.subarray(end + 1);
      try {
        handleMessage(feed, parseFrame(frame));
      } catch {
        publish(feed, feedError("Pesan harga FxPro FIX tidak valid."));
        socket.destroy();
        return;
      }
    }
  });
  socket.once("timeout", reconnect);
  socket.once("error", reconnect);
  socket.once("close", reconnect);
  socket.once("secureConnect", () => {
    if (feed.heartbeatTimer) clearInterval(feed.heartbeatTimer);
    feed.heartbeatTimer = setInterval(() => sendMessage(feed, "0"), 30_000);
  });
}

function getFeed(settings: FixSettings) {
  let feed = feedGlobal.atlasFxProXauFeed;
  if (!feed) {
    feed = {
      subscribers: new Set(),
      socket: null,
      buffer: Buffer.alloc(0),
      settings,
      sequence: 1,
      requestId: `atlas-xau-${Date.now()}`,
      retryCount: 0,
      reconnectTimer: null,
      heartbeatTimer: null,
      state: "connecting",
      bid: null,
      ask: null,
    };
    feedGlobal.atlasFxProXauFeed = feed;
  }
  return feed;
}

export async function GET() {
  const settings = getSettings();
  const encoder = new TextEncoder();
  if (typeof settings === "string") {
    return new Response(`event: feed-error\ndata: ${JSON.stringify({ message: settings })}\n\n`, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" },
    });
  }

  const feed = getFeed(settings);
  let keepalive: NodeJS.Timeout | null = null;
  let listener: ((event: FeedEvent) => void) | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      listener = (event) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`));
        } catch {
          if (listener) feed.subscribers.delete(listener);
        }
      };
      feed.subscribers.add(listener);
      listener({ type: "status", data: { state: feed.state } });
      keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          if (keepalive) clearInterval(keepalive);
          if (listener) feed.subscribers.delete(listener);
        }
      }, 20_000);
      if (!feed.socket && !feed.reconnectTimer) connectFeed(feed);
    },
    cancel() {
      if (listener) feed.subscribers.delete(listener);
      if (keepalive) clearInterval(keepalive);
      if (feed.subscribers.size === 0) {
        stopFeed(feed);
        feedGlobal.atlasFxProXauFeed = undefined;
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
