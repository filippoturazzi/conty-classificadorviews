import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApp } from "../src/app.ts";
import { organic, withBoughtBlock } from "./series.ts";

const app = createApp();
const post = async (body: unknown) => {
  const res = await app.handle(
    new Request("http://t/classify", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }),
  );
  return { status: res.status, body: (await res.json()) as any };
};

describe("API", () => {
  it("classifica e devolve motivo, sinais e estatísticas", async () => {
    const res = await post({ hourly_views: withBoughtBlock(organic(1000), 30, 2, 20_000) });
    assert.equal(res.status, 200);
    assert.equal(res.body.classification, "suspeito");
    assert.equal(typeof res.body.reason, "string");
    assert.equal(res.body.signals.length, 3);
    assert.equal(res.body.stats.hours, 72);
  });

  it("valida a série", async () => {
    assert.equal((await post({})).status, 400);
    assert.equal((await post({ hourly_views: [] })).status, 400);
    assert.equal((await post({ hourly_views: [1, -2, 3] })).status, 400);
    assert.equal((await post({ hourly_views: [1, 2.5, 3] })).status, 400);
    assert.equal((await post({ hourly_views: [1, "2", 3] })).status, 400);
    assert.equal((await post("{quebrado")).status, 400);
  });

  it("expõe os limiares usados", async () => {
    const res = await app.handle(new Request("http://t/criteria"));
    assert.equal(((await res.json()) as { cliffStrongLoss: number }).cliffStrongLoss, 0.9);
  });
});
