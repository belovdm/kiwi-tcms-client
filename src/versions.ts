import type { KiwiRpcClient } from "./client.js";
import type { ListLimit, PageResult } from "./types.js";

export interface ListVersionsParams extends ListLimit {
  product?: string;
  query?: string;
}

export interface CreateVersionInput {
  value: string;
  product?: string;
}

export async function listVersions(
  rpc: KiwiRpcClient,
  params: ListVersionsParams = {}
): Promise<PageResult> {
  const q: Record<string, unknown> = {};
  if (params.product) q.product = await rpc.resolveProductId(params.product);
  else if (rpc.project) q.product = await rpc.projectProductId();
  if (params.query) q.value__icontains = params.query;
  const rows = await rpc.call<unknown[]>("Version.filter", [q]);
  return rpc.page(rows, params.limit ?? (rows?.length || 1));
}

export async function createVersion(rpc: KiwiRpcClient, input: CreateVersionInput): Promise<unknown> {
  const product = input.product
    ? await rpc.resolveProductId(input.product)
    : await rpc.projectProductId();
  return rpc.call("Version.create", [{ value: input.value, product }]);
}
