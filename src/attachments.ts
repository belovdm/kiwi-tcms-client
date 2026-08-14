import type { KiwiRpcClient } from "./client.js";

export interface AddAttachmentInput {
  filename: string;
  /** Содержимое файла в base64 */
  b64content: string;
}

export async function addObjectAttachment(
  rpc: KiwiRpcClient,
  method: string,
  objectId: number,
  input: AddAttachmentInput
): Promise<unknown> {
  return rpc.call(method, [objectId, input.filename, input.b64content]);
}

export async function listObjectAttachments(
  rpc: KiwiRpcClient,
  method: string,
  objectId: number
): Promise<unknown[]> {
  const rows = await rpc.call<unknown[]>(method, [objectId]);
  return rows ?? [];
}

export async function removeAttachment(rpc: KiwiRpcClient, attachmentId: number): Promise<unknown> {
  return rpc.call("Attachment.remove_attachment", [attachmentId]);
}
