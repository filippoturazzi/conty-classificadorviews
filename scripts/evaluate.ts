import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { DATASET_SEED, generateDataset, HOURS, PER_KIND } from "../src/dataset.ts";
import { evaluate, metricsBlock, README_END, README_START } from "../src/evaluate.ts";

export function datasetJsonl(): string {
  return generateDataset().map((sample) => JSON.stringify(sample)).join("\n") + "\n";
}

const datasetPath = new URL("../data/dataset.jsonl", import.meta.url);
const readmePath = new URL("../README.md", import.meta.url);

const jsonl = datasetJsonl();
writeFileSync(datasetPath, jsonl);
const sha = createHash("sha256").update(jsonl).digest("hex").slice(0, 16);
const metrics = evaluate(generateDataset());
const block = metricsBlock(metrics);

console.log(`dataset: data/dataset.jsonl (seed ${DATASET_SEED}, ${PER_KIND} séries por tipo, ${HOURS} h cada, sha256 ${sha}…)\n`);
console.log(block);

if (process.argv.includes("--write-readme")) {
  const readme = readFileSync(readmePath, "utf8");
  const start = readme.indexOf(README_START);
  const end = readme.indexOf(README_END);
  if (start === -1 || end === -1) throw new Error("marcadores de métricas não encontrados no README");
  const updated = `${readme.slice(0, start + README_START.length)}\n${block}\n${readme.slice(end)}`;
  writeFileSync(readmePath, updated);
  console.log("\nREADME atualizado.");
}
