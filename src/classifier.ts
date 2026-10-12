export const THRESHOLDS = {
  minHours: 24,
  cliffMinRatio: 5,
  cliffGrayLoss: 0.7,
  cliffStrongLoss: 0.9,
  cliffStayDownRatio: 2,
  spikeMaxHours: 3,
  repetitionWindow: 8,
  repetitionStrongCv: 0.02,
  repetitionGrayCv: 0.04,
  repetitionMinMean: 50,
  minVolumeToAccuse: 200,
} as const;

export type Classification = "legitimo" | "suspeito" | "inconclusivo";
export type SignalStatus = "forte" | "cinza" | "ausente";
export type SignalId = "pico_comprado" | "queda_abrupta" | "repeticao_mecanica";

export type Signal = {
  id: SignalId;
  title: string;
  status: SignalStatus;
  evidence: string;
  hours: [number, number] | null;
  measured: Record<string, number> | null;
  rule: string;
};

export type Result = {
  classification: Classification;
  reason: string;
  signals: Signal[];
  stats: {
    hours: number;
    baseline_per_hour: number;
    peak_per_hour: number;
    peak_hour: number;
    peak_ratio: number;
    peak_max_hourly_loss: number | null;
  };
};

const T = THRESHOLDS;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const times = (x: number) => `${Math.round(x * 10) / 10}×`;
const range = ([a, b]: [number, number]) => (a === b ? `na hora ${a}` : `nas horas ${a}–${b}`);

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

type Cliff = {
  hour: number;
  episode: [number, number];
  before: number;
  after: number;
  loss: number;
  stayedDown: boolean | null;
};

function findCliffs(v: number[], base: number): Cliff[] {
  const cliffs: Cliff[] = [];
  for (let t = 1; t < v.length; t += 1) {
    const before = v[t - 1] as number;
    const after = v[t] as number;
    if (before < T.cliffMinRatio * base) continue;
    const loss = (before - after) / (before - base);
    if (loss < T.cliffGrayLoss) continue;
    let start = t - 1;
    while (start > 0 && (v[start - 1] as number) >= 3 * base) start -= 1;
    const next = v.slice(t + 1, t + 3);
    const stayedDown = next.length < 2 ? null : next.every((x) => x <= T.cliffStayDownRatio * base);
    cliffs.push({ hour: t, episode: [start, t - 1], before, after, loss: Math.min(loss, 1), stayedDown });
  }
  return cliffs;
}

function cliffSignal(id: "pico_comprado" | "queda_abrupta", cliffs: Cliff[], base: number): Signal {
  const isSpike = (c: Cliff) => c.episode[1] - c.episode[0] + 1 <= T.spikeMaxHours;
  const mine = cliffs.filter((c) => (id === "pico_comprado" ? isSpike(c) : !isSpike(c)));
  const title = id === "pico_comprado" ? "Pico sem cauda (pico comprado)" : "Queda abrupta depois de platô";
  const rule =
    `nível ≥ ${T.cliffMinRatio}× o normal que perde ≥ ${pct(T.cliffStrongLoss)} do excesso em 1 hora e fica abaixo de ` +
    `${T.cliffStayDownRatio}× o normal nas 2 horas seguintes (forte); perda entre ${pct(T.cliffGrayLoss)} e ` +
    `${pct(T.cliffStrongLoss)}, ou volta a subir logo depois, é zona cinza. ` +
    (id === "pico_comprado" ? `Episódio de até ${T.spikeMaxHours} h.` : `Episódio de ${T.spikeMaxHours + 1} h ou mais.`);

  const strength = (c: Cliff): SignalStatus =>
    c.loss >= T.cliffStrongLoss && c.stayedDown === true && c.before >= T.minVolumeToAccuse ? "forte" : "cinza";
  const worst = [...mine].sort((a, b) => Number(strength(b) === "forte") - Number(strength(a) === "forte") || b.loss - a.loss)[0];
  if (!worst) {
    return { id, title, status: "ausente", evidence: "nenhuma queda de 1 hora desse tipo", hours: null, measured: null, rule };
  }

  const status = strength(worst);
  const length = worst.episode[1] - worst.episode[0] + 1;
  const what =
    `${range(worst.episode)} (${length} h) as views chegaram a ${times(worst.before / base)} o normal ` +
    `e na hora ${worst.hour} perderam ${pct(worst.loss)} do excesso de uma vez`;
  let why: string;
  if (status === "forte") why = "e ficaram no nível normal depois";
  else if (worst.stayedDown === false) why = "mas não ficaram no nível normal nas 2 horas seguintes, o que não combina com o fim de uma entrega comprada (pode ser falha de coleta ou pico orgânico curto)";
  else if (worst.stayedDown === null) why = "mas a série acaba logo depois, então não dá para ver se ficaram embaixo";
  else if (worst.before < T.minVolumeToAccuse) why = `mas o volume (${Math.round(worst.before)}/h) é baixo demais para acusar`;
  else why = `uma queda rápida, mas abaixo de ${pct(T.cliffStrongLoss)}: pode ser um pico orgânico curto`;

  return {
    id,
    title,
    status,
    evidence: `${what}, ${why}`,
    hours: [worst.episode[0], worst.hour],
    measured: {
      ratio_before: Math.round((worst.before / base) * 10) / 10,
      excess_lost_in_1h: Math.round(worst.loss * 1000) / 1000,
      episode_hours: length,
    },
    rule,
  };
}

