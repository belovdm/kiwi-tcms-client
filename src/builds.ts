import type { KiwiRpcClient } from "./client.js";
import { firstId } from "./ids.js";
import { versionIdByName } from "./resolvers.js";
import type { ListLimit, PageResult } from "./types.js";

export interface ListBuildsParams extends ListLimit {
  product?: string;
  query?: string;
}

export async function listBuilds(rpc: KiwiRpcClient, params: ListBuildsParams = {}): Promise<PageResult> {
  const pid = params.product
    ? await rpc.resolveProductId(params.product)
    : await rpc.projectProductId();
  const q: Record<string, unknown> = { product: pid };
  if (params.query) q.name__icontains = params.query;
  const rows = await rpc.call<unknown[]>("Build.filter", [q]);
  return rpc.page(rows, params.limit ?? (rows?.length || 1));
}

export interface CreateBuildInput {
  name: string;
  product?: string;
  version?: string;
  is_active?: boolean;
}

export async function createBuild(rpc: KiwiRpcClient, input: CreateBuildInput): Promise<unknown> {
  const pid = input.product
    ? await rpc.resolveProductId(input.product)
    : rpc.project
      ? await rpc.projectProductId()
      : undefined;
  let versionId: number;
  if (input.version) {
    versionId = await versionIdByName(rpc, input.version, pid);
  } else {
    const q: Record<string, unknown> = {};
    if (pid) q.product = pid;
    const rows = await rpc.call<unknown[]>("Version.filter", [q]);
    const id = firstId(rows);
    if (id === undefined)
      throw new Error("Нет Version для сборки — укажите version или создайте её (Version.create).");
    versionId = id;
  }
  const values: Record<string, unknown> = { name: input.name, version: versionId };
  if (input.is_active !== undefined) values.is_active = input.is_active;
  return rpc.call("Build.create", [values]);
}
