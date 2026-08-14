import type { KiwiRpcClient } from "./client.js";
import type { ListLimit, PageResult } from "./types.js";

export interface ListPlanTypesParams extends ListLimit {
  query?: string;
}

export interface CreatePlanTypeInput {
  name: string;
  description?: string;
}

export async function listPlanTypes(
  rpc: KiwiRpcClient,
  params: ListPlanTypesParams = {},
): Promise<PageResult> {
  const q: Record<string, unknown> = {};
  if (params.query) q.name__icontains = params.query;
  const rows = await rpc.call<unknown[]>("PlanType.filter", [q]);
  return rpc.page(rows, params.limit ?? (rows?.length || 1));
}

export async function createPlanType(
  rpc: KiwiRpcClient,
  input: CreatePlanTypeInput,
): Promise<unknown> {
  const values: Record<string, unknown> = { name: input.name };
  if (input.description) values.description = input.description;
  return rpc.call("PlanType.create", [values]);
}
