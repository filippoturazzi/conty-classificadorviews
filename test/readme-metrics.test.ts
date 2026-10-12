import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { generateDataset } from "../src/dataset.ts";
import { evaluate, metricsBlock, README_END, README_START } from "../src/evaluate.ts";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

describe("README x medido", () => {
  it("o bloco de métricas do README é exatamente o que npm run evaluate mede", () => {
    const start = readme.indexOf(README_START);
    const end = readme.indexOf(README_END);
    assert.ok(start !== -1 && end !== -1, "o README precisa ter os marcadores de métricas");
    const written = readme.slice(start + README_START.length, end).trim();

    const measured = metricsBlock(evaluate(generateDataset())).trim();
    assert.equal(written, measured, "o README diverge do medido: rode npm run evaluate:write");
  });

  it("a taxa de falso positivo citada no texto do README é a medida", () => {
    const measured = metricsBlock(evaluate(generateDataset())).match(/Taxa de falso positivo: ([\d.]+%)/)?.[1];
    const mentions = [...readme.matchAll(/falso positivo[^\n]*?(\d+\.\d%)/gi)].map((m) => m[1]);
    assert.ok(mentions.length > 0);
    for (const mention of mentions) assert.equal(mention, measured);
  });
});
