import { samplePayees, sampleWhtTasks } from "./sampleData";
import type {
  ImportResult,
  Payee,
  PayeeInput,
  SignatureAsset,
  WhtDocument,
  WhtTask,
  WhtTaskCreateInput,
  WhtTaskEvent,
} from "./types";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "/api";
const useDemoApi = import.meta.env.VITE_USE_MOCK_API === "true";

let demoTasks = structuredClone(sampleWhtTasks);
let demoPayees = structuredClone(samplePayees);
let demoSignatures: SignatureAsset[] = [];
let demoDocuments: WhtDocument[] = [];
let demoEventId = 1;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new ApiError(body?.detail ?? `API request failed (${response.status})`, response.status);
  }
  return (await response.json()) as T;
}

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
      documentCount: input.documentCount,
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

export async function listSignatures(includeInactive = true): Promise<SignatureAsset[]> {
  if (useDemoApi) return clone(demoSignatures);
  return request<SignatureAsset[]>(
    `/v1/wht/signatures?includeInactive=${includeInactive ? "true" : "false"}`,
  );
}

export async function uploadSignature(
  name: string,
  file: File,
  makeDefault: boolean,
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
  body.append("file", file);
  return request<SignatureAsset>("/v1/wht/signatures", {
    method: "POST",
    body,
  });
}

export async function updateSignature(
  signatureId: string,
  input: Partial<Pick<SignatureAsset, "status" | "isDefault">>,
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
  const response = await fetch(`${apiBase}/v1/wht/documents/${document.id}/download`);
  if (!response.ok) throw new ApiError(`Download failed (${response.status})`, response.status);
  const url = URL.createObjectURL(await response.blob());
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = document.fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
