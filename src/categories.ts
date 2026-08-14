import type { KiwiRpcClient } from "./client.js";
import type { ListLimit, PageResult } from "./types.js";

export interface ListCategoriesParams extends ListLimit {
  product?: string;
}

export async function listCategories(
  rpc: KiwiRpcClient,
  params: ListCategoriesParams = {},
): Promise<PageResult> {
  const pid = params.product
    ? await rpc.resolveProductId(params.product)
    : await rpc.projectProductId();
  const rows = await rpc.call<unknown[]>("Category.filter", [{ product: pid }]);
  return rpc.page(rows, params.limit ?? (rows?.length || 1));
}
