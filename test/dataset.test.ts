import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { generateDataset, HOURS, KINDS, PER_KIND } from "../src/dataset.ts";

describe("dataset sintético", () => {
  it("é reproduzível: gerar duas vezes dá o mesmo resultado", () => {
    assert.deepEqual(generateDataset(), generateDataset());
  });

  it("o arquivo em data/ é exatamente o que o gerador produz", () => {
    const committed = readFileSync(new URL("../data/dataset.jsonl", import.meta.url), "utf8");
    const regenerated = generateDataset().map((s) => JSON.stringify(s)).join("\n") + "\n";
    assert.equal(committed, regenerated, "data/dataset.jsonl desatualizado: rode npm run evaluate");
  });

  it("outro seed gera outras séries", () => {
    assert.notDeepEqual(generateDataset(1, 3), generateDataset(2, 3));
  });

  it("tem todos os tipos, com rótulo e 72 horas de inteiros não negativos", () => {
    const dataset = generateDataset();
    assert.equal(dataset.length, Object.keys(KINDS).length * PER_KIND);
    for (const sample of dataset) {
      assert.equal(sample.hourly_views.length, HOURS);
      assert.ok(sample.hourly_views.every((v) => Number.isInteger(v) && v >= 0));
      assert.equal(sample.label, KINDS[sample.kind].label);
    }
  });
});
