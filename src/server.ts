import { createServer } from "node:http";
import { createApp } from "./app.ts";

const app = createApp();
const port = Number(process.env.PORT ?? 3009);

const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const request = new Request(`http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: req.method === "GET" || req.method === "HEAD" || chunks.length === 0 ? undefined : Buffer.concat(chunks),
  });
  const response = await app.handle(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(await response.text());
});

server.listen(port, () => {
  console.log(`classificador em http://127.0.0.1:${port}`);
});
