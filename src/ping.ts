import type { KiwiRpcClient } from "./client.js";

export interface PingResult {
  status: "ok";
  elapsed_ms: number;
  server: string;
  endpoint: string;
  auth: "session";
  username: string;
  project: { name: string; id: number } | null;
  products_total: number;
}

export async function ping(rpc: KiwiRpcClient): Promise<PingResult> {
  const started = Date.now();
  const products = await rpc.call<unknown[]>("Product.filter", [{}]);
  let project: { name: string; id: number } | null = null;
  if (rpc.project) {
    const id = await rpc.resolveProductId(rpc.project);
    project = { name: rpc.project, id };
  }
  return {
    status: "ok",
    elapsed_ms: Date.now() - started,
    server: rpc.baseUrl,
    endpoint: rpc.endpoint,
    auth: "session",
    username: rpc.username,
    project,
    products_total: products?.length ?? 0,
  };
}
