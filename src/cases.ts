import type { KiwiRpcClient } from "./client.js";
import {
  addObjectAttachment,
  listObjectAttachments,
  type AddAttachmentInput,
} from "./attachments.js";
import { extractId, firstId } from "./ids.js";
import { caseStatusIdByName, categoryIdByName, priorityIdByName } from "./resolvers.js";
import type { ListLimit, PageResult } from "./types.js";

export interface SearchCasesParams extends ListLimit {
  query?: string;
  plan?: number;
  product?: string;
  status?: string;
  priority?: string;
  category?: string;
  component?: string;
  tag?: string;
  automated?: boolean;
  ids?: string;
}

export interface GetCaseParams {
  id: number;
  include_executions?: boolean;
}

export interface CreateCaseInput {
  summary: string;
  plan?: number;
  product?: string;
  category?: string;
  priority?: string;
  status_id?: number;
  automated?: boolean;
  setup?: string;
  actions?: string;
  expected?: string;
  breakdown?: string;
  notes?: string;
  script?: string;
  arguments?: string;
  tags?: string;
}

export interface UpdateCaseInput {
  id: number;
  summary?: string;
  status?: string;
  status_id?: number;
  priority?: string;
  category?: string;
  automated?: boolean;
  setup?: string;
  actions?: string;
  expected?: string;
  breakdown?: string;
  notes?: string;
  script?: string;
  arguments?: string;
}

export async function searchCases(
  rpc: KiwiRpcClient,
  params: SearchCasesParams = {},
): Promise<PageResult> {
  const q: Record<string, unknown> = {};
  if (params.query) q.summary__icontains = params.query;
  if (params.plan) q.plan = params.plan;
  if (params.product) q.product = await rpc.resolveProductId(params.product);
  else if (!params.plan && rpc.project) q.product = await rpc.projectProductId();
  if (params.status) q.status__name = params.status;
  if (params.priority) q.priority__value = params.priority;
  if (params.category) q.category__name = params.category;
  if (params.component) q.component__name = params.component;
  if (params.tag) q.tag__name = params.tag;
  if (params.automated !== undefined) q.is_automated = params.automated;
  if (params.ids) {
    const list = params.ids
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n));
    if (list.length) q.id__in = list;
  }
  const rows = await rpc.call<unknown[]>("TestCase.filter", [q]);
  return rpc.page(rows, params.limit ?? (rows?.length || 1));
}

export async function getCase(
  rpc: KiwiRpcClient,
  params: GetCaseParams,
): Promise<{ case: unknown; executions?: PageResult }> {
  const rows = await rpc.call<unknown[]>("TestCase.filter", [{ id: params.id }]);
  const testCase = rows?.[0];
  if (!testCase) throw new Error(`Тест-кейс ${params.id} не найден`);
  const out: { case: unknown; executions?: PageResult } = { case: testCase };
  if (params.include_executions) {
    const execs = await rpc.call<unknown[]>("TestExecution.filter", [{ case: params.id }]);
    out.executions = rpc.page(execs, 50);
  }
  return out;
}

export async function createCase(
  rpc: KiwiRpcClient,
  input: CreateCaseInput,
): Promise<{ created: unknown; actions: string[] }> {
  const pid = input.product
    ? await rpc.resolveProductId(input.product)
    : await rpc.projectProductId();

  let categoryId: number;
  if (input.category) {
    categoryId = await categoryIdByName(rpc, input.category, pid);
  } else {
    const cats = await rpc.call<unknown[]>("Category.filter", [{ product: pid }]);
    const first = firstId(cats);
    if (first === undefined)
      throw new Error(`В продукте ${pid} нет категорий — создайте категорию в Kiwi TCMS`);
    categoryId = first;
  }

  const priorityId = input.priority
    ? await priorityIdByName(rpc, input.priority)
    : await priorityIdByName(rpc, "Medium").catch(async () => {
        const r = await rpc.call<unknown[]>("Priority.filter", [{}]);
        const id = firstId(r);
        if (id === undefined) throw new Error("В Kiwi TCMS нет приоритетов");
        return id;
      });

  const values: Record<string, unknown> = {
    summary: input.summary,
    product: pid,
    category: categoryId,
    priority: priorityId,
    case_status: input.status_id ?? (await caseStatusIdByName(rpc, "CONFIRMED")),
  };
  if (input.automated !== undefined) values.is_automated = input.automated;
  if (input.setup) values.setup = input.setup;
  if (input.actions) values.actions = input.actions;
  if (input.expected) values.expected_results = input.expected;
  if (input.breakdown) values.breakdown = input.breakdown;
  if (input.notes) values.notes = input.notes;
  if (input.script) values.script = input.script;
  if (input.arguments) values.arguments = input.arguments;

  const created = (await rpc.call<{ id?: number }>("TestCase.create", [values])) as { id?: number };
  const newId = extractId(created?.id);
  const attached: string[] = [];

  if (input.plan && newId) {
    await rpc.call("TestPlan.add_case", [input.plan, newId]);
    attached.push(`привязан к плану ${input.plan}`);
  }
  if (input.tags && newId) {
    for (const tag of input.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)) {
      await rpc.call("TestCase.add_tag", [newId, tag]);
      attached.push(`тег: ${tag}`);
    }
  }
  return { created, actions: attached };
}

