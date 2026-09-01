import { query } from "../db/client";

export interface FxRateInput {
  pair?: string;
  rate: number;
  quotedAt: string;
  sourceStatus: "OPERATIONAL" | "DEGRADED" | "FALLBACK_STALE" | "OFFLINE";
}

export interface FxRateRow {
  pair: string;
  rate: string;
  quoted_at: string;
  source_status: string;
  captured_at: string;
}

export async function insertFxRate(input: FxRateInput): Promise<void> {
  await query(
    "fx_rates.insert",
    `insert into fx_rates (pair, rate, quoted_at, source_status) values ($1, $2, $3, $4)`,
    [input.pair ?? "USD/BRL", input.rate, input.quotedAt, input.sourceStatus],
  );
}

export async function getLatestFxRate(pair = "USD/BRL"): Promise<FxRateRow | undefined> {
  const rows = await query<FxRateRow>(
    "fx_rates.get_latest",
    `select pair, rate, quoted_at, source_status, captured_at from fx_rates where pair = $1 order by captured_at desc limit 1`,
    [pair],
  );
  return rows[0];
}
