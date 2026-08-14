import type { KiwiRpcClient } from "./client.js";
import type { ListLimit, PageResult } from "./types.js";

export interface ListCaseStatusesParams extends ListLimit {
  query?: string;
}

export async function listCaseStatuses(
  rpc: KiwiRpcClient,
  params: ListCaseStatusesParams = {}
): Promise<PageResult> {
  const q: Record<string, unknown> = {};
  if (params.query) q.name__icontains = params.query;
  const rows = await rpc.call<unknown[]>("TestCaseStatus.filter", [q]);
  return rpc.page(rows, params.limit ?? (rows?.length || 1));
}
