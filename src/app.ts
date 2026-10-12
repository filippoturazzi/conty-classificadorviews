import { classify, THRESHOLDS } from "./classifier.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

const error = (message: string, status = 400) => json({ error: { code: "validation_error", message } }, status);

export const MAX_HOURS = 24 * 90;

export function createApp() {
  async function route(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (request.method === "GET" && pathname === "/health") return json({ ok: true });
    if (request.method === "GET" && pathname === "/criteria") return json(THRESHOLDS);

    if (request.method === "POST" && pathname === "/classify") {
      let body: unknown;
      try {
        body = JSON.parse(await request.text());
      } catch {
        return error("corpo da requisição deve ser JSON");
      }
      const series = (body as { hourly_views?: unknown } | null)?.hourly_views;
      if (!Array.isArray(series) || series.length === 0) {
        return error("hourly_views deve ser uma lista com as views de cada hora, em ordem");
      }
      if (series.length > MAX_HOURS) return error(`hourly_views aceita no máximo ${MAX_HOURS} horas`);
      const bad = series.findIndex((x) => typeof x !== "number" || !Number.isInteger(x) || x < 0);
      if (bad !== -1) return error(`hourly_views[${bad}] deve ser um inteiro maior ou igual a zero`);
      return json(classify(series as number[]));
    }
    return json({ error: { code: "not_found", message: "rota não encontrada" } }, 404);
  }

  return {
    async handle(request: Request): Promise<Response> {
      try {
        return await route(request);
      } catch (err) {
        console.error(err);
        return json({ error: { code: "internal_error", message: "erro interno" } }, 500);
      }
    },
  };
}
