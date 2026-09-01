export interface CloudEstimateInput {
  unitPriceUsd: number;
  fxRate: number;
  instances: number;
  hours: number;
}

export interface CloudEstimateResult {
  monthlyUsd: number;
  monthlyBrl: number;
}

export function computeCloudEstimate({ unitPriceUsd, fxRate, instances, hours }: CloudEstimateInput): CloudEstimateResult {
  const monthlyUsd = Math.max(unitPriceUsd, 0) * Math.max(instances, 0) * Math.max(hours, 0);
  return { monthlyUsd, monthlyBrl: monthlyUsd * Math.max(fxRate, 0) };
}
