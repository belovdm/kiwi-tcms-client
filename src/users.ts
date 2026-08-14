import type { KiwiRpcClient } from "./client.js";
import type { ListLimit, PageResult } from "./types.js";

export interface ListUsersParams extends ListLimit {
  query?: string;
}

export async function listUsers(rpc: KiwiRpcClient, params: ListUsersParams = {}): Promise<PageResult> {
  const q: Record<string, unknown> = {};
  if (params.query) q.username__icontains = params.query;
  const rows = await rpc.call<unknown[]>("User.filter", [q]);
  return rpc.page(rows, params.limit ?? (rows?.length || 1));
}

/** Текущий залогиненный пользователь: User.filter без query. */
export async function getCurrentUser(rpc: KiwiRpcClient): Promise<unknown> {
  const rows = await rpc.call<unknown[]>("User.filter");
  return Array.isArray(rows) ? (rows[0] ?? rows) : rows;
}
