import type { KiwiRpcClient } from "./client.js";
import {
  addObjectAttachment,
  listObjectAttachments,
  type AddAttachmentInput,
} from "./attachments.js";
import { extractId } from "./ids.js";
import { execStatusIdByName, userIdByName } from "./resolvers.js";
import type { ListLimit, PageResult } from "./types.js";

export interface ListExecutionsParams extends ListLimit {
  run?: number;
  case?: number;
  status?: string;
  assignee?: string;
}

export interface UpdateExecutionInput {
  execution_id: number;
  status_id?: number;
  status?: string;
  build_id?: number;
  assignee?: string;
  start_date?: string;
  stop_date?: string;
  comment?: string;
}

export async function listExecutions(
  rpc: KiwiRpcClient,
  params: ListExecutionsParams = {},
): Promise<PageResult> {
  const q: Record<string, unknown> = {};
  if (params.run) q.run = params.run;
  if (params.case) q.case = params.case;
  if (params.status) q.status__name = params.status;
  if (params.assignee) q.assignee__username = params.assignee;
  const rows = await rpc.call<unknown[]>("TestExecution.filter", [q]);
  return rpc.page(rows, params.limit ?? (rows?.length || 1));
}

export async function updateExecution(
  rpc: KiwiRpcClient,
  input: UpdateExecutionInput,
): Promise<{ updated: unknown; comment: unknown }> {
  const values: Record<string, unknown> = {};

  if (input.build_id) values.build = input.build_id;
  if (input.assignee) values.assignee = await userIdByName(rpc, input.assignee);
  if (input.start_date) values.start_date = input.start_date;
  if (input.stop_date) values.stop_date = input.stop_date;

  if (input.status_id) {
    values.status = input.status_id;
  } else if (input.status) {
    const execs = await rpc.call<{ run?: unknown }[]>("TestExecution.filter", [
      { id: input.execution_id },
    ]);
    const runId = execs?.[0] ? extractId(execs[0].run) : undefined;
    if (runId === undefined) throw new Error(`Исполнение ${input.execution_id} не найдено`);
    values.status = await execStatusIdByName(rpc, input.status, runId);
  }

  let updated: unknown = null;
  if (Object.keys(values).length > 0) {
    updated = await rpc.call("TestExecution.update", [input.execution_id, values]);
  }

  let commentResult: unknown = null;
  if (input.comment) {
    commentResult = await rpc.call("TestExecution.add_comment", [
      input.execution_id,
      input.comment,
    ]);
  }

  if (updated === null && commentResult === null)
    throw new Error("Не передано ни одного поля для обновления");

  return { updated, comment: commentResult };
}

export interface AddExecutionLinkInput {
  execution_id: number;
  name: string;
  url: string;
  is_defect?: boolean;
  update_tracker?: boolean;
}

export async function addExecutionLink(
  rpc: KiwiRpcClient,
  input: AddExecutionLinkInput,
): Promise<unknown> {
  const values: Record<string, unknown> = {
    execution: input.execution_id,
    name: input.name,
    url: input.url,
  };
  if (input.is_defect !== undefined) values.is_defect = input.is_defect;
  return rpc.call("TestExecution.add_link", [values, input.update_tracker ?? false]);
}

export async function getExecutionLinks(
  rpc: KiwiRpcClient,
  executionId: number,
): Promise<unknown[]> {
  const rows = await rpc.call<unknown[]>("TestExecution.get_links", [{ execution: executionId }]);
  return rows ?? [];
}

export async function removeExecutionLink(
  rpc: KiwiRpcClient,
  query: Record<string, unknown>,
): Promise<unknown> {
  return rpc.call("TestExecution.remove_link", [query]);
}

export async function listExecutionAttachments(
  rpc: KiwiRpcClient,
  executionId: number,
): Promise<unknown[]> {
  return listObjectAttachments(rpc, "TestExecution.list_attachments", executionId);
}

export async function addExecutionAttachment(
  rpc: KiwiRpcClient,
  executionId: number,
  input: AddAttachmentInput,
): Promise<unknown> {
  return addObjectAttachment(rpc, "TestExecution.add_attachment", executionId, input);
}

export async function listExecutionProperties(
  rpc: KiwiRpcClient,
  executionId?: number,
): Promise<unknown[]> {
  const q: Record<string, unknown> = {};
  if (executionId !== undefined) q.execution = executionId;
  const rows = await rpc.call<unknown[]>("TestExecution.properties", [q]);
  return rows ?? [];
}

export async function addExecutionProperty(
  rpc: KiwiRpcClient,
  executionId: number,
  name: string,
  value: string,
): Promise<unknown> {
  return rpc.call("TestExecution.add_property", [executionId, name, value]);
}
