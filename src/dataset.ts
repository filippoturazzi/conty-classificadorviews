export type Label = "legitimo" | "suspeito";

export type Kind =
  | "organico_estavel"
  | "organico_viral"
  | "organico_pico_curto"
  | "organico_falha_coleta"
  | "organico_baixo_volume"
  | "comprado_pico"
  | "comprado_plato"
  | "comprado_repeticao";

export const KINDS: Record<Kind, { label: Label; description: string }> = {
  organico_estavel: { label: "legitimo", description: "lançamento que decai devagar, com ciclo dia/noite e ruído" },
  organico_viral: { label: "legitimo", description: "viralizou: sobe a 8–40× em 1–3 h e cai com meia-vida de 3–12 h" },
  organico_pico_curto: { label: "legitimo", description: "pico orgânico curtíssimo (repost/story): 6–15×, meia-vida de 0,5–1,5 h" },
  organico_falha_coleta: { label: "legitimo", description: "viral com uma hora zerada no meio por falha de coleta" },
  organico_baixo_volume: { label: "legitimo", description: "conta pequena: 3–30 views/h, ruído alto" },
  comprado_pico: { label: "suspeito", description: "bloco de 1–3 h a 8–40× o normal que some de uma vez" },
  comprado_plato: { label: "suspeito", description: "platô de 6–14 h a 5–12× o normal e corte brusco" },
  comprado_repeticao: { label: "suspeito", description: "10–30 h com número quase constante (±0,5%) ou idêntico" },
};

export type Sample = { id: string; kind: Kind; label: Label; hourly_views: number[] };

export const DATASET_SEED = 20261012;
export const PER_KIND = 100;
export const HOURS = 72;

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFor(kind: Kind, index: number, seed: number): number {
  let h = seed ^ index * 2654435761;
  for (const ch of kind) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

type Gen = {
  r: () => number;
  between(a: number, b: number): number;
  int(a: number, b: number): number;
  normal(): number;
};

function gen(seed: number): Gen {
  const r = rng(seed);
  return {
    r,
    between: (a, b) => a + (b - a) * r(),
    int: (a, b) => Math.floor(a + (b - a + 1) * r()),
    normal: () => Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r()),
  };
}

function organicMean(g: Gen, base: number): number[] {
  const startHour = g.int(0, 23);
  const launch = g.between(1, 4);
  const launchHalfLife = g.between(6, 18);
  return Array.from({ length: HOURS }, (_, h) => {
    const hourOfDay = (startHour + h) % 24;
    const diurnal = 0.6 + 0.4 * Math.cos((2 * Math.PI * (hourOfDay - 20)) / 24);
    return base * diurnal * (1 + launch * 0.5 ** (h / launchHalfLife));
  });
}

function withNoise(g: Gen, mean: number[], sigma: number): number[] {
  return mean.map((m) => Math.max(0, Math.round(m * Math.exp(sigma * g.normal() - (sigma * sigma) / 2))));
}

function organicPeak(g: Gen, mean: number[], base: number, k: number, rise: number, halfLife: number, start: number): void {
  for (let h = start; h < HOURS; h += 1) {
    const dt = h - start;
    const shape = dt < rise ? (dt + 1) / rise : 0.5 ** ((dt - rise + 1) / halfLife);
    (mean as number[])[h] = (mean[h] as number) + base * k * shape;
  }
  void g;
}

export function generateSample(kind: Kind, index: number, seed = DATASET_SEED): Sample {
  const g = gen(seedFor(kind, index, seed));
  const base = kind === "organico_baixo_volume" ? g.between(3, 30) : Math.exp(g.between(Math.log(300), Math.log(3000)));
  const sigma = kind === "organico_baixo_volume" ? g.between(0.3, 0.5) : g.between(0.15, 0.3);
  const mean = organicMean(g, base);
  let views: number[];

  switch (kind) {
    case "organico_estavel":
    case "organico_baixo_volume":
      views = withNoise(g, mean, sigma);
      break;
    case "organico_viral":
    case "organico_falha_coleta": {
      const start = g.int(12, 48);
      organicPeak(g, mean, base, g.between(8, 40), g.int(1, 3), g.between(3, 12), start);
      views = withNoise(g, mean, sigma);
      if (kind === "organico_falha_coleta") views[start + g.int(1, 4)] = 0;
      break;
    }
    case "organico_pico_curto": {
      organicPeak(g, mean, base, g.between(6, 15), 1, g.between(0.5, 1.5), g.int(12, 60));
      views = withNoise(g, mean, sigma);
      break;
    }
    case "comprado_pico":
    case "comprado_plato": {
      views = withNoise(g, mean, sigma);
      const length = kind === "comprado_pico" ? g.int(1, 3) : g.int(6, 14);
      const level = base * (kind === "comprado_pico" ? g.between(8, 40) : g.between(5, 12));
      const start = g.int(12, HOURS - length - 4);
      for (let h = start; h < start + length; h += 1) {
        views[h] = (views[h] as number) + Math.round(level * Math.exp(0.08 * g.normal()));
      }
      break;
    }
    case "comprado_repeticao": {
      views = withNoise(g, mean, sigma);
      const length = g.int(10, 30);
      const start = g.int(6, HOURS - length);
      const level = Math.round(base * g.between(1.5, 6));
      const exact = g.r() < 0.3;
      for (let h = start; h < start + length; h += 1) {
        views[h] = exact ? level : Math.round(level * (1 + g.between(-0.005, 0.005)));
      }
      break;
    }
  }
  return { id: `${kind}_${String(index).padStart(3, "0")}`, kind, label: KINDS[kind].label, hourly_views: views };
}

export function generateDataset(seed = DATASET_SEED, perKind = PER_KIND): Sample[] {
  return (Object.keys(KINDS) as Kind[]).flatMap((kind) =>
    Array.from({ length: perKind }, (_, i) => generateSample(kind, i, seed)),
  );
}
