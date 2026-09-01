import type { LaborProfile } from "./catalogs";

export interface LaborInput {
  monthlySalary: number;
  factorK: number;
  marginPct: number;
  profile?: LaborProfile;
}

export interface LaborResult {
  monthlyCost: number;
  hourlyCost: number;
  suggestedRate: number;
  billableHours: number;
  profile?: LaborProfile;
}

const MONTHLY_BILLABLE_HOURS = 168;

export function computeLaborRate({ monthlySalary, factorK, marginPct, profile }: LaborInput): LaborResult {
  const monthlyCost = Math.max(monthlySalary, 0) * Math.max(factorK, 0);
  const hourlyCost = monthlyCost / MONTHLY_BILLABLE_HOURS;
  const marginRate = Math.min(Math.max(marginPct, 0), 95) / 100;
  const suggestedRate = hourlyCost / Math.max(1 - marginRate, 0.01);
  return { monthlyCost, hourlyCost, suggestedRate, billableHours: MONTHLY_BILLABLE_HOURS, profile };
}