function repetitionSignal(v: number[]): Signal {
  const title = "Repetição mecânica";
  const rule =
    `${T.repetitionWindow} horas seguidas com média ≥ ${T.repetitionMinMean}/h e variação (desvio ÷ média) ≤ ` +
    `${pct(T.repetitionStrongCv)} é forte; até ${pct(T.repetitionGrayCv)} é zona cinza; ` +
    `4 horas seguidas com exatamente o mesmo número também é forte.`;
  let best: { start: number; cv: number; mean: number } | null = null;
  for (let s = 0; s + T.repetitionWindow <= v.length; s += 1) {
    const w = v.slice(s, s + T.repetitionWindow);
    const mean = w.reduce((a, b) => a + b, 0) / w.length;
    if (mean < T.repetitionMinMean) continue;
    const sd = Math.sqrt(w.reduce((a, b) => a + (b - mean) ** 2, 0) / w.length);
    const cv = sd / mean;
    if (!best || cv < best.cv) best = { start: s, cv, mean };
  }
  let identical: { start: number; length: number; value: number } | null = null;
  for (let s = 0; s < v.length; ) {
    let e = s;
    while (e + 1 < v.length && v[e + 1] === v[s]) e += 1;
    if (e - s + 1 >= 4 && (v[s] as number) >= T.repetitionMinMean && (!identical || e - s + 1 > identical.length)) {
      identical = { start: s, length: e - s + 1, value: v[s] as number };
    }
    s = e + 1;
  }

  if (identical) {
    const strong = identical.value >= T.minVolumeToAccuse;
    return {
      id: "repeticao_mecanica",
      title,
      status: strong ? "forte" : "cinza",
      evidence:
        `exatamente ${identical.value} views por hora durante ${identical.length} horas seguidas` +
        (strong ? "; audiência real nunca é tão constante" : `, mas o volume (${identical.value}/h) é baixo demais para acusar`),
      hours: [identical.start, identical.start + identical.length - 1],
      measured: { identical_hours: identical.length, value: identical.value },
      rule,
    };
  }
  if (!best || best.cv > T.repetitionGrayCv) {
    return {
      id: "repeticao_mecanica",
      title,
      status: "ausente",
      evidence: best
        ? `a janela mais estável de ${T.repetitionWindow} h ainda varia ${pct(best.cv)}, ritmo normal de audiência real`
        : "volume baixo demais para avaliar ritmo",
      hours: null,
      measured: best ? { min_cv: Math.round(best.cv * 1000) / 1000 } : null,
      rule,
    };
  }
  const strong = best.cv <= T.repetitionStrongCv && best.mean >= T.minVolumeToAccuse;
  const hours: [number, number] = [best.start, best.start + T.repetitionWindow - 1];
  return {
    id: "repeticao_mecanica",
    title,
    status: strong ? "forte" : "cinza",
    evidence:
      `${range(hours)} a média foi ${Math.round(best.mean)}/h variando só ${pct(best.cv)}` +
      (strong
        ? "; audiência real oscila bem mais que isso de uma hora para outra"
        : best.mean < T.minVolumeToAccuse
          ? `, mas o volume é baixo demais para acusar`
          : `, estável demais para ser comum, mas não o bastante para acusar`),
    hours,
    measured: { cv: Math.round(best.cv * 1000) / 1000, mean_per_hour: Math.round(best.mean) },
    rule,
  };
}

