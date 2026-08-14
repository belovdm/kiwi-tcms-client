import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse, delay } from "msw";
import { setupServer } from "msw/node";
import { KiwiClient, KiwiRpcError } from "./client.js";

const BASE_URL = "http://kiwi.local";
const ENDPOINT = `${BASE_URL}/json-rpc/`;
const AUTH = { url: BASE_URL, username: "admin", password: "secret" };
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function rpcResult(result: unknown, id = 1) {
  return HttpResponse.json({ jsonrpc: "2.0", id, result });
}

function withLogin(
  handler: (info: {
    request: Request;
    body: { jsonrpc?: string; id: number; method: string; params?: unknown };
  }) => Promise<Response> | Response,
) {
  return http.post(ENDPOINT, async ({ request }) => {
    const body = (await request.json()) as {
      jsonrpc?: string;
      id: number;
      method: string;
      params?: unknown;
    };
    if (body.method === "Auth.login") {
      return HttpResponse.json(
        { jsonrpc: "2.0", id: body.id, result: "sess-abc" },
        { headers: { "Set-Cookie": "sessionid=sess-abc; Path=/; HttpOnly" } },
      );
    }
    return handler({ request, body });
  });
}

describe("KiwiClient.call", () => {
  it("logs in with username/password and sends the session cookie", async () => {
    const logins: unknown[] = [];
    let receivedCookie: string | null = null;
    let receivedAuth: string | null = null;
    let receivedBody: { jsonrpc?: string; id?: number; method?: string; params?: unknown } | undefined;

    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        const body = (await request.json()) as {
          jsonrpc?: string;
          id: number;
          method: string;
          params?: unknown;
        };
        if (body.method === "Auth.login") {
          logins.push(body.params);
          return HttpResponse.json(
            { jsonrpc: "2.0", id: body.id, result: "sess-abc" },
            { headers: { "Set-Cookie": "sessionid=sess-abc; Path=/; HttpOnly" } },
          );
        }
        receivedAuth = request.headers.get("authorization");
        receivedCookie = request.headers.get("cookie");
        receivedBody = body;
        return rpcResult([{ id: 1, name: "Payments" }], body.id);
      }),
    );

    const client = new KiwiClient(AUTH);
    const result = await client.call("Product.filter", [{}]);

    expect(logins).toEqual([["admin", "secret"]]);
    expect(receivedAuth).toBeNull();
    expect(receivedCookie).toContain("sessionid=sess-abc");
    expect(receivedBody).toMatchObject({
      jsonrpc: "2.0",
      method: "Product.filter",
      params: [{}],
    });
    expect(result).toEqual([{ id: 1, name: "Payments" }]);
  });

  it("reuses one session across calls and increments JSON-RPC ids", async () => {
    const methods: string[] = [];
    const ids: number[] = [];
    server.use(
      withLogin(({ body }) => {
        methods.push(body.method);
        ids.push(body.id);
        return rpcResult(true, body.id);
      }),
    );

    const client = new KiwiClient(AUTH);
    await client.call("A.one");
    await client.call("A.two");

    expect(methods).toEqual(["A.one", "A.two"]);
    expect(ids).toEqual([2, 3]);
  });

  it("throws KiwiRpcError when the payload contains an RPC error", async () => {
    server.use(
      withLogin(({ body }) =>
        HttpResponse.json({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32601, message: "Method not found", data: { method: "Nope.x" } },
        }),
      ),
    );

    const client = new KiwiClient(AUTH);
    await expect(client.call("Nope.x")).rejects.toMatchObject({
      name: "KiwiRpcError",
      message: "Nope.x: Method not found",
      code: -32601,
      data: { method: "Nope.x" },
    });
    await expect(client.call("Nope.x")).rejects.toBeInstanceOf(KiwiRpcError);
  });

  it("explains 401/403 as a username/password problem", async () => {
    server.use(http.post(ENDPOINT, () => new HttpResponse("nope", { status: 401 })));

    const client = new KiwiClient({ url: BASE_URL, username: "bad", password: "bad" });
    await expect(client.call("Product.filter")).rejects.toThrow(/Аутентификация не удалась \(HTTP 401\)/);
  });

  it("re-logins and retries once when a later call returns 401", async () => {
    let logins = 0;
    let filters = 0;
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        const body = (await request.json()) as { id: number; method: string };
        if (body.method === "Auth.login") {
          logins += 1;
          return rpcResult(`sess-${logins}`, body.id);
        }
        filters += 1;
        if (filters === 1) return new HttpResponse("expired", { status: 401 });
        return rpcResult([{ id: 1 }], body.id);
      }),
    );

    const client = new KiwiClient(AUTH);
    await expect(client.call("Product.filter", [{}])).resolves.toEqual([{ id: 1 }]);
    expect(logins).toBe(2);
    expect(filters).toBe(2);
  });

  it("explains 404 as a wrong KIWI_URL", async () => {
    server.use(http.post(ENDPOINT, () => new HttpResponse("missing", { status: 404 })));

    const client = new KiwiClient(AUTH);
    await expect(client.call("Product.filter")).rejects.toThrow(/HTTP 404: endpoint/);
  });

  it("includes a slice of the body for other HTTP errors", async () => {
    server.use(withLogin(() => new HttpResponse("gateway exploded", { status: 502 })));

    const client = new KiwiClient(AUTH);
    await expect(client.call("Product.filter")).rejects.toThrow(/HTTP 502 при вызове Product.filter: gateway exploded/);
  });

  it("rejects non-JSON success bodies", async () => {
    server.use(withLogin(() => new HttpResponse("<html>oops</html>", { status: 200 })));

    const client = new KiwiClient(AUTH);
    await expect(client.call("Product.filter")).rejects.toThrow(/не является JSON/);
  });

  it("times out when the server does not answer", async () => {
    server.use(
      http.post(ENDPOINT, async () => {
        await delay(100);
        return rpcResult([]);
      }),
    );

    const client = new KiwiClient({ ...AUTH, timeoutMs: 20 });
    await expect(client.call("Product.filter")).rejects.toThrow(/Таймаут 20 мс/);
  });
});

