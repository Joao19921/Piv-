import { query, withTransaction, type TransactionQuery } from "../db/client";

export interface ArchitectureServiceRow {
  id: string;
  architecture_id: string;
  service_id: string;
  provider: "AWS" | "Azure" | "GCP";
  category: string;
  name: string;
  region_key: string;
  configuration: Record<string, unknown>;
  monthly_usd: string;
  monthly_brl: string;
  position: number;
}

export interface ArchitectureRow {
  id: string;
  name: string;
  provider: "AWS" | "Azure" | "GCP";
  region_key: string;
  currency: "BRL" | "USD";
  monthly_usd: string;
  monthly_brl: string;
  created_at: string;
  updated_at: string;
}

export interface ArchitectureSummaryRow extends ArchitectureRow {
  service_count: string;
}

export interface ArchitectureServiceInput {
  serviceId: string;
  provider: "AWS" | "Azure" | "GCP";
  category: string;
  name: string;
  regionKey: string;
  configuration: Record<string, unknown>;
  monthlyUsd: number;
  monthlyBrl: number;
}

export interface ArchitectureInput {
  name: string;
  provider: "AWS" | "Azure" | "GCP";
  regionKey: string;
  currency: "BRL" | "USD";
  services: ArchitectureServiceInput[];
}

function sumUsd(services: ArchitectureServiceInput[]): number {
  return services.reduce((total, service) => total + service.monthlyUsd, 0);
}
function sumBrl(services: ArchitectureServiceInput[]): number {
  return services.reduce((total, service) => total + service.monthlyBrl, 0);
}

async function insertServices(txQuery: TransactionQuery, architectureId: string, services: ArchitectureServiceInput[]): Promise<void> {
  for (let i = 0; i < services.length; i++) {
    const service = services[i];
    await txQuery(
      "architecture_services.insert",
      `insert into architecture_services (architecture_id, service_id, provider, category, name, region_key, configuration, monthly_usd, monthly_brl, position)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [architectureId, service.serviceId, service.provider, service.category, service.name, service.regionKey, JSON.stringify(service.configuration), service.monthlyUsd, service.monthlyBrl, i],
    );
  }
}

export async function insertArchitecture(input: ArchitectureInput): Promise<string> {
  return withTransaction(async (txQuery) => {
    const [row] = await txQuery<{ id: string }>(
      "cloud_architectures.insert",
      `insert into cloud_architectures (name, provider, region_key, currency, monthly_usd, monthly_brl)
       values ($1, $2, $3, $4, $5, $6)
       returning id`,
      [input.name, input.provider, input.regionKey, input.currency, sumUsd(input.services), sumBrl(input.services)],
    );
    await insertServices(txQuery, row.id, input.services);
    return row.id;
  });
}

export async function updateArchitecture(id: string, input: ArchitectureInput): Promise<void> {
  await withTransaction(async (txQuery) => {
    await txQuery(
      "cloud_architectures.update",
      `update cloud_architectures set name = $2, provider = $3, region_key = $4, currency = $5, monthly_usd = $6, monthly_brl = $7, updated_at = now()
       where id = $1`,
      [id, input.name, input.provider, input.regionKey, input.currency, sumUsd(input.services), sumBrl(input.services)],
    );
    await txQuery("architecture_services.delete_by_architecture", `delete from architecture_services where architecture_id = $1`, [id]);
    await insertServices(txQuery, id, input.services);
  });
}

export async function deleteArchitecture(id: string): Promise<void> {
  await query("cloud_architectures.delete", `delete from cloud_architectures where id = $1`, [id]);
}

export async function listArchitectureSummaries(limit = 100): Promise<ArchitectureSummaryRow[]> {
  return query<ArchitectureSummaryRow>(
    "cloud_architectures.list_summaries",
    `select a.id, a.name, a.provider, a.region_key, a.currency, a.monthly_usd, a.monthly_brl, a.created_at, a.updated_at,
            count(s.id) as service_count
     from cloud_architectures a
     left join architecture_services s on s.architecture_id = a.id
     group by a.id
     order by a.updated_at desc
     limit $1`,
    [limit],
  );
}

export async function getArchitecture(id: string): Promise<{ architecture: ArchitectureRow; services: ArchitectureServiceRow[] } | undefined> {
  const [architecture] = await query<ArchitectureRow>(
    "cloud_architectures.get",
    `select id, name, provider, region_key, currency, monthly_usd, monthly_brl, created_at, updated_at from cloud_architectures where id = $1`,
    [id],
  );
  if (!architecture) return undefined;

  const services = await query<ArchitectureServiceRow>(
    "architecture_services.list_by_architecture",
    `select id, architecture_id, service_id, provider, category, name, region_key, configuration, monthly_usd, monthly_brl, position
     from architecture_services
     where architecture_id = $1
     order by position asc`,
    [id],
  );
  return { architecture, services };
}
