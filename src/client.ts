/**
 * JSON-RPC клиент Kiwi TCMS.
 *
 * Киwi TCMS exposes /json-rpc/ endpoint (а также legacy /xml-rpc/).
 * Аутентификация — персональный API-токен в заголовке:
 *   Authorization: Token <key>
 */

import { firstId } from "./ids.js";
import type { PageResult } from "./types.js";
import * as attachmentsApi from "./attachments.js";
import * as buildsApi from "./builds.js";
import * as caseStatusesApi from "./case-statuses.js";
import * as casesApi from "./cases.js";
import * as categoriesApi from "./categories.js";
import * as classificationsApi from "./classifications.js";
import * as componentsApi from "./components.js";
import * as executionStatusesApi from "./execution-statuses.js";
import * as executionsApi from "./executions.js";
import * as pingApi from "./ping.js";
import * as planTypesApi from "./plan-types.js";
import * as plansApi from "./plans.js";
import * as prioritiesApi from "./priorities.js";
import * as projectsApi from "./projects.js";
import * as runsApi from "./runs.js";
import * as tagsApi from "./tags.js";
import * as usersApi from "./users.js";
import * as versionsApi from "./versions.js";

export interface KiwiClientConfig {
  /** Базовый URL инстанса Kiwi TCMS, например https://tcms.example.com */
  url: string;
  /** Персональный API-токен (Authorization: Token <key>) */
  token: string;
  /** Проект = Product в терминах Kiwi TCMS (имя или id). Используется как фильтр по умолчанию. */
  project?: string | null;
  /** Таймаут одного JSON-RPC запроса, мс */
  timeoutMs?: number;
}

export class KiwiRpcError extends Error {
  code: number;
  data?: unknown;

  constructor(message: string, code = -1, data?: unknown) {
    super(message);
    this.name = "KiwiRpcError";
    this.code = code;
    this.data = data;
  }
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

export class KiwiRpcClient {
  private nextId = 1;
  private productIdCache = new Map<string, number>();
  private readonly url: string;
  private readonly token: string;
  readonly project: string | null;
  private readonly timeoutMs: number;

  constructor(cfg: KiwiClientConfig) {
    this.url = cfg.url;
    this.token = cfg.token;
    this.project = cfg.project && cfg.project.trim() !== "" ? cfg.project.trim() : null;
    this.timeoutMs = cfg.timeoutMs ?? 30_000;
  }

  get baseUrl(): string {
    return this.url;
  }

  get endpoint(): string {
    return `${this.url}/json-rpc/`;
  }

  /** Произвольный вызов JSON-RPC метода Kiwi TCMS. */
  async call<T = unknown>(
    method: string,
    params: unknown[] | Record<string, unknown> = []
  ): Promise<T> {
    const payload = { jsonrpc: "2.0", id: this.nextId++, method, params };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${this.token}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if ((err as Error).name === "AbortError") {
        throw new Error(
          `Таймаут ${this.timeoutMs} мс при вызове ${method} (${this.endpoint}). ` +
            `Увеличьте KIWI_TIMEOUT или проверьте доступность сервера.`
        );
      }
      throw new Error(
        `Сетевая ошибка при обращении к ${this.url}: ${(err as Error).message}`
      );
    }
    clearTimeout(timer);

