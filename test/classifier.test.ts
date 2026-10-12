import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classify } from "../src/classifier.ts";
import { organic, withBoughtBlock, withOrganicPeak } from "./series.ts";

const signal = (result: ReturnType<typeof classify>, id: string) => result.signals.find((s) => s.id === id);

describe("casos óbvios", () => {
  it("audiência normal com ciclo dia/noite é legítima", () => {
    const result = classify(organic(1000));
    assert.equal(result.classification, "legitimo");
    assert.ok(result.signals.every((s) => s.status === "ausente"));
  });

  it("pico comprado: 20× o normal por 2 horas que some de uma vez", () => {
    const result = classify(withBoughtBlock(organic(1000), 30, 2, 20_000));
    assert.equal(result.classification, "suspeito");
    assert.equal(signal(result, "pico_comprado")?.status, "forte");
    assert.deepEqual(signal(result, "pico_comprado")?.hours, [30, 32]);
  });

  it("platô de 10 horas a 8× o normal com corte seco", () => {
    const result = classify(withBoughtBlock(organic(1000), 20, 10, 7000));
    assert.equal(result.classification, "suspeito");
    assert.equal(signal(result, "queda_abrupta")?.status, "forte");
    assert.equal(signal(result, "pico_comprado")?.status, "ausente");
  });

  it("repetição mecânica: o mesmo número por 6 horas", () => {
    const series = organic(1000);
    for (let h = 30; h < 36; h += 1) series[h] = 1500;
    const result = classify(series);
    assert.equal(result.classification, "suspeito");
    assert.match(signal(result, "repeticao_mecanica")?.evidence ?? "", /exatamente 1500 views por hora durante 6 horas/);
  });

  it("repetição mecânica: 12 horas variando menos de 1%", () => {
    const series = organic(1000);
    for (let h = 30; h < 42; h += 1) series[h] = 2000 + (h % 3) * 5;
    assert.equal(classify(series).classification, "suspeito");
  });

  it("série com menos de 24 horas não é classificada", () => {
    const result = classify(withBoughtBlock(organic(1000, 20), 5, 2, 20_000));
    assert.equal(result.classification, "inconclusivo");
    assert.match(result.reason, /curta demais/);
  });
});

describe("pico orgânico e pico comprado não caem no mesmo balde", () => {
  it("mesma altura (20× o normal): viral com cauda é legítimo, bloco que some é suspeito", () => {
    const viral = classify(withOrganicPeak(organic(1000), 30, 20_000, 4));
    const bought = classify(withBoughtBlock(organic(1000), 30, 2, 20_000));

    assert.ok(Math.abs(viral.stats.peak_per_hour - bought.stats.peak_per_hour) / bought.stats.peak_per_hour < 0.05, "picos da mesma altura em views/h");
    assert.equal(viral.classification, "legitimo");
    assert.equal(bought.classification, "suspeito");
    assert.match(viral.reason, /caiu aos poucos/);
    assert.match(bought.reason, /perderam \d+% do excesso de uma vez/);
    assert.ok((viral.stats.peak_max_hourly_loss ?? 1) < 0.5, "o viral perde bem menos que 70% do excesso por hora");
    assert.equal(bought.stats.peak_max_hourly_loss, 1, "o comprado perde 100% de uma vez");
  });

  it("viral ainda mais alto (50×) e rápido (meia-vida de 2 h) continua legítimo", () => {
    const result = classify(withOrganicPeak(organic(1000), 30, 50_000, 2));
    assert.equal(result.classification, "legitimo");
  });
});

describe("quando o classificador prefere não acusar", () => {
  it("pico orgânico curtíssimo que perde ~80% numa hora fica inconclusivo, não suspeito", () => {
    const result = classify(withOrganicPeak(organic(1000), 30, 15_000, 0.43));
    assert.equal(result.classification, "inconclusivo");
    assert.match(result.reason, /^Preferimos não acusar/);
    assert.match(signal(result, "pico_comprado")?.evidence ?? "", /pode ser um pico orgânico curto/);
  });

  it("hora zerada no meio de um viral (falha de coleta) não vira acusação", () => {
    const series = withOrganicPeak(organic(1000), 30, 20_000, 4);
    series[32] = 0;
    const result = classify(series);
    assert.equal(result.classification, "inconclusivo");
    assert.match(result.reason, /pode ser falha de coleta/);
  });

  it("forma de pico comprado com volume baixo (conta de 10 views/h) não é acusada", () => {
    const result = classify(withBoughtBlock(organic(10), 30, 2, 150));
    assert.notEqual(result.classification, "suspeito");
    assert.match(result.reason, /volume .* baixo demais para acusar/);
  });

  it("corte no fim da série, sem horas depois para confirmar", () => {
    const result = classify(withBoughtBlock(organic(1000), 69, 2, 20_000));
    assert.equal(result.classification, "inconclusivo");
    assert.match(result.reason, /série acaba logo depois/);
  });
});

describe("motivo legível", () => {
  it("o motivo é uma frase em português, sem nomes de variáveis do código", () => {
    for (const series of [
      organic(1000),
      withBoughtBlock(organic(1000), 30, 2, 20_000),
      withOrganicPeak(organic(1000), 30, 15_000, 0.43),
      withOrganicPeak(organic(1000), 30, 20_000, 4),
    ]) {
      const { reason } = classify(series);
      assert.doesNotMatch(reason, /_|undefined|NaN|null/);
      assert.ok(reason.length > 40);
    }
  });

  it("cada sinal traz a regra que aplicou", () => {
    const result = classify(organic(1000));
    assert.equal(result.signals.length, 3);
    assert.ok(result.signals.every((s) => s.rule.length > 20));
  });
});