function peakDecay(v: number[], base: number, peakHour: number): number | null {
  let worst: number | null = null;
  for (let t = peakHour + 1; t < v.length; t += 1) {
    const before = v[t - 1] as number;
    if (before <= 2 * base) break;
    const loss = Math.max(0, (before - (v[t] as number)) / (before - base));
    worst = Math.max(worst ?? 0, Math.min(loss, 1));
  }
  return worst === null ? null : Math.round(worst * 1000) / 1000;
}

export function classify(series: readonly number[]): Result {
  const v = [...series];
  const base = Math.max(1, median(v));
  const peak = Math.max(...v);
  const peakHour = v.indexOf(peak);
  const stats = {
    hours: v.length,
    baseline_per_hour: Math.round(base * 10) / 10,
    peak_per_hour: peak,
    peak_hour: peakHour,
    peak_ratio: Math.round((peak / base) * 10) / 10,
    peak_max_hourly_loss: peakDecay(v, base, peakHour),
  };

  if (v.length < T.minHours) {
    return {
      classification: "inconclusivo",
      reason: `Série curta demais (${v.length} h). Precisamos de pelo menos ${T.minHours} h para comparar com o ritmo normal.`,
      signals: [],
      stats,
    };
  }

  const cliffs = findCliffs(v, base);
  const signals = [cliffSignal("pico_comprado", cliffs, base), cliffSignal("queda_abrupta", cliffs, base), repetitionSignal(v)];
  const strong = signals.filter((s) => s.status === "forte");
  const gray = signals.filter((s) => s.status === "cinza");

  if (strong.length > 0) {
    return {
      classification: "suspeito",
      reason: `${strong.map((s) => `${s.title}: ${s.evidence}.`).join(" ")} O normal desta série é ${Math.round(base)} views por hora.`,
      signals,
      stats,
    };
  }
  if (gray.length > 0) {
    return {
      classification: "inconclusivo",
      reason:
        `Preferimos não acusar. ${gray.map((s) => `${s.title}: ${s.evidence}.`).join(" ")} ` +
        `Vale uma revisão humana antes de decidir.`,
      signals,
      stats,
    };
  }
  let peakNote = "";
  if (stats.peak_ratio >= 3 && stats.peak_max_hourly_loss !== null) {
    peakNote =
      stats.peak_max_hourly_loss < T.cliffGrayLoss
        ? ` O maior pico (${times(stats.peak_ratio)} o normal, hora ${peakHour}) caiu aos poucos, perdendo no máximo ` +
          `${pct(stats.peak_max_hourly_loss)} do excesso por hora, como um vídeo que viralizou de verdade.`
        : ` O maior pico (${times(stats.peak_ratio)} o normal, hora ${peakHour}) caiu rápido, mas o nível antes da queda ficou ` +
          `abaixo de ${T.cliffMinRatio}× o normal, o mínimo que este classificador exige para acusar.`;
  }
  return {
    classification: "legitimo",
    reason: `Nenhum sinal de view artificial: sem queda de 1 hora de volta ao normal e sem ritmo constante demais.${peakNote}`,
    signals,
    stats,
  };
}
