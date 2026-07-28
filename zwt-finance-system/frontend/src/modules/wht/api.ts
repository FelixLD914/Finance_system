import { ApiError, UnauthorizedError, apiFetch, apiRequest } from "../../shared/http";
import { demoIncomeTypes, samplePayees, sampleWhtTasks } from "./sampleData";
import type {
  BatchCreateResult,
  BatchTransitionResult,
  ImportResult,
  IncomeTypeOption,
  Payee,
  PayeeInput,
  SignatureAsset,
  SignatureUsage,
  WhtDocument,
  WhtTask,
  WhtTaskCreateInput,
  WhtTaskEvent,
  WhtType,
} from "./types";

const useDemoApi = import.meta.env.VITE_USE_MOCK_API === "true";

let demoTasks = structuredClone(sampleWhtTasks);
let demoPayees = structuredClone(samplePayees);
let demoSignatures: SignatureAsset[] = [];
let demoDocuments: WhtDocument[] = [];
let demoEventId = 1;

// ApiError 继续从本模块导出，避免改动所有既有 import。
// 实现已挪到 shared/http，那里统一处理 CSRF 头与会话凭证。
export { ApiError, UnauthorizedError };

const request = apiRequest;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function nowIso(): string {
  return new Date().toISOString();
}

function demoTaskNumber(task: WhtTask): { taskNo: string; bookNo: string } {
  const compact = task.period.replace("-", "");
  if (task.issuanceType === "supplement") {
    const prefix = `ZWT${compact}BK${task.supplementRun}`;
    const sequence =
      Math.max(
        0,
        ...demoTasks
          .map((item) => item.taskNo?.match(new RegExp(`^${prefix}(\\d{2})$`))?.[1])
          .filter(Boolean)
          .map(Number),
      ) + 1;
    return {
      taskNo: `${prefix}${String(sequence).padStart(2, "0")}`,
      bookNo: `${compact.slice(2)}BK${task.supplementRun}`,
    };
  }
  const prefix = `ZWT${compact}`;
  const sequence =
    Math.max(
      0,
      ...demoTasks
        .map((item) => item.taskNo?.match(new RegExp(`^${prefix}(\\d{1,3})$`))?.[1])
        .filter(Boolean)
        .map(Number),
    ) + 1;
  return {
    taskNo: `${prefix}${String(sequence).padStart(3, "0")}`,
    bookNo: compact,
  };
}

function demoTransition(
  taskId: string,
  action: "submit-review" | "approve" | "return-to-draft",
): WhtTask {
  const task = demoTasks.find((item) => item.id === taskId);
  if (!task) throw new ApiError("WHT task was not found", 404);
  const previous = task.status;
  if (action === "submit-review") task.status = "pending_review";
  if (action === "return-to-draft") task.status = "draft";
  if (action === "approve") {
    task.status = "approved";
    Object.assign(task, demoTaskNumber(task));
    task.approvedAt = nowIso();
  }
  task.version += 1;
  task.updatedAt = nowIso();
  task.updatedByName = "系统管理员";
  const event: WhtTaskEvent = {
    id: demoEventId++,
    eventType: action.replaceAll("-", "_"),
    fromStatus: previous,
    toStatus: task.status,
    actorName: "系统管理员",
    note: null,
    createdAt: task.updatedAt,
  };
  task.events.push(event);
  return clone(task);
}

export async function listWhtTasks(): Promise<WhtTask[]> {
  if (useDemoApi) return clone(demoTasks);
  const response = await request<{ items: WhtTask[] }>("/v1/wht/tasks?pageSize=100");
  return response.items;
}

export async function getWhtTask(taskId: string): Promise<WhtTask> {
  if (useDemoApi) {
    const task = demoTasks.find((item) => item.id === taskId);
    if (!task) throw new ApiError("WHT task was not found", 404);
    return clone(task);
  }
  return request<WhtTask>(`/v1/wht/tasks/${taskId}`);
}

