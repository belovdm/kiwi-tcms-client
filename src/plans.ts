import type { KiwiRpcClient } from "./client.js";
import { firstId } from "./ids.js";
import { planTypeIdByName, versionIdByName } from "./resolvers.js";
import {
  addObjectAttachment,
  listObjectAttachments,
  type AddAttachmentInput,
} from "./attachments.js";
import type { ListLimit, PageResult } from "./types.js";

export interface ListPlansParams extends ListLimit {
  query?: string;
  product?: string;
  type?: string;
  active?: boolean;
}

export interface CreatePlanInput {
  name: string;
  product?: string;
  type?: string;
  parent?: number;
  product_version?: string;
  text?: string;
}

export interface UpdatePlanInput {
  id: number;
  name?: string;
  product?: string;
  type?: string;
  parent?: number;
  product_version?: string;
  text?: string;
  is_active?: boolean;
}

export async function listPlans(rpc: KiwiRpcClient, params: ListPlansParams = {}): Promise<PageResult> {
  const q: Record<string, unknown> = {};
  if (params.query) q.name__icontains = params.query;
  if (params.product) q.product = await rpc.resolveProductId(params.product);
  else if (rpc.project) q.product = await rpc.projectProductId();
  if (params.type) q.type = await planTypeIdByName(rpc, params.type);
  if (params.active !== undefined) q.is_active = params.active;
  const rows = await rpc.call<unknown[]>("TestPlan.filter", [q]);
  return rpc.page(rows, params.limit ?? (rows?.length || 1));
}

async function resolvePlanVersion(rpc: KiwiRpcClient, pid: number, productVersion?: string): Promise<number> {
  if (productVersion) return versionIdByName(rpc, productVersion, pid);
  const rows = await rpc.call<unknown[]>("Version.filter", [{ product: pid }]);
  const id = firstId(rows);
  if (id === undefined)
    throw new Error(`У продукта ${pid} нет Version — укажите product_version или создайте версию.`);
  return id;
}

export async function createPlan(rpc: KiwiRpcClient, input: CreatePlanInput): Promise<unknown> {
  const pid = input.product
    ? await rpc.resolveProductId(input.product)
    : await rpc.projectProductId();
  const typeId = await planTypeIdByName(rpc, input.type ?? "Functional");
  const values: Record<string, unknown> = {
    name: input.name,
    product: pid,
    type: typeId,
    product_version: await resolvePlanVersion(rpc, pid, input.product_version),
  };
  if (input.parent) values.parent = input.parent;
  if (input.text) values.text = input.text;
  return rpc.call("TestPlan.create", [values]);
}

export async function updatePlan(rpc: KiwiRpcClient, input: UpdatePlanInput): Promise<unknown> {
  const values: Record<string, unknown> = {};
  if (input.name !== undefined) values.name = input.name;
  if (input.parent !== undefined) values.parent = input.parent;
  if (input.text !== undefined) values.text = input.text;
  if (input.is_active !== undefined) values.is_active = input.is_active;
  if (input.type) values.type = await planTypeIdByName(rpc, input.type);
  const pid = input.product
    ? await rpc.resolveProductId(input.product)
    : rpc.project
      ? await rpc.projectProductId()
      : undefined;
  if (input.product) values.product = pid;
  if (input.product_version) {
    if (pid === undefined) throw new Error("Для product_version по имени нужен product или KIWI_PROJECT");
    values.product_version = await versionIdByName(rpc, input.product_version, pid);
  }
  if (Object.keys(values).length === 0) throw new Error("Не передано ни одного поля для обновления");
  return rpc.call("TestPlan.update", [input.id, values]);
}

export async function addCaseToPlan(
  rpc: KiwiRpcClient,
  planId: number,
  caseId: number
): Promise<{ ok: true; plan_id: number; case_id: number }> {
  await rpc.call("TestPlan.add_case", [planId, caseId]);
  return { ok: true, plan_id: planId, case_id: caseId };
}

export async function removeCaseFromPlan(
  rpc: KiwiRpcClient,
  planId: number,
  caseId: number
): Promise<{ ok: true; plan_id: number; case_id: number }> {
  await rpc.call("TestPlan.remove_case", [planId, caseId]);
  return { ok: true, plan_id: planId, case_id: caseId };
}

export async function getPlanTree(rpc: KiwiRpcClient, planId: number): Promise<unknown[]> {
  const rows = await rpc.call<unknown[]>("TestPlan.tree", [planId]);
  return rows ?? [];
}

export async function addPlanTag(rpc: KiwiRpcClient, planId: number, tag: string): Promise<unknown> {
  return rpc.call("TestPlan.add_tag", [planId, tag]);
}

export async function removePlanTag(rpc: KiwiRpcClient, planId: number, tag: string): Promise<unknown> {
  return rpc.call("TestPlan.remove_tag", [planId, tag]);
}

export async function updatePlanCaseOrder(
  rpc: KiwiRpcClient,
  planId: number,
  caseId: number,
  sortkey: number
): Promise<unknown> {
  return rpc.call("TestPlan.update_case_order", [planId, caseId, sortkey]);
}

export async function listPlanAttachments(rpc: KiwiRpcClient, planId: number): Promise<unknown[]> {
  return listObjectAttachments(rpc, "TestPlan.list_attachments", planId);
}

export async function addPlanAttachment(
  rpc: KiwiRpcClient,
  planId: number,
  input: AddAttachmentInput
): Promise<unknown> {
  return addObjectAttachment(rpc, "TestPlan.add_attachment", planId, input);
}
