import type { KiwiRpcClient } from "./client.js";
import type { ListLimit, PageResult } from "./types.js";

export interface ListClassificationsParams extends ListLimit {
  query?: string;
}

export async function listClassifications(
  rpc: KiwiRpcClient,
  params: ListClassificationsParams = {}
): Promise<PageResult> {
  const q: Record<string, unknown> = {};
  if (params.query) q.name__icontains = params.query;
  const rows = await rpc.call<unknown[]>("Classification.filter", [q]);
  return rpc.page(rows, params.limit ?? (rows?.length || 1));
}

export async function createClassification(rpc: KiwiRpcClient, name: string): Promise<unknown> {
  return rpc.call("Classification.create", [{ name }]);
}
