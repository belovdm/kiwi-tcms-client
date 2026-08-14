import type { KiwiRpcClient } from "./client.js";
import { firstId } from "./ids.js";
import { classificationIdByName } from "./resolvers.js";
import type { ListLimit, PageResult } from "./types.js";

export interface ListProjectsParams extends ListLimit {
  query?: string;
}

export async function listProjects(
  rpc: KiwiRpcClient,
  params: ListProjectsParams = {}
): Promise<PageResult> {
  const q: Record<string, unknown> = params.query ? { name__icontains: params.query } : {};
  const rows = await rpc.call<unknown[]>("Product.filter", [q]);
  return rpc.page(rows, params.limit ?? (rows?.length || 1));
}

export interface CreateProjectInput {
  name: string;
  classification?: string;
  description?: string;
}

export async function createProject(rpc: KiwiRpcClient, input: CreateProjectInput): Promise<unknown> {
  let classification: number;
  if (input.classification) {
    classification = await classificationIdByName(rpc, input.classification);
  } else {
    const rows = await rpc.call<unknown[]>("Classification.filter", [{}]);
    const id = firstId(rows);
    if (id === undefined)
      throw new Error("В Kiwi нет Classification — укажите classification или создайте её в админке.");
    classification = id;
  }
  const values: Record<string, unknown> = { name: input.name, classification };
  if (input.description) values.description = input.description;
  return rpc.call("Product.create", [values]);
}
