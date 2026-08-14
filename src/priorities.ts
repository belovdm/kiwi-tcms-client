import type { KiwiRpcClient } from "./client.js";

export async function listPriorities(rpc: KiwiRpcClient): Promise<unknown[]> {
  const rows = await rpc.call<unknown[]>("Priority.filter", [{}]);
  return rows ?? [];
}
