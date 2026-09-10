import type { LaborProfile } from "./catalogs";

export interface LaborInput {
  monthlySalary: number;
  costsAndChargesPct: number;
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

export function computeLaborRate({ monthlySalary, costsAndChargesPct, marginPct, profile }: LaborInput): LaborResult {
  const baseSalary = Math.max(monthlySalary, 0);
  const costsAndChargesRate = Math.max(costsAndChargesPct, 0) / 100;
  const monthlyCost = baseSalary * (1 + costsAndChargesRate);
  const hourlyCost = monthlyCost / MONTHLY_BILLABLE_HOURS;
  const marginRate = Math.max(marginPct, 0) / 100;
  const suggestedRate = hourlyCost * (1 + marginRate);
  return { monthlyCost, hourlyCost, suggestedRate, billableHours: MONTHLY_BILLABLE_HOURS, profile };
}