    const raw = await res.text();

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          `Аутентификация не удалась (HTTP ${res.status}). Проверьте KIWI_TOKEN: ` +
            `токен создаётся в Kiwi TCMS (меню пользователя -> API tokens).`
        );
      }
      if (res.status === 404) {
        throw new Error(
          `HTTP 404: endpoint ${this.endpoint} не найден. Проверьте KIWI_URL ` +
            `(нужен базовый URL инстанса, без пути /json-rpc/).`
        );
      }
      throw new Error(`HTTP ${res.status} при вызове ${method}: ${raw.slice(0, 300)}`);
    }

    let json: JsonRpcResponse;
    try {
      json = JSON.parse(raw) as JsonRpcResponse;
    } catch {
      throw new Error(`Ответ ${this.endpoint} не является JSON: ${raw.slice(0, 200)}`);
    }

    if (json.error) {
      throw new KiwiRpcError(
        `${method}: ${json.error.message ?? "RPC-ошибка"}`,
        json.error.code ?? -1,
        json.error.data
      );
    }
    return json.result as T;
  }

  /** Ограничить список строк и вернуть вместе с общим числом. */
  page<T>(rows: T[] | undefined, limit: number): PageResult<T> {
    const all = Array.isArray(rows) ? rows : [];
    const rowsOut = all.slice(0, Math.max(1, limit));
    return { total: all.length, shown: rowsOut.length, rows: rowsOut };
  }

  /** Product id по имени или числовому id (с кэшем). */
  async resolveProductId(nameOrId: string | number): Promise<number> {
    if (typeof nameOrId === "number" && Number.isFinite(nameOrId)) return nameOrId;
    const s = String(nameOrId).trim();
    if (/^\d+$/.test(s)) return parseInt(s, 10);

    const cached = this.productIdCache.get(s.toLowerCase());
    if (cached) return cached;

    const rows = await this.call<unknown[]>("Product.filter", [{ name: s }]);
    const id = firstId(rows);
    if (id === undefined) {
      throw new Error(`Продукт/проект "${s}" не найден (Product.filter). Проверьте KIWI_PROJECT.`);
    }
    this.productIdCache.set(s.toLowerCase(), id);
    return id;
  }

  /** id проекта по умолчанию из конфигурации. */
  async projectProductId(): Promise<number> {
    if (!this.project) {
      throw new Error(
        `KIWI_PROJECT не задан, поэтому укажите product/plan явно. ` +
          `Список проектов: инструмент kiwi_list_projects.`
      );
    }
    return this.resolveProductId(this.project);
  }
}

type BoundApiFunction<T extends (client: KiwiRpcClient, ...args: never[]) => unknown> = T extends (
  client: KiwiRpcClient,
  ...args: infer Args
) => infer Result
  ? (...args: Args) => Result
  : never;

export class KiwiClient {
  public readonly rpc: KiwiRpcClient;

  constructor(config: KiwiClientConfig | KiwiRpcClient) {
    this.rpc = config instanceof KiwiRpcClient ? config : new KiwiRpcClient(config);
  }

  get endpoint(): string {
    return this.rpc.endpoint;
  }

  call<T = unknown>(method: string, params: unknown[] | Record<string, unknown> = []): Promise<T> {
    return this.rpc.call<T>(method, params);
  }

  page<T>(rows: T[] | undefined, limit: number): PageResult<T> {
    return this.rpc.page(rows, limit);
  }

  resolveProductId(nameOrId: string | number): Promise<number> {
    return this.rpc.resolveProductId(nameOrId);
  }

  projectProductId(): Promise<number> {
    return this.rpc.projectProductId();
  }

  private bind<T extends (client: KiwiRpcClient, ...args: never[]) => unknown>(fn: T): BoundApiFunction<T> {
    return ((...args: unknown[]) => fn(this.rpc, ...(args as never[]))) as BoundApiFunction<T>;
  }

  ping(): ReturnType<typeof pingApi.ping> {
    return pingApi.ping(this.rpc);
  }

  get projects() {
    return {
      list: this.bind(projectsApi.listProjects),
      create: this.bind(projectsApi.createProject),
    };
  }

  get classifications() {
    return {
      list: this.bind(classificationsApi.listClassifications),
      create: this.bind(classificationsApi.createClassification),
    };
  }

  get versions() {
    return {
      list: this.bind(versionsApi.listVersions),
      create: this.bind(versionsApi.createVersion),
    };
  }

  get builds() {
    return {
      list: this.bind(buildsApi.listBuilds),
      create: this.bind(buildsApi.createBuild),
    };
  }

  get components() {
    return {
      list: this.bind(componentsApi.listComponents),
    };
  }

