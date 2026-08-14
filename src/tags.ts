import type { KiwiRpcClient } from "./client.js";
import type { ListLimit, PageResult } from "./types.js";

export interface ListTagsParams extends ListLimit {
  query?: string;
}

export async function listTags(
  rpc: KiwiRpcClient,
  params: ListTagsParams = {},
): Promise<PageResult> {
  const q: Record<string, unknown> = {};
  if (params.query) q.name__icontains = params.query;
  const rows = await rpc.call<unknown[]>("Tag.filter", [q]);
  return rpc.page(rows, params.limit ?? (rows?.length || 1));
}

export async function createTag(rpc: KiwiRpcClient, name: string): Promise<unknown> {
  return rpc.call("Tag.create", [{ name }]);
}
