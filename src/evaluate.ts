import { type Classification, classify } from "./classifier.ts";
import { type Kind, KINDS, type Sample } from "./dataset.ts";

export type Metrics = {
  total: number;
  legit: number;
  suspicious: number;
  false_positive_rate: number;
  detection_rate: number;
  legit_inconclusive_rate: number;
  suspicious_missed_rate: number;
  by_kind: Record<Kind, Record<Classification, number>>;
};

const ratio = (n: number, d: number) => (d === 0 ? 0 : n / d);

export function evaluate(samples: Sample[]): Metrics {
  const byKind = Object.fromEntries(
    (Object.keys(KINDS) as Kind[]).map((k) => [k, { legitimo: 0, suspeito: 0, inconclusivo: 0 }]),
  ) as Metrics["by_kind"];
  let legit = 0;
  let suspicious = 0;
  let fp = 0;
  let detected = 0;
  let legitInconclusive = 0;
  let missed = 0;

  for (const sample of samples) {
    const predicted = classify(sample.hourly_views).classification;
    byKind[sample.kind][predicted] += 1;
    if (sample.label === "legitimo") {
      legit += 1;
      if (predicted === "suspeito") fp += 1;
      if (predicted === "inconclusivo") legitInconclusive += 1;
    } else {
      suspicious += 1;
      if (predicted === "suspeito") detected += 1;
      if (predicted === "legitimo") missed += 1;
    }
  }
  return {
    total: samples.length,
    legit,
    suspicious,
    false_positive_rate: ratio(fp, legit),
    detection_rate: ratio(detected, suspicious),
    legit_inconclusive_rate: ratio(legitInconclusive, legit),
    suspicious_missed_rate: ratio(missed, suspicious),
    by_kind: byKind,
  };
}

export const formatPct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function metricsBlock(m: Metrics): string {
  const rows = (Object.keys(KINDS) as Kind[]).map((kind) => {
    const c = m.by_kind[kind];
    return `| \`${kind}\` | ${KINDS[kind].label} | ${c.legitimo} | ${c.inconclusivo} | ${c.suspeito} |`;
  });
  return [
    `- Séries: **${m.total}** (${m.legit} legítimas, ${m.suspicious} suspeitas)`,
    `- **Taxa de falso positivo: ${formatPct(m.false_positive_rate)}** (legítimas classificadas como suspeitas)`,
    `- Detecção: ${formatPct(m.detection_rate)} das suspeitas classificadas como suspeitas`,
    `- Legítimas em "inconclusivo" (preferimos não acusar): ${formatPct(m.legit_inconclusive_rate)}`,
    `- Suspeitas que passaram como legítimas: ${formatPct(m.suspicious_missed_rate)}`,
    "",
    "| Tipo de série | Rótulo verdadeiro | → legítimo | → inconclusivo | → suspeito |",
    "|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}

export const README_START = "<!-- metricas:inicio (gerado por npm run evaluate:write; não editar à mão) -->";
export const README_END = "<!-- metricas:fim -->";
