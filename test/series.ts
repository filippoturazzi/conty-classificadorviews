export function organic(base: number, hours = 72): number[] {
  return Array.from({ length: hours }, (_, h) =>
    Math.round(base * (0.7 + 0.3 * Math.cos((2 * Math.PI * (h - 20)) / 24)) * (1 + 0.12 * Math.sin(h * 2.3) + 0.06 * Math.cos(h * 5.1))),
  );
}

export function withOrganicPeak(series: number[], start: number, height: number, halfLife: number): number[] {
  return series.map((v, h) => (h < start ? v : Math.round(v + height * 0.5 ** ((h - start) / halfLife))));
}

export function withBoughtBlock(series: number[], start: number, length: number, height: number): number[] {
  return series.map((v, h) => (h >= start && h < start + length ? Math.round(v + height * (1 + 0.02 * Math.sin(h))) : v));
}
