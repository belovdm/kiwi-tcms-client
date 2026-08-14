import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { KiwiClient } from "./client.js";

const BASE_URL = "http://kiwi.local";
const ENDPOINT = `${BASE_URL}/json-rpc/`;
const AUTH = { url: BASE_URL, username: "admin", password: "secret" };
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function rpcByMethod(handlers: Record<string, (params: unknown) => unknown>) {
  server.use(
    http.post(ENDPOINT, async ({ request }) => {
      const body = (await request.json()) as { id: number; method: string; params: unknown };
      if (body.method === "Auth.login" && !handlers["Auth.login"]) {
        return HttpResponse.json({ jsonrpc: "2.0", id: body.id, result: "sess-test" });
      }
      const fn = handlers[body.method];
      if (!fn)
        return HttpResponse.json(
          { jsonrpc: "2.0", id: body.id, error: { message: body.method } },
          { status: 200 },
        );
      return HttpResponse.json({ jsonrpc: "2.0", id: body.id, result: fn(body.params) });
    }),
  );
}

const catalogs = {
  "Product.filter": () => [{ id: 5, name: "Core" }],
  "Category.filter": () => [{ id: 11, name: "API" }],
  "Priority.filter": () => [{ id: 3, value: "Medium" }],
  "TestCaseStatus.filter": () => [{ id: 2, name: "CONFIRMED" }],
};

describe("KiwiClient.cases.create", () => {
  it("writes text into TestCase.text verbatim, with no section parsing", async () => {
    const createdCalls: unknown[] = [];
    rpcByMethod({
      ...catalogs,
      "TestCase.create": (params) => {
        createdCalls.push(params);
        return { id: 77, summary: "Login" };
      },
    });

    const client = new KiwiClient({ ...AUTH, project: "Core" });
    await client.cases.create({
      summary: "Login",
      text: "## Подготовка\nApp is open.\n\n## Шаги\n1. Click Add\n\n## Ожидаемый результат\nItem appears",
    });

    const payload = (createdCalls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload.text).toBe(
      "## Подготовка\nApp is open.\n\n## Шаги\n1. Click Add\n\n## Ожидаемый результат\nItem appears",
    );
  });

  it("writes script, arguments, and requirement as plain fields", async () => {
    const createdCalls: unknown[] = [];
    rpcByMethod({
      ...catalogs,
      "TestCase.create": (params) => {
        createdCalls.push(params);
        return { id: 79 };
      },
    });

    const client = new KiwiClient({ ...AUTH, project: "Core" });
    await client.cases.create({
      summary: "Login",
      script: "tests/login.spec.ts",
      arguments: "--project=chromium",
      requirement: "docs/requirements/auth.md",
    });

    const payload = (createdCalls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload.script).toBe("tests/login.spec.ts");
    expect(payload.arguments).toBe("--project=chromium");
    expect(payload.requirement).toBe("docs/requirements/auth.md");
  });

  it("omits text from the payload when not given", async () => {
    const createdCalls: unknown[] = [];
    rpcByMethod({
      ...catalogs,
      "TestCase.create": (params) => {
        createdCalls.push(params);
        return { id: 78 };
      },
    });

    const client = new KiwiClient({ ...AUTH, project: "Core" });
    await client.cases.create({ summary: "Login" });

    const payload = (createdCalls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload.text).toBeUndefined();
  });
});

describe("KiwiClient.cases.update", () => {
  it("writes text into TestCase.text verbatim, with no merge against the current text", async () => {
    const updateCalls: unknown[] = [];
    rpcByMethod({
      "TestCase.update": (params) => {
        updateCalls.push(params);
        return { id: 7 };
      },
    });

    const client = new KiwiClient(AUTH);
    await client.cases.update({
      id: 7,
      text: "## Ожидаемый результат\nA blank task is added.",
    });

    expect(updateCalls[0]).toEqual([7, { text: "## Ожидаемый результат\nA blank task is added." }]);
  });

  it("writes requirement on update without touching text", async () => {
    const updateCalls: unknown[] = [];
    rpcByMethod({
      "TestCase.update": (params) => {
        updateCalls.push(params);
        return { id: 7 };
      },
    });

    const client = new KiwiClient(AUTH);
    await client.cases.update({ id: 7, requirement: "docs/requirements/auth.md" });

    expect(updateCalls[0]).toEqual([7, { requirement: "docs/requirements/auth.md" }]);
  });
});

describe("KiwiClient.cases.get", () => {
  it("returns text raw, without deriving setup/actions/expected from it", async () => {
    rpcByMethod({
      "TestCase.filter": () => [
        {
          id: 7,
          summary: "Пустое имя",
          text: "## Подготовка\nПриложение открыто.\n\n## Шаги\n1. Нажать «Добавить»\n\n## Ожидаемый результат\nДобавлена пустая задача.",
        },
      ],
    });

    const client = new KiwiClient(AUTH);
    const result = await client.cases.get({ id: 7 });
    const card = result.case as Record<string, unknown>;

    expect(card.text).toBe(
      "## Подготовка\nПриложение открыто.\n\n## Шаги\n1. Нажать «Добавить»\n\n## Ожидаемый результат\nДобавлена пустая задача.",
    );
    expect(card.setup).toBeUndefined();
    expect(card.actions).toBeUndefined();
    expect(card.expected).toBeUndefined();
  });
});