  get priorities() {
    return {
      list: this.bind(prioritiesApi.listPriorities),
    };
  }

  get categories() {
    return {
      list: this.bind(categoriesApi.listCategories),
    };
  }

  get planTypes() {
    return {
      list: this.bind(planTypesApi.listPlanTypes),
      create: this.bind(planTypesApi.createPlanType),
    };
  }

  get caseStatuses() {
    return {
      list: this.bind(caseStatusesApi.listCaseStatuses),
    };
  }

  get executionStatuses() {
    return {
      list: this.bind(executionStatusesApi.listExecutionStatuses),
    };
  }

  get users() {
    return {
      list: this.bind(usersApi.listUsers),
      me: this.bind(usersApi.getCurrentUser),
    };
  }

  get tags() {
    return {
      list: this.bind(tagsApi.listTags),
      create: this.bind(tagsApi.createTag),
    };
  }

  get attachments() {
    return {
      remove: this.bind(attachmentsApi.removeAttachment),
    };
  }

  get plans() {
    return {
      list: this.bind(plansApi.listPlans),
      create: this.bind(plansApi.createPlan),
      update: this.bind(plansApi.updatePlan),
      addCase: this.bind(plansApi.addCaseToPlan),
      removeCase: this.bind(plansApi.removeCaseFromPlan),
      tree: this.bind(plansApi.getPlanTree),
      addTag: this.bind(plansApi.addPlanTag),
      removeTag: this.bind(plansApi.removePlanTag),
      updateCaseOrder: this.bind(plansApi.updatePlanCaseOrder),
      listAttachments: this.bind(plansApi.listPlanAttachments),
      addAttachment: this.bind(plansApi.addPlanAttachment),
    };
  }

  get cases() {
    return {
      search: this.bind(casesApi.searchCases),
      get: this.bind(casesApi.getCase),
      create: this.bind(casesApi.createCase),
      update: this.bind(casesApi.updateCase),
      addComment: this.bind(casesApi.addCaseComment),
      history: this.bind(casesApi.getCaseHistory),
      addTag: this.bind(casesApi.addCaseTag),
      removeTag: this.bind(casesApi.removeCaseTag),
      addComponent: this.bind(casesApi.addCaseComponent),
      removeComponent: this.bind(casesApi.removeCaseComponent),
      listAttachments: this.bind(casesApi.listCaseAttachments),
      addAttachment: this.bind(casesApi.addCaseAttachment),
      properties: this.bind(casesApi.listCaseProperties),
      addProperty: this.bind(casesApi.addCaseProperty),
      removeProperty: this.bind(casesApi.removeCaseProperty),
    };
  }

  get runs() {
    return {
      list: this.bind(runsApi.listRuns),
      create: this.bind(runsApi.createRun),
      update: this.bind(runsApi.updateRun),
      addCases: this.bind(runsApi.addCasesToRun),
      status: this.bind(runsApi.getRunStatus),
      getCases: this.bind(runsApi.getRunCases),
      addTag: this.bind(runsApi.addRunTag),
      removeTag: this.bind(runsApi.removeRunTag),
      listAttachments: this.bind(runsApi.listRunAttachments),
      addAttachment: this.bind(runsApi.addRunAttachment),
      properties: this.bind(runsApi.listRunProperties),
      addProperty: this.bind(runsApi.addRunProperty),
    };
  }

  get executions() {
    return {
      list: this.bind(executionsApi.listExecutions),
      update: this.bind(executionsApi.updateExecution),
      addLink: this.bind(executionsApi.addExecutionLink),
      getLinks: this.bind(executionsApi.getExecutionLinks),
      removeLink: this.bind(executionsApi.removeExecutionLink),
      listAttachments: this.bind(executionsApi.listExecutionAttachments),
      addAttachment: this.bind(executionsApi.addExecutionAttachment),
      properties: this.bind(executionsApi.listExecutionProperties),
      addProperty: this.bind(executionsApi.addExecutionProperty),
    };
  }
}
