export interface CloudEstimateInput {
  unitPriceUsd: number;
  fxRate: number;
  instances: number;
  hours: number;
  storageGb?: number;
  storagePricePerGbMonthUsd?: number;
}

export interface CloudEstimateResult {
  computeUsd: number;
  storageUsd: number;
  monthlyUsd: number;
  monthlyBrl: number;
}

export function computeCloudEstimate({
  unitPriceUsd,
  fxRate,
  instances,
  hours,
  storageGb = 0,
  storagePricePerGbMonthUsd = 0,
}: CloudEstimateInput): CloudEstimateResult {
  const computeUsd = Math.max(unitPriceUsd, 0) * Math.max(instances, 0) * Math.max(hours, 0);
  const storageUsd = Math.max(storageGb, 0) * Math.max(storagePricePerGbMonthUsd, 0);
  const monthlyUsd = computeUsd + storageUsd;
  return { computeUsd, storageUsd, monthlyUsd, monthlyBrl: monthlyUsd * Math.max(fxRate, 0) };
}
