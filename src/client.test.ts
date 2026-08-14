import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse, delay } from "msw";
import { setupServer } from "msw/node";
import { KiwiClient, KiwiRpcError } from "./client.js";

const BASE_URL = "http://kiwi.local";
const ENDPOINT = `${BASE_URL}/json-rpc/`;
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function rpcResult(result: unknown, id = 1) {
  return HttpResponse.json({ jsonrpc: "2.0", id, result });
}

describe("KiwiClient.call", () => {
  it("posts JSON-RPC with token auth and returns the result", async () => {
    let receivedAuth: string | null = null;
    let receivedBody: { jsonrpc?: string; id?: number; method?: string; params?: unknown } | undefined;

    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        receivedAuth = request.headers.get("authorization");
        receivedBody = (await request.json()) as typeof receivedBody;
        return rpcResult([{ id: 1, name: "Payments" }], receivedBody?.id);
      }),
    );

    const client = new KiwiClient({ url: BASE_URL, token: "tok-123" });
    const result = await client.call("Product.filter", [{}]);

    expect(receivedAuth).toBe("Token tok-123");
    expect(receivedBody).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      method: "Product.filter",
      params: [{}],
    });
    expect(result).toEqual([{ id: 1, name: "Payments" }]);
  });

  it("increments JSON-RPC ids across calls", async () => {
    const ids: number[] = [];
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        const body = (await request.json()) as { id: number };
        ids.push(body.id);
        return rpcResult(true, body.id);
      }),
    );

    const client = new KiwiClient({ url: BASE_URL, token: "tok-123" });
    await client.call("A.one");
    await client.call("A.two");

    expect(ids).toEqual([1, 2]);
  });

  it("throws KiwiRpcError when the payload contains an RPC error", async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32601, message: "Method not found", data: { method: "Nope.x" } },
        }),
      ),
    );

    const client = new KiwiClient({ url: BASE_URL, token: "tok-123" });
    await expect(client.call("Nope.x")).rejects.toMatchObject({
      name: "KiwiRpcError",
      message: "Nope.x: Method not found",
      code: -32601,
      data: { method: "Nope.x" },
    });
    await expect(client.call("Nope.x")).rejects.toBeInstanceOf(KiwiRpcError);
  });

  it("explains 401/403 as a token problem", async () => {
    server.use(http.post(ENDPOINT, () => new HttpResponse("nope", { status: 401 })));

    const client = new KiwiClient({ url: BASE_URL, token: "bad" });
    await expect(client.call("Product.filter")).rejects.toThrow(/Аутентификация не удалась \(HTTP 401\)/);
  });

  it("explains 404 as a wrong KIWI_URL", async () => {
    server.use(http.post(ENDPOINT, () => new HttpResponse("missing", { status: 404 })));

    const client = new KiwiClient({ url: BASE_URL, token: "tok-123" });
    await expect(client.call("Product.filter")).rejects.toThrow(/HTTP 404: endpoint/);
  });

  it("includes a slice of the body for other HTTP errors", async () => {
    server.use(http.post(ENDPOINT, () => new HttpResponse("gateway exploded", { status: 502 })));

    const client = new KiwiClient({ url: BASE_URL, token: "tok-123" });
    await expect(client.call("Product.filter")).rejects.toThrow(/HTTP 502 при вызове Product.filter: gateway exploded/);
  });

  it("rejects non-JSON success bodies", async () => {
    server.use(http.post(ENDPOINT, () => new HttpResponse("<html>oops</html>", { status: 200 })));

    const client = new KiwiClient({ url: BASE_URL, token: "tok-123" });
    await expect(client.call("Product.filter")).rejects.toThrow(/не является JSON/);
  });

  it("times out when the server does not answer", async () => {
    server.use(
      http.post(ENDPOINT, async () => {
        await delay(100);
        return rpcResult([]);
      }),
    );

    const client = new KiwiClient({ url: BASE_URL, token: "tok-123", timeoutMs: 20 });
    await expect(client.call("Product.filter")).rejects.toThrow(/Таймаут 20 мс/);
  });
});

describe("KiwiClient.page", () => {
  const client = new KiwiClient({ url: BASE_URL, token: "tok-123" });

  it("slices rows and reports totals", () => {
    expect(client.page([1, 2, 3, 4], 2)).toEqual({ total: 4, shown: 2, rows: [1, 2] });
  });

  it("treats a missing list as empty", () => {
    expect(client.page(undefined, 5)).toEqual({ total: 0, shown: 0, rows: [] });
  });
});

describe("KiwiClient.resolveProductId", () => {
  it("returns numeric ids without calling the API", async () => {
    const client = new KiwiClient({ url: BASE_URL, token: "tok-123" });
    await expect(client.resolveProductId(8)).resolves.toBe(8);
    await expect(client.resolveProductId("12")).resolves.toBe(12);
  });

  it("looks up a product by name and caches the id", async () => {
    let calls = 0;
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        const body = (await request.json()) as { id: number; method: string; params: unknown[] };
        calls += 1;
        expect(body.method).toBe("Product.filter");
        expect(body.params).toEqual([{ name: "Payments" }]);
        return rpcResult([{ id: 42, name: "Payments" }], body.id);
      }),
    );

    const client = new KiwiClient({ url: BASE_URL, token: "tok-123" });
    await expect(client.resolveProductId("Payments")).resolves.toBe(42);
    await expect(client.resolveProductId("payments")).resolves.toBe(42);
    expect(calls).toBe(1);
  });

  it("throws when the product name is unknown", async () => {
    server.use(http.post(ENDPOINT, () => rpcResult([])));

    const client = new KiwiClient({ url: BASE_URL, token: "tok-123" });
    await expect(client.resolveProductId("Missing")).rejects.toThrow(/Продукт\/проект "Missing" не найден/);
  });
});

describe("KiwiClient.projectProductId", () => {
  it("resolves the configured project name", async () => {
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        const body = (await request.json()) as { id: number };
        return rpcResult([{ id: 7, name: "Core" }], body.id);
      }),
    );

    const client = new KiwiClient({ url: BASE_URL, token: "tok-123", project: "Core" });
    await expect(client.projectProductId()).resolves.toBe(7);
  });

  it("requires a configured project", async () => {
    const client = new KiwiClient({ url: BASE_URL, token: "tok-123" });
    await expect(client.projectProductId()).rejects.toThrow(/KIWI_PROJECT не задан/);
  });
});
