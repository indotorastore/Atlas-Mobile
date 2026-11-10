import { NextResponse } from "next/server";

const indicators = [
  { id: "NY.GDP.MKTP.KD.ZG", label: "GDP growth", unit: "%", frequency: "Annual" },
  { id: "FP.CPI.TOTL.ZG", label: "Inflation", unit: "%", frequency: "Annual" },
  { id: "SL.UEM.TOTL.ZS", label: "Unemployment", unit: "%", frequency: "Annual" },
];

type WorldBankRecord = {
  date?: string;
  value?: number | null;
};

async function fetchIndicator(indicator: (typeof indicators)[number]) {
  const url = `https://api.worldbank.org/v2/country/USA/indicator/${indicator.id}?format=json&per_page=30`;
  const response = await fetch(url, {
    next: { revalidate: 3600 },
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) throw new Error(`World Bank returned HTTP ${response.status}`);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload) || !Array.isArray(payload[1])) {
    throw new Error("World Bank returned an invalid response");
  }

  const latest = (payload[1] as WorldBankRecord[]).find(
    (record) => typeof record.date === "string" && typeof record.value === "number" && Number.isFinite(record.value),
  );
  return {
    id: indicator.id,
    label: indicator.label,
    unit: indicator.unit,
    frequency: indicator.frequency,
    year: latest?.date ?? null,
    value: latest?.value ?? null,
  };
}

export async function GET() {
  try {
    const data = await Promise.all(indicators.map(fetchIndicator));
    if (data.every((item) => item.value === null)) {
      throw new Error("World Bank returned no observations");
    }
    return NextResponse.json({ country: "United States", source: "World Bank", data });
  } catch {
    return NextResponse.json({ error: "Data makro World Bank tidak tersedia saat ini." }, { status: 502 });
  }
}