export async function createWhtTask(input: WhtTaskCreateInput): Promise<WhtTask> {
  if (useDemoApi) {
    const payee = demoPayees.find((item) => item.id === input.payeeId);
    if (!payee) throw new ApiError("payee was not found", 404);
    const createdAt = nowIso();
    const task: WhtTask = {
      id: crypto.randomUUID(),
      taskNo: null,
      bookNo: null,
      period: input.period,
      issuanceType: input.issuanceType,
      supplementRun: input.supplementRun,
      status: "draft",
      payeeId: payee.id,
      companyName: payee.nameTh,
      companyNameEn: payee.nameEn,
      payeeAddress: payee.addressTh,
      taxId: payee.taxId,
      whtType: payee.whtType,
      incomeType: input.incomeType,
      paymentDate: input.paymentDate,
      dueDate: input.dueDate ?? null,
      whtRate: String(input.whtRate),
      totalAmount: input.totalAmount.toFixed(2),
      whtAmount: (input.totalAmount * input.whtRate).toFixed(2),
      amountTextThai: null,
      dateTextThai: null,
      sourceFileName: null,
      version: 1,
      createdByName: "系统管理员",
      updatedByName: "系统管理员",
      createdAt,
      updatedAt: createdAt,
      approvedAt: null,
      issuedAt: null,
      voidedAt: null,
      events: [],
    };
    demoTasks = [task, ...demoTasks];
    return clone(task);
  }
  return request<WhtTask>("/v1/wht/tasks", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function transitionWhtTask(
  task: WhtTask,
  action: "submit-review" | "approve" | "return-to-draft",
): Promise<WhtTask> {
  if (useDemoApi) return demoTransition(task.id, action);
  return request<WhtTask>(`/v1/wht/tasks/${task.id}/${action}`, {
    method: "POST",
    body: JSON.stringify({ version: task.version }),
  });
}

export async function listPayees(): Promise<Payee[]> {
  if (useDemoApi) return clone(demoPayees);
  const response = await request<{ items: Payee[] }>("/v1/wht/payees?activeOnly=false");
  return response.items;
}

export async function savePayee(input: PayeeInput, payeeId?: string): Promise<Payee> {
  if (useDemoApi) {
    const timestamp = nowIso();
    if (payeeId) {
      const payee = demoPayees.find((item) => item.id === payeeId);
      if (!payee) throw new ApiError("payee was not found", 404);
      Object.assign(payee, input, {
        updatedAt: timestamp,
        updatedByName: "系统管理员",
      });
      return clone(payee);
    }
    const payee: Payee = {
      ...input,
      id: crypto.randomUUID(),
      nameEn: input.nameEn ?? null,
      isActive: true,
      sourceFileName: null,
      createdByName: "系统管理员",
      updatedByName: "系统管理员",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    demoPayees = [payee, ...demoPayees];
    return clone(payee);
  }
  const endpoint = payeeId ? `/v1/wht/payees/${payeeId}` : "/v1/wht/payees";
  return request<Payee>(endpoint, {
    method: payeeId ? "PATCH" : "POST",
    body: JSON.stringify(input),
  });
}

export async function importPayees(file: File): Promise<ImportResult> {
  if (useDemoApi) {
    return {
      sourceFileName: file.name,
      created: 0,
      updated: demoPayees.length,
      skipped: 0,
      errors: [],
    };
  }
  const body = new FormData();
  body.append("file", file);
  return request<ImportResult>("/v1/wht/payees/import", { method: "POST", body });
}

export async function importHistoricalTasks(file: File): Promise<ImportResult> {
  if (useDemoApi) {
    return {
      sourceFileName: file.name,
      created: 0,
      updated: 0,
      skipped: demoTasks.length,
      errors: [],
    };
  }
  const body = new FormData();
  body.append("file", file);
  return request<ImportResult>("/v1/wht/tasks/import", { method: "POST", body });
}

export async function listIncomeTypes(whtType?: WhtType): Promise<IncomeTypeOption[]> {
  if (useDemoApi) return demoIncomeTypes;
  const query = whtType ? `?whtType=${whtType}` : "";
  return request<IncomeTypeOption[]>(`/v1/wht/income-types${query}`);
}

/** 批量开具：一张表建多条草稿。与 importHistoricalTasks 不同，这里不带正式编号。 */
export async function batchCreateTasks(file: File): Promise<BatchCreateResult> {
  if (useDemoApi) {
    return { sourceFileName: file.name, created: 0, taskIds: [] };
  }
  const body = new FormData();
  body.append("file", file);
  return request<BatchCreateResult>("/v1/wht/tasks/batch-create", {
    method: "POST",
    body,
  });
}

export async function downloadBatchTemplate(): Promise<void> {
  if (useDemoApi) return;
  const response = await apiFetch("/v1/wht/tasks/batch-template");
  const url = URL.createObjectURL(await response.blob());
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = "ZWT-WHT-BatchIssue-Template.xlsx";
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function batchTransitionTasks(
  action: "submit-review" | "approve" | "return-to-draft",
  tasks: WhtTask[],
): Promise<BatchTransitionResult> {
  if (useDemoApi) {
    const items = tasks.map((task) => {
      const updated = demoTransition(task.id, action);
      return {
        taskId: task.id,
        succeeded: true,
        taskNo: updated.taskNo,
        error: null,
      };
    });
    return { action, succeeded: items.length, failed: 0, items };
  }
  return request<BatchTransitionResult>("/v1/wht/tasks/batch-transition", {
    method: "POST",
    body: JSON.stringify({
      action,
      items: tasks.map((task) => ({ taskId: task.id, version: task.version })),
    }),
  });
}

export async function listSignatures(
  includeInactive = true,
  usage?: SignatureUsage,
): Promise<SignatureAsset[]> {
  if (useDemoApi) return clone(demoSignatures);
  const scope = usage ? `&usage=${usage}` : "";
  return request<SignatureAsset[]>(
    `/v1/wht/signatures?includeInactive=${includeInactive ? "true" : "false"}${scope}`,
  );
}

export async function uploadSignature(
  name: string,
  file: File,
  makeDefault: boolean,
  usage: SignatureUsage[] = ["wht"],
): Promise<SignatureAsset> {
  if (useDemoApi) {
    const timestamp = nowIso();
    if (makeDefault) {
      demoSignatures = demoSignatures.map((signature) => ({
        ...signature,
        isDefault: false,
      }));
    }
    const signature: SignatureAsset = {
      id: crypto.randomUUID(),
      name,
      originalFileName: file.name,
      mimeType: file.type || "image/png",
      sha256: "demo",
      version: 1,
      status: "active",
      usage,
      isDefault: makeDefault,
      createdByName: "系统管理员",
      updatedByName: "系统管理员",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    demoSignatures = [signature, ...demoSignatures];
    return clone(signature);
  }
  const body = new FormData();
  body.append("name", name);
  body.append("makeDefault", String(makeDefault));
  // 适用范围是集合：重复同名字段，后端按数组接收。
  for (const module of usage) body.append("usage", module);
  body.append("file", file);
  return request<SignatureAsset>("/v1/wht/signatures", {
    method: "POST",
    body,
  });
}

export async function updateSignature(
  signatureId: string,
  input: Partial<Pick<SignatureAsset, "status" | "isDefault" | "usage">>,
): Promise<SignatureAsset> {
  if (useDemoApi) {
    if (input.isDefault) {
      demoSignatures = demoSignatures.map((signature) => ({
        ...signature,
        isDefault: false,
      }));
    }
    const signature = demoSignatures.find((item) => item.id === signatureId);
    if (!signature) throw new ApiError("signature image was not found", 404);
    Object.assign(signature, input, { updatedAt: nowIso() });
    return clone(signature);
  }
  return request<SignatureAsset>(`/v1/wht/signatures/${signatureId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function listWhtDocuments(taskId: string): Promise<WhtDocument[]> {
  if (useDemoApi) {
    return clone(demoDocuments.filter((document) => document.taskId === taskId));
  }
  return request<WhtDocument[]>(`/v1/wht/tasks/${taskId}/documents`);
}

export async function generateWhtDocuments(
  taskId: string,
  input: {
    signatureId: string | null;
    includeSignature: boolean;
    formats: Array<"xlsx" | "pdf">;
  },
): Promise<WhtDocument[]> {
  if (useDemoApi) {
    const timestamp = nowIso();
    const created = input.formats.map<WhtDocument>((fileFormat) => ({
      id: crypto.randomUUID(),
      taskId,
      signatureId: input.includeSignature ? input.signatureId : null,
      fileFormat,
      version: 1,
      fileName: `WHT-demo.${fileFormat}`,
      sha256: "demo",
      templateSha256: "demo",
      createdByName: "系统管理员",
      createdAt: timestamp,
    }));
    demoDocuments = [...created, ...demoDocuments];
    return clone(created);
  }
  return request<WhtDocument[]>(`/v1/wht/tasks/${taskId}/generate-documents`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function downloadWhtDocument(document: WhtDocument): Promise<void> {
  if (useDemoApi) return;
  // 走 apiFetch：下载同样要带会话 Cookie，否则受保护的端点会 401。
  const response = await apiFetch(`/v1/wht/documents/${document.id}/download`);
  const url = URL.createObjectURL(await response.blob());
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = document.fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
