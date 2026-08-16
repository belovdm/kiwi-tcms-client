import type { KiwiRpcClient } from "./client.js";
import {
  addObjectAttachment,
  listObjectAttachments,
  type AddAttachmentInput,
} from "./attachments.js";
import { extractId, extractName } from "./ids.js";
import { buildIdByName, userIdByName } from "./resolvers.js";
import type { ListLimit, PageResult } from "./types.js";
import { getCurrentUser } from "./users.js";

export interface ListRunsParams extends ListLimit {
  query?: string;
  plan?: number;
  build?: string;
  product?: string;
  only_active?: boolean;
}

export interface CreateRunInput {
  plan: number;
  build: string;
  summary: string;
  notes?: string;
  manager?: string;
  default_tester?: string;
}

export interface AddCasesToRunResult {
  run_id: number;
  added: number;
  results: { case_id: number; ok: boolean; error?: string }[];
}

export interface RunStatus {
  run: { id?: number; summary?: string };
  executions_total: number;
  by_status: Record<string, number>;
  failed_count: number;
  failed: unknown[];
}

export async function listRuns(
  rpc: KiwiRpcClient,
  params: ListRunsParams = {},
): Promise<PageResult> {
  const q: Record<string, unknown> = {};
  if (params.query) q.summary__icontains = params.query;
  if (params.plan) q.plan = params.plan;
  if (params.build) q.build = await buildIdByName(rpc, params.build);
  if (params.product) q.plan__product = await rpc.resolveProductId(params.product);
  else if (rpc.project) q.plan__product = await rpc.projectProductId();
  if (params.only_active) q.stop_date__isnull = true;
  const rows = await rpc.call<unknown[]>("TestRun.filter", [q]);
  return rpc.page(rows, params.limit ?? (rows?.length || 1));
}

// TestRun.create rejects a build whose Version differs from the plan's
// product_version with an opaque "Select a valid choice" error. Check it
// ourselves first and say what's actually wrong.
async function assertBuildMatchesPlanVersion(
  rpc: KiwiRpcClient,
  planId: number,
  buildId: number,
): Promise<void> {
  let plan: { product_version?: number; product_version__value?: string } | undefined;
  let build: { name?: string; version?: number; version__value?: string } | undefined;
  try {
    const [planRows, buildRows] = await Promise.all([
      rpc.call<{ id?: number; product_version?: number; product_version__value?: string }[]>(
        "TestPlan.filter",
        [{ id: planId }],
      ),
      rpc.call<{ id?: number; name?: string; version?: number; version__value?: string }[]>(
        "Build.filter",
        [{ id: buildId }],
      ),
    ]);
    plan = planRows?.[0];
    build = buildRows?.[0];
  } catch {
    // Best-effort pre-check — if the lookup itself fails, let TestRun.create
    // surface the real error instead of masking it here.
    return;
  }
  if (
    plan?.product_version === undefined ||
    build?.version === undefined ||
    plan.product_version === build.version
  ) {
    return;
  }
  throw new Error(
    `Сборка "${build.name ?? buildId}" (id ${buildId}) на версии "${
      build.version__value ?? build.version
    }", а план ${planId} — на версии "${
      plan.product_version__value ?? plan.product_version
    }" (product_version). Создайте сборку на версии плана (kiwi_create_build) или укажите build с той же версией.`,
  );
}

export async function createRun(rpc: KiwiRpcClient, input: CreateRunInput): Promise<unknown> {
  const buildId = await buildIdByName(rpc, input.build);
  await assertBuildMatchesPlanVersion(rpc, input.plan, buildId);
  const managerId = input.manager
    ? await userIdByName(rpc, input.manager)
    : extractId(await getCurrentUser(rpc));
  if (managerId === undefined) {
    throw new Error(
      "Не удалось определить manager — укажите username/id или проверьте сессию (User.filter).",
    );
  }
  const values: Record<string, unknown> = {
    plan: input.plan,
    build: buildId,
    summary: input.summary,
    manager: managerId,
  };
  if (input.notes) values.notes = input.notes;
  if (input.default_tester) values.default_tester = await userIdByName(rpc, input.default_tester);
  return rpc.call("TestRun.create", [values]);
}

