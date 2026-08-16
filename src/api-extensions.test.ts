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
      if (!fn) {
        return HttpResponse.json({
          jsonrpc: "2.0",
          id: body.id,
          error: { message: `unexpected ${body.method}` },
        });
      }
      return HttpResponse.json({ jsonrpc: "2.0", id: body.id, result: fn(body.params) });
    }),
  );
}

describe("catalog modules", () => {
  it("lists versions for the default product and creates one", async () => {
    const created: unknown[] = [];
    rpcByMethod({
      "Product.filter": () => [{ id: 5, name: "Core" }],
      "Version.filter": () => [{ id: 1, value: "1.0" }],
      "Version.create": (params) => {
        created.push(params);
        return { id: 2, value: "2.0", product: 5 };
      },
    });

    const client = new KiwiClient({ ...AUTH, project: "Core" });
    const listed = await client.versions.list({ limit: 10 });
    expect(listed.rows).toEqual([{ id: 1, value: "1.0" }]);

    await client.versions.create({ value: "2.0" });
    expect(created[0]).toEqual([{ value: "2.0", product: 5 }]);
  });

  it("returns the current user via User.filter without a query", async () => {
    rpcByMethod({
      "User.filter": (params) => {
        if (params === undefined || (Array.isArray(params) && params.length === 0)) {
          return [{ id: 7, username: "admin" }];
        }
        return [{ id: 1, username: "alice" }];
      },
    });

    const client = new KiwiClient(AUTH);
    await expect(client.users.me()).resolves.toEqual({ id: 7, username: "admin" });
    const listed = await client.users.list({ query: "al" });
    expect(listed.rows[0]).toEqual({ id: 1, username: "alice" });
  });
});

describe("projects / builds create", () => {
  it("creates a product with a resolved classification", async () => {
    rpcByMethod({
      "Classification.filter": () => [{ id: 3, name: "Apps" }],
      "Product.create": (params) => params,
    });

    const client = new KiwiClient(AUTH);
    const created = await client.projects.create({ name: "Billing", classification: "Apps" });
    expect(created).toEqual([{ name: "Billing", classification: 3 }]);
  });

  it("lists builds scoped by version__product, not product", async () => {
    const filters: unknown[] = [];
    rpcByMethod({
      "Product.filter": () => [{ id: 5, name: "Core" }],
      "Build.filter": (params) => {
        filters.push(params);
        return [{ id: 4, name: "dev" }];
      },
    });

    const client = new KiwiClient({ ...AUTH, project: "Core" });
    const listed = await client.builds.list();
    expect(filters[0]).toEqual([{ version__product: 5 }]);
    expect(listed.rows).toEqual([{ id: 4, name: "dev" }]);
  });

  it("creates a run by resolving the build name via version__product", async () => {
    const filters: unknown[] = [];
    const created: unknown[] = [];
    rpcByMethod({
      "Product.filter": () => [{ id: 5, name: "Core" }],
      "User.filter": () => [{ id: 7, username: "admin" }],
      "Build.filter": (params) => {
        filters.push(params);
        return [{ id: 4, name: "dev" }];
      },
      "TestRun.create": (params) => {
        created.push(params);
        return params;
      },
    });

    const client = new KiwiClient({ ...AUTH, project: "Core" });
    await client.runs.create({ plan: 1, build: "dev", summary: "CI" });
    expect(filters[0]).toEqual([{ name: "dev", version__product: 5 }]);
    expect(created[0]).toEqual([{ plan: 1, build: 4, summary: "CI", manager: 7 }]);
  });

  it("uses an explicit manager name instead of the session user", async () => {
    const created: unknown[] = [];
    rpcByMethod({
      "Product.filter": () => [{ id: 5, name: "Core" }],
      "Build.filter": () => [{ id: 4, name: "dev" }],
      "User.filter": (params) => {
        const q = Array.isArray(params) ? (params[0] as { username?: string }) : {};
        if (q.username === "qa") return [{ id: 11, username: "qa" }];
        return [{ id: 7, username: "admin" }];
      },
      "TestRun.create": (params) => {
        created.push(params);
        return params;
      },
    });

    const client = new KiwiClient({ ...AUTH, project: "Core" });
    await client.runs.create({ plan: 1, build: "dev", summary: "CI", manager: "qa" });
    expect(created[0]).toEqual([{ plan: 1, build: 4, summary: "CI", manager: 11 }]);
  });

  it("throws a clear error when the build's version differs from the plan's product_version", async () => {
    rpcByMethod({
      "Product.filter": () => [{ id: 5, name: "Core" }],
      "User.filter": () => [{ id: 7, username: "admin" }],
      "Build.filter": () => [{ id: 4, name: "dev", version: 2, version__value: "1.0" }],
      "TestPlan.filter": () => [
        { id: 1, product_version: 9, product_version__value: "unspecified" },
      ],
      "TestRun.create": (params) => params,
    });

    const client = new KiwiClient({ ...AUTH, project: "Core" });
    await expect(client.runs.create({ plan: 1, build: "dev", summary: "CI" })).rejects.toThrow(
      /версии "1.0".*версии "unspecified"/s,
    );
  });

  it("creates the run when the build's version matches the plan's product_version", async () => {
    const created: unknown[] = [];
    rpcByMethod({
      "Product.filter": () => [{ id: 5, name: "Core" }],
      "User.filter": () => [{ id: 7, username: "admin" }],
      "Build.filter": () => [{ id: 4, name: "dev", version: 2, version__value: "1.0" }],
      "TestPlan.filter": () => [{ id: 1, product_version: 2, product_version__value: "1.0" }],
      "TestRun.create": (params) => {
        created.push(params);
        return params;
      },
    });

    const client = new KiwiClient({ ...AUTH, project: "Core" });
    await client.runs.create({ plan: 1, build: "dev", summary: "CI" });
    expect(created[0]).toEqual([{ plan: 1, build: 4, summary: "CI", manager: 7 }]);
  });

  it("creates a build against a named version", async () => {
    rpcByMethod({
      "Product.filter": () => [{ id: 5, name: "Core" }],
      "Version.filter": () => [{ id: 9, value: "1.4" }],
      "Build.create": (params) => params,
    });

    const client = new KiwiClient({ ...AUTH, project: "Core" });
    const created = await client.builds.create({ name: "1.4.2", version: "1.4" });
    expect(created).toEqual([{ name: "1.4.2", version: 9 }]);
  });
});

