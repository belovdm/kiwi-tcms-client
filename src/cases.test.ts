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
  it("writes setup/actions/expected into TestCase.text so Kiwi 16 stores the steps", async () => {
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
      setup: "App is open.",
      actions: "1. Click Add",
      expected: "Item appears",
    });

    const payload = (createdCalls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload.text).toBe(
      "## Setup\nApp is open.\n\n## Steps\n1. Click Add\n\n## Expected\nItem appears",
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

  it("uses an explicit text field instead of composing sections", async () => {
    const createdCalls: unknown[] = [];
    rpcByMethod({
      ...catalogs,
      "TestCase.create": (params) => {
        createdCalls.push(params);
        return { id: 78 };
      },
    });

    const client = new KiwiClient({ ...AUTH, project: "Core" });
    await client.cases.create({
      summary: "Login",
      setup: "ignored when text is set",
      text: "## Expected\nAlready markdown",
    });

    const payload = (createdCalls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload.text).toBe("## Expected\nAlready markdown");
  });
});

describe("KiwiClient.cases.update", () => {
  it("writes setup/actions/expected into TestCase.text", async () => {
    const updateCalls: unknown[] = [];
    rpcByMethod({
      "TestCase.update": (params) => {
        updateCalls.push(params);
        return { id: 7, text: "" };
      },
    });

    const client = new KiwiClient(AUTH);
    await client.cases.update({
      id: 7,
      setup: "Seed Eat, Sleep, Repeat.",
      actions: "1. Click Add",
      expected: "A blank task is added.",
    });

    expect(updateCalls[0]).toEqual([
      7,
      {
        text: "## Setup\nSeed Eat, Sleep, Repeat.\n\n## Steps\n1. Click Add\n\n## Expected\nA blank task is added.",
      },
    ]);
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

  it("merges a partial body update with the current text so other sections stay", async () => {
    const updateCalls: unknown[] = [];
    rpcByMethod({
      "TestCase.filter": () => [
        {
          id: 7,
          text: "## Setup\nApp is open.\n\n## Steps\n1. Click Add\n\n## Expected\nOld",
        },
      ],
      "TestCase.update": (params) => {
        updateCalls.push(params);
        return { id: 7 };
      },
    });

    const client = new KiwiClient(AUTH);
    await client.cases.update({ id: 7, expected: "New result" });

    expect(updateCalls[0]).toEqual([
      7,
      {
        text: "## Setup\nApp is open.\n\n## Steps\n1. Click Add\n\n## Expected\nNew result",
      },
    ]);
  });
});

describe("KiwiClient.cases.get", () => {
  it("exposes setup, actions, and expected parsed from text", async () => {
    rpcByMethod({
      "TestCase.filter": () => [
        {
          id: 7,
          summary: "Empty name",
          text: "## Setup\nApp is open.\n\n## Steps\n1. Click Add\n\n## Expected\nA blank task is added.",
        },
      ],
    });

    const client = new KiwiClient(AUTH);
    const result = await client.cases.get({ id: 7 });
    const card = result.case as Record<string, unknown>;

    expect(card.setup).toBe("App is open.");
    expect(card.actions).toBe("1. Click Add");
    expect(card.expected).toBe("A blank task is added.");
  });
});
