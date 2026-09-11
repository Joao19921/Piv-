export interface ParsedTenderText {
  profiles: Array<{ profile: string; seniority?: string; hourlyRate?: number }>;
  equipment: Array<{ description: string; unitPrice?: number }>;
}

function money(value: string): number | undefined {
  const normalized = value.replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseTenderText(text: string): ParsedTenderText {
  const profiles: ParsedTenderText["profiles"] = [];
  const equipment: ParsedTenderText["equipment"] = [];
  const profilePattern = /(desenvolvedor|arquiteto|scrum master|analista|consultor)[^\n]{0,100}?(?:R\$\s*([\d.,]+)\s*(?:por hora|\/h|hora))/gi;
  for (const match of text.matchAll(profilePattern)) {
    profiles.push({ profile: match[1].trim(), hourlyRate: money(match[2]) });
  }
  const equipmentPattern = /(notebook|servidor|licen[çc]a de software|switch)[^\n]{0,100}?(?:R\$\s*([\d.,]+))/gi;
  for (const match of text.matchAll(equipmentPattern)) {
    equipment.push({ description: match[1].trim(), unitPrice: money(match[2]) });
  }
  return { profiles, equipment };
}