describe("plans / executions / attachments", () => {
  it("resolves default Functional plan type to stock Function", async () => {
    const names: string[] = [];
    rpcByMethod({
      "Product.filter": () => [{ id: 5, name: "Core" }],
      "Version.filter": () => [{ id: 2, value: "1.0" }],
      "PlanType.filter": (params) => {
        const q = Array.isArray(params) ? (params[0] as { name?: string }) : {};
        names.push(String(q.name));
        if (q.name === "Function") return [{ id: 3, name: "Function" }];
        return [];
      },
      "TestPlan.create": (params) => params,
    });

    const client = new KiwiClient({ ...AUTH, project: "Core" });
    await client.plans.create({ name: "Exploratory: x" });
    expect(names).toEqual(["Functional", "Function"]);
  });

  it("updates a plan and returns its tree", async () => {
    rpcByMethod({
      "PlanType.filter": () => [{ id: 2, name: "Acceptance" }],
      "TestPlan.update": (params) => params,
      "TestPlan.tree": () => [{ id: 1 }, { id: 4 }],
    });

    const client = new KiwiClient(AUTH);
    await expect(client.plans.update({ id: 10, type: "Acceptance" })).resolves.toEqual([
      10,
      { type: 2 },
    ]);
    await expect(client.plans.tree(10)).resolves.toEqual([{ id: 1 }, { id: 4 }]);
  });

  it("adds and lists execution links", async () => {
    rpcByMethod({
      "TestExecution.add_link": (params) => params,
      "TestExecution.get_links": () => [{ id: 1, url: "https://jira/1" }],
    });

    const client = new KiwiClient(AUTH);
    const added = await client.executions.addLink({
      execution_id: 8,
      name: "JIRA-1",
      url: "https://jira/1",
      is_defect: true,
    });
    expect(added).toEqual([
      { execution: 8, name: "JIRA-1", url: "https://jira/1", is_defect: true },
      false,
    ]);
    await expect(client.executions.getLinks(8)).resolves.toEqual([
      { id: 1, url: "https://jira/1" },
    ]);
  });

  it("uploads and removes attachments", async () => {
    rpcByMethod({
      "TestCase.add_attachment": (params) => params,
      "TestCase.list_attachments": () => [{ id: 15, filename: "log.txt" }],
      "Attachment.remove_attachment": (params) => params,
    });

    const client = new KiwiClient(AUTH);
    await expect(
      client.cases.addAttachment(3, { filename: "log.txt", b64content: "ZGF0YQ==" }),
    ).resolves.toEqual([3, "log.txt", "ZGF0YQ=="]);
    await expect(client.cases.listAttachments(3)).resolves.toEqual([
      { id: 15, filename: "log.txt" },
    ]);
    await expect(client.attachments.remove(15)).resolves.toEqual([15]);
  });

  it("adds a case property", async () => {
    rpcByMethod({
      "TestCase.add_property": (params) => params,
      "TestCase.properties": () => [{ name: "browser", value: "chrome" }],
    });

    const client = new KiwiClient(AUTH);
    await expect(client.cases.addProperty(4, "browser", "chrome")).resolves.toEqual([
      4,
      "browser",
      "chrome",
    ]);
    await expect(client.cases.properties(4)).resolves.toEqual([
      { name: "browser", value: "chrome" },
    ]);
  });
});