export async function addCasesToRun(
  rpc: KiwiRpcClient,
  runId: number,
  caseIds: string,
): Promise<AddCasesToRunResult> {
  const ids = caseIds
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n));
  if (ids.length === 0) throw new Error("Не удалось разобрать case_ids");
  const results: { case_id: number; ok: boolean; error?: string }[] = [];
  for (const cid of ids) {
    try {
      await rpc.call("TestRun.add_case", [runId, cid]);
      results.push({ case_id: cid, ok: true });
    } catch (e) {
      results.push({ case_id: cid, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { run_id: runId, added: results.filter((r) => r.ok).length, results };
}

export async function getRunStatus(rpc: KiwiRpcClient, runId: number): Promise<RunStatus> {
  const runs = await rpc.call<{ id?: number; summary?: string }[]>("TestRun.filter", [
    { id: runId },
  ]);
  const run = runs?.[0];
  if (!run) throw new Error(`Тест-ран ${runId} не найден`);

  const execs = await rpc.call<
    {
      status?: unknown;
      status_id?: unknown;
      status__name?: unknown;
      case?: unknown;
      summary?: unknown;
      assignee?: unknown;
    }[]
  >("TestExecution.filter", [{ run: runId }]);

  const byStatus: Record<string, number> = {};
  const failed: unknown[] = [];
  for (const ex of execs ?? []) {
    const name = String(
      ex.status__name ??
        extractName(ex.status) ??
        `#${extractId(ex.status_id ?? ex.status) ?? "?"}`,
    );
    byStatus[name] = (byStatus[name] ?? 0) + 1;
    const lower = name.toLowerCase();
    if (lower === "failed" || lower === "blocked" || lower === "error") failed.push(ex);
  }
  return {
    run,
    executions_total: execs?.length ?? 0,
    by_status: byStatus,
    failed_count: failed.length,
    failed,
  };
}

export interface UpdateRunInput {
  id: number;
  summary?: string;
  notes?: string;
  build?: string;
  manager?: string;
  default_tester?: string;
  start_date?: string;
  stop_date?: string;
}

export async function updateRun(rpc: KiwiRpcClient, input: UpdateRunInput): Promise<unknown> {
  const values: Record<string, unknown> = {};
  if (input.summary !== undefined) values.summary = input.summary;
  if (input.notes !== undefined) values.notes = input.notes;
  if (input.start_date !== undefined) values.start_date = input.start_date;
  if (input.stop_date !== undefined) values.stop_date = input.stop_date;
  if (input.build) values.build = await buildIdByName(rpc, input.build);
  if (input.manager) values.manager = await userIdByName(rpc, input.manager);
  if (input.default_tester) values.default_tester = await userIdByName(rpc, input.default_tester);
  if (Object.keys(values).length === 0)
    throw new Error("Не передано ни одного поля для обновления");
  return rpc.call("TestRun.update", [input.id, values]);
}

export async function getRunCases(rpc: KiwiRpcClient, runId: number): Promise<unknown[]> {
  const rows = await rpc.call<unknown[]>("TestRun.get_cases", [runId]);
  return rows ?? [];
}

export async function addRunTag(rpc: KiwiRpcClient, runId: number, tag: string): Promise<unknown> {
  return rpc.call("TestRun.add_tag", [runId, tag]);
}

export async function removeRunTag(
  rpc: KiwiRpcClient,
  runId: number,
  tag: string,
): Promise<unknown> {
  return rpc.call("TestRun.remove_tag", [runId, tag]);
}

export async function listRunAttachments(rpc: KiwiRpcClient, runId: number): Promise<unknown[]> {
  return listObjectAttachments(rpc, "TestRun.list_attachments", runId);
}

export async function addRunAttachment(
  rpc: KiwiRpcClient,
  runId: number,
  input: AddAttachmentInput,
): Promise<unknown> {
  return addObjectAttachment(rpc, "TestRun.add_attachment", runId, input);
}

export async function listRunProperties(rpc: KiwiRpcClient, runId?: number): Promise<unknown[]> {
  const q: Record<string, unknown> = {};
  if (runId !== undefined) q.run = runId;
  const rows = await rpc.call<unknown[]>("TestRun.properties", [q]);
  return rows ?? [];
}

export async function addRunProperty(
  rpc: KiwiRpcClient,
  runId: number,
  name: string,
  value: string,
): Promise<unknown> {
  return rpc.call("TestRun.add_property", [runId, name, value]);
}
