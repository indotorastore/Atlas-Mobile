import { NextResponse } from "next/server";

const timeframes = ["1m", "5m", "15m", "1H", "4H", "1D"];

type AnalysisRequest = {
  symbol: string;
  name: string;
  timeframe: string;
  price: number;
  changePct: number;
  ema20: number;
  ema50: number;
  rsi14: number;
  macdHistogram: number;
  atr14: number;
  support: number;
  resistance: number;
  trend: string;
  bias: string;
};

function isValidAnalysisRequest(value: unknown): value is AnalysisRequest {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  const numericFields = [
    "price",
    "changePct",
    "ema20",
    "ema50",
    "rsi14",
    "macdHistogram",
    "atr14",
    "support",
    "resistance",
  ];

  return typeof body.symbol === "string"
    && /^[A-Z0-9]{1,20}$/.test(body.symbol)
    && typeof body.name === "string"
    && body.name.length <= 100
    && typeof body.timeframe === "string"
    && timeframes.includes(body.timeframe)
    && numericFields.every((field) => typeof body[field] === "number" && Number.isFinite(body[field]))
    && typeof body.trend === "string"
    && ["Bullish", "Bearish", "Neutral"].includes(body.trend)
    && typeof body.bias === "string"
    && ["Bullish", "Bearish", "Neutral"].includes(body.bias);
}

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL?.trim() || process.env.GRMINI_MODEL?.trim() || "gemini-2.5-flash";
  if (!apiKey) {
    return NextResponse.json({ error: "Gemini belum dikonfigurasi. Tambahkan GEMINI_API_KEY di environment server." }, { status: 503 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 8_000) {
    return NextResponse.json({ error: "Ukuran permintaan terlalu besar." }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body permintaan harus berupa JSON yang valid." }, { status: 400 });
  }

  if (!isValidAnalysisRequest(body)) {
    return NextResponse.json({ error: "Data analisis tidak valid." }, { status: 400 });
  }

  const prompt = [
    "Anda adalah analis pasar yang menjelaskan indikator teknikal secara hati-hati.",
    "Tulis dalam Bahasa Indonesia, ringkas (maksimal 4 poin), sebutkan risiko dan kondisi yang dapat membatalkan interpretasi.",
    "Data harga dan indikator berikut adalah data demo/simulasi, bukan data pasar live.",
    "Jangan menyarankan transaksi spesifik atau menjanjikan hasil. Ini bukan nasihat keuangan.",
    `Instrumen: ${body.symbol} (${body.name})`,
    `Timeframe: ${body.timeframe}`,
    `Harga demo: ${body.price}; perubahan: ${body.changePct}%`,
    `EMA 20: ${body.ema20}; EMA 50: ${body.ema50}`,
    `RSI 14: ${body.rsi14}; MACD histogram: ${body.macdHistogram}; ATR 14: ${body.atr14}`,
    `Support estimasi: ${body.support}; resistance estimasi: ${body.resistance}`,
    `Tren indikator: ${body.trend}; bias indikator: ${body.bias}`,
  ].join("\n");

  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 400, temperature: 0.4 },
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );
  } catch {
    return NextResponse.json({ error: "Tidak dapat menghubungi Gemini. Coba lagi sebentar." }, { status: 502 });
  }

  if (!response.ok) {
    return NextResponse.json({ error: `Gemini mengembalikan kesalahan (HTTP ${response.status}).` }, { status: 502 });
  }

  let result: unknown;
  try {
    result = await response.json();
  } catch {
    return NextResponse.json({ error: "Respons Gemini bukan JSON yang valid." }, { status: 502 });
  }
  if (!result || typeof result !== "object") {
    return NextResponse.json({ error: "Respons Gemini tidak valid." }, { status: 502 });
  }

  const candidates = (result as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates;
  const analysis = candidates?.[0]?.content?.parts
    ?.map((part) => part.text)
    .filter((text): text is string => typeof text === "string")
    .join("\n")
    .trim();

  if (!analysis) {
    return NextResponse.json({ error: "Gemini tidak menghasilkan analisis. Coba lagi." }, { status: 502 });
  }

  return NextResponse.json({ analysis });
}