export async function updateCase(rpc: KiwiRpcClient, input: UpdateCaseInput): Promise<unknown> {
  const values: Record<string, unknown> = {};
  if (input.summary !== undefined) values.summary = input.summary;
  if (input.automated !== undefined) values.is_automated = input.automated;
  if (input.setup !== undefined) values.setup = input.setup;
  if (input.actions !== undefined) values.actions = input.actions;
  if (input.expected !== undefined) values.expected_results = input.expected;
  if (input.breakdown !== undefined) values.breakdown = input.breakdown;
  if (input.notes !== undefined) values.notes = input.notes;
  if (input.script !== undefined) values.script = input.script;
  if (input.arguments !== undefined) values.arguments = input.arguments;

  if (input.status_id) values.case_status = input.status_id;
  else if (input.status) values.case_status = await caseStatusIdByName(rpc, input.status);
  if (input.priority) values.priority = await priorityIdByName(rpc, input.priority);
  if (input.category) {
    const pid = rpc.project ? await rpc.projectProductId() : undefined;
    if (pid === undefined && !/^\d+$/.test(String(input.category)))
      throw new Error("Для категории по имени нужен KIWI_PROJECT или передайте id категории");
    values.category = await categoryIdByName(rpc, input.category, pid ?? 0);
  }

  if (Object.keys(values).length === 0)
    throw new Error("Не передано ни одного поля для обновления");

  return rpc.call("TestCase.update", [input.id, values]);
}

export async function addCaseComment(
  rpc: KiwiRpcClient,
  id: number,
  comment: string,
): Promise<unknown> {
  return rpc.call("TestCase.add_comment", [id, comment]);
}

export async function getCaseHistory(
  rpc: KiwiRpcClient,
  id: number,
  params: ListLimit = {},
): Promise<PageResult> {
  const rows = await rpc.call<unknown[]>("TestCase.history", [id]);
  return rpc.page(rows, params.limit ?? (rows?.length || 1));
}

export async function addCaseTag(
  rpc: KiwiRpcClient,
  caseId: number,
  tag: string,
): Promise<unknown> {
  return rpc.call("TestCase.add_tag", [caseId, tag]);
}

export async function removeCaseTag(
  rpc: KiwiRpcClient,
  caseId: number,
  tag: string,
): Promise<unknown> {
  return rpc.call("TestCase.remove_tag", [caseId, tag]);
}

export async function addCaseComponent(
  rpc: KiwiRpcClient,
  caseId: number,
  component: string,
): Promise<unknown> {
  return rpc.call("TestCase.add_component", [caseId, component]);
}

export async function removeCaseComponent(
  rpc: KiwiRpcClient,
  caseId: number,
  componentId: number,
): Promise<unknown> {
  return rpc.call("TestCase.remove_component", [caseId, componentId]);
}

export async function listCaseAttachments(rpc: KiwiRpcClient, caseId: number): Promise<unknown[]> {
  return listObjectAttachments(rpc, "TestCase.list_attachments", caseId);
}

export async function addCaseAttachment(
  rpc: KiwiRpcClient,
  caseId: number,
  input: AddAttachmentInput,
): Promise<unknown> {
  return addObjectAttachment(rpc, "TestCase.add_attachment", caseId, input);
}

export async function listCaseProperties(rpc: KiwiRpcClient, caseId?: number): Promise<unknown[]> {
  const q: Record<string, unknown> = {};
  if (caseId !== undefined) q.case = caseId;
  const rows = await rpc.call<unknown[]>("TestCase.properties", [q]);
  return rows ?? [];
}

export async function addCaseProperty(
  rpc: KiwiRpcClient,
  caseId: number,
  name: string,
  value: string,
): Promise<unknown> {
  return rpc.call("TestCase.add_property", [caseId, name, value]);
}

export async function removeCaseProperty(
  rpc: KiwiRpcClient,
  query: Record<string, unknown>,
): Promise<unknown> {
  return rpc.call("TestCase.remove_property", [query]);
}
