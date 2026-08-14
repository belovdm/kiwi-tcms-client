import type { KiwiRpcClient } from "./client.js";
import { extractId, extractName, firstId } from "./ids.js";

function asNumericId(nameOrId: string | number): number | undefined {
  if (typeof nameOrId === "number") return nameOrId;
  if (/^\d+$/.test(String(nameOrId))) return Number(nameOrId);
  return undefined;
}

export async function userIdByName(
  rpc: KiwiRpcClient,
  usernameOrId: string | number,
): Promise<number> {
  const numeric = asNumericId(usernameOrId);
  if (numeric !== undefined) return numeric;
  const rows = await rpc.call<unknown[]>("User.filter", [{ username: String(usernameOrId) }]);
  const id = firstId(rows);
  if (id === undefined) throw new Error(`Пользователь "${usernameOrId}" не найден (User.filter)`);
  return id;
}

export async function buildIdByName(
  rpc: KiwiRpcClient,
  nameOrId: string | number,
  productId?: number,
): Promise<number> {
  const numeric = asNumericId(nameOrId);
  if (numeric !== undefined) return numeric;
  const q: Record<string, unknown> = { name: String(nameOrId) };
  const pid = productId ?? (rpc.project ? await rpc.projectProductId() : undefined);
  if (pid) q.product = pid;
  const rows = await rpc.call<unknown[]>("Build.filter", [q]);
  const id = firstId(rows);
  if (id === undefined)
    throw new Error(
      `Сборка "${nameOrId}" не найдена (Build.filter). Укажите build_id или создайте сборку.`,
    );
  return id;
}

export async function categoryIdByName(
  rpc: KiwiRpcClient,
  nameOrId: string | number,
  productId: number,
): Promise<number> {
  const numeric = asNumericId(nameOrId);
  if (numeric !== undefined) return numeric;
  const rows = await rpc.call<unknown[]>("Category.filter", [
    { name: String(nameOrId), product: productId },
  ]);
  const id = firstId(rows);
  if (id === undefined)
    throw new Error(`Категория "${nameOrId}" не найдена в продукте ${productId} (Category.filter)`);
  return id;
}

export async function priorityIdByName(
  rpc: KiwiRpcClient,
  nameOrId: string | number,
): Promise<number> {
  const numeric = asNumericId(nameOrId);
  if (numeric !== undefined) return numeric;
  const rows = await rpc.call<unknown[]>("Priority.filter", [{ value: String(nameOrId) }]);
  const id = firstId(rows);
  if (id === undefined)
    throw new Error(
      `Приоритет "${nameOrId}" не найден (Priority.filter). Примеры: P1..P5, Critical, Medium.`,
    );
  return id;
}

export async function planTypeIdByName(
  rpc: KiwiRpcClient,
  nameOrId: string | number,
): Promise<number> {
  const numeric = asNumericId(nameOrId);
  if (numeric !== undefined) return numeric;
  const rows = await rpc.call<unknown[]>("PlanType.filter", [{ name: String(nameOrId) }]);
  const id = firstId(rows);
  if (id === undefined) throw new Error(`Тип плана "${nameOrId}" не найден (PlanType.filter)`);
  return id;
}

export async function classificationIdByName(
  rpc: KiwiRpcClient,
  nameOrId: string | number,
): Promise<number> {
  const numeric = asNumericId(nameOrId);
  if (numeric !== undefined) return numeric;
  const rows = await rpc.call<unknown[]>("Classification.filter", [{ name: String(nameOrId) }]);
  const id = firstId(rows);
  if (id === undefined)
    throw new Error(`Классификация "${nameOrId}" не найдена (Classification.filter)`);
  return id;
}

export async function versionIdByName(
  rpc: KiwiRpcClient,
  nameOrId: string | number,
  productId?: number,
): Promise<number> {
  const numeric = asNumericId(nameOrId);
  if (numeric !== undefined) return numeric;
  const q: Record<string, unknown> = { value: String(nameOrId) };
  if (productId) q.product = productId;
  const rows = await rpc.call<unknown[]>("Version.filter", [q]);
  const id = firstId(rows);
  if (id === undefined)
    throw new Error(
      `Версия "${nameOrId}" не найдена (Version.filter). Создайте её через Version.create.`,
    );
  return id;
}

export async function caseStatusIdByName(rpc: KiwiRpcClient, name: string): Promise<number> {
  const numeric = asNumericId(name);
  if (numeric !== undefined) return numeric;
  const byName = await rpc.call<unknown[]>("TestCaseStatus.filter", [{ name }]);
  const fromCatalog = firstId(byName);
  if (fromCatalog !== undefined) return fromCatalog;

  const rows = await rpc.call<{ status?: unknown; status_id?: unknown }[]>("TestCase.filter", [
    { status__name: name },
  ]);
  const first = rows?.[0];
  const id = first ? extractId(first.status_id ?? first.status) : undefined;
  if (id === undefined)
    throw new Error(
      `Статус тест-кейса "${name}" не найден (TestCaseStatus.filter). Передайте числовой status_id.`,
    );
  return id;
}

export async function execStatusIdByName(
  rpc: KiwiRpcClient,
  name: string,
  runId?: number,
): Promise<number> {
  const numeric = asNumericId(name);
  if (numeric !== undefined) return numeric;
  const wanted = name.trim().toLowerCase();

  const catalog = await rpc.call<{ name?: unknown; value?: unknown }[]>(
    "TestExecutionStatus.filter",
    [{}],
  );
  const fromCatalog = (catalog ?? []).find((r) => {
    const n =
      extractName(r.name) ??
      extractName(r.value) ??
      (typeof r.name === "string" ? r.name : undefined);
    return typeof n === "string" && n.toLowerCase() === wanted;
  });
  const catalogId = fromCatalog ? firstId([fromCatalog]) : undefined;
  if (catalogId !== undefined) return catalogId;

  if (runId === undefined)
    throw new Error(`Статус исполнения "${name}" не найден (TestExecutionStatus.filter).`);

  const rows = await rpc.call<{ status?: unknown; status_id?: unknown; status__name?: unknown }[]>(
    "TestExecution.filter",
    [{ run: runId }],
  );
  const hit = (rows ?? []).find((r) => {
    const n = r.status__name ?? extractName(r.status);
    return typeof n === "string" && n.toLowerCase() === wanted;
  });
  const id = hit ? extractId(hit.status_id ?? hit.status) : undefined;
  if (id === undefined) {
    const available = Array.from(
      new Set((rows ?? []).map((r) => r.status__name ?? extractName(r.status)).filter(Boolean)),
    ).join(", ");
    throw new Error(
      `Статус исполнения "${name}" не найден в ране ${runId}. ` +
        (available ? `Доступные: ${available}.` : "") +
        ` Либо передайте числовой status_id.`,
    );
  }
  return id;
}