describe("KiwiClient.page", () => {
  const client = new KiwiClient(AUTH);

  it("slices rows and reports totals", () => {
    expect(client.page([1, 2, 3, 4], 2)).toEqual({ total: 4, shown: 2, rows: [1, 2] });
  });

  it("treats a missing list as empty", () => {
    expect(client.page(undefined, 5)).toEqual({ total: 0, shown: 0, rows: [] });
  });
});

describe("KiwiClient.resolveProductId", () => {
  it("returns numeric ids without calling the API", async () => {
    const client = new KiwiClient(AUTH);
    await expect(client.resolveProductId(8)).resolves.toBe(8);
    await expect(client.resolveProductId("12")).resolves.toBe(12);
  });

  it("looks up a product by name and caches the id", async () => {
    let calls = 0;
    server.use(
      withLogin(({ body }) => {
        calls += 1;
        expect(body.method).toBe("Product.filter");
        expect(body.params).toEqual([{ name: "Payments" }]);
        return rpcResult([{ id: 42, name: "Payments" }], body.id);
      }),
    );

    const client = new KiwiClient(AUTH);
    await expect(client.resolveProductId("Payments")).resolves.toBe(42);
    await expect(client.resolveProductId("payments")).resolves.toBe(42);
    expect(calls).toBe(1);
  });

  it("throws when the product name is unknown", async () => {
    server.use(withLogin(() => rpcResult([])));

    const client = new KiwiClient(AUTH);
    await expect(client.resolveProductId("Missing")).rejects.toThrow(/Продукт\/проект "Missing" не найден/);
  });
});

describe("KiwiClient.projectProductId", () => {
  it("resolves the configured project name", async () => {
    server.use(
      withLogin(({ body }) => rpcResult([{ id: 7, name: "Core" }], body.id)),
    );

    const client = new KiwiClient({ ...AUTH, project: "Core" });
    await expect(client.projectProductId()).resolves.toBe(7);
  });

  it("requires a configured project", async () => {
    const client = new KiwiClient(AUTH);
    await expect(client.projectProductId()).rejects.toThrow(/KIWI_PROJECT не задан/);
  });
});
