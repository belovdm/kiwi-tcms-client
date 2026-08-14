import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { KiwiClient } from "./client.js";

const BASE_URL = "http://kiwi.local";
const ENDPOINT = `${BASE_URL}/json-rpc/`;
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function rpcByMethod(handlers: Record<string, (params: unknown) => unknown>) {
  server.use(
    http.post(ENDPOINT, async ({ request }) => {
      const body = (await request.json()) as { id: number; method: string; params: unknown };
      const fn = handlers[body.method];
      if (!fn) return HttpResponse.json({ jsonrpc: "2.0", id: body.id, error: { message: body.method } }, { status: 200 });
      return HttpResponse.json({ jsonrpc: "2.0", id: body.id, result: fn(body.params) });
    }),
  );
}

describe("KiwiClient.projects", () => {
  it("lists products and pages the result", async () => {
    rpcByMethod({
      "Product.filter": () => [
        { id: 1, name: "Alpha" },
        { id: 2, name: "Beta" },
        { id: 3, name: "Gamma" },
      ],
    });

    const client = new KiwiClient({ url: BASE_URL, token: "tok" });
    const result = await client.projects.list({ limit: 2 });

    expect(result).toEqual({
      total: 3,
      shown: 2,
      rows: [
        { id: 1, name: "Alpha" },
        { id: 2, name: "Beta" },
      ],
    });
  });
});

describe("KiwiClient.ping", () => {
  it("returns connection info and the configured project id", async () => {
    rpcByMethod({
      "Product.filter": (params) => {
        const q = Array.isArray(params) ? (params[0] as Record<string, unknown>) : {};
        if (q && q.name === "Payments") return [{ id: 9, name: "Payments" }];
        return [{ id: 1 }, { id: 2 }];
      },
    });

    const client = new KiwiClient({ url: BASE_URL, token: "tok", project: "Payments" });
    const result = await client.ping();

    expect(result.status).toBe("ok");
    expect(result.server).toBe(BASE_URL);
    expect(result.endpoint).toBe(ENDPOINT);
    expect(result.project).toEqual({ name: "Payments", id: 9 });
    expect(result.products_total).toBe(2);
  });
});

describe("KiwiClient.cases.create", () => {
  it("resolves category and priority names, then creates the case", async () => {
    const createdCalls: unknown[] = [];
    rpcByMethod({
      "Product.filter": () => [{ id: 5, name: "Core" }],
      "Category.filter": () => [{ id: 11, name: "API" }],
      "Priority.filter": () => [{ id: 3, value: "Medium" }],
      "TestCase.create": (params) => {
        createdCalls.push(params);
        return { id: 77, summary: "Login" };
      },
      "TestPlan.add_case": () => true,
      "TestCase.add_tag": () => true,
    });

    const client = new KiwiClient({ url: BASE_URL, token: "tok", project: "Core" });
    const result = await client.cases.create({
      summary: "Login",
      category: "API",
      plan: 12,
      tags: "smoke",
    });

    expect(createdCalls[0]).toEqual([
      { summary: "Login", product: 5, category: 11, priority: 3 },
    ]);
    expect(result.created).toEqual({ id: 77, summary: "Login" });
    expect(result.actions).toEqual(["привязан к плану 12", "тег: smoke"]);
  });
});
