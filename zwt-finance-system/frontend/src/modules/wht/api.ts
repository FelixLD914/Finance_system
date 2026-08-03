import { fileNameFromResponse, saveBlobAsFile } from "../../shared/download";
import { ApiError, UnauthorizedError, apiFetch, apiRequest } from "../../shared/http";
import { demoIncomeTypes, samplePayees, sampleWhtTasks } from "./sampleData";
import type {
  BatchCommitInput,
  BatchCreateResult,
  BatchPreviewResult,
  BatchTransitionResult,
  ImportResult,
  IncomeTypeOption,
  Payee,
  PayeeDeletePreview,
  PayeeInput,
  SignatureAsset,
  SignatureUsage,
  WhtDocument,
  WhtTask,
  WhtTaskCreateInput,
  WhtTaskEvent,
  WhtTaskUpdateInput,
  WhtType,
} from "./types";

const useDemoApi = import.meta.env.VITE_USE_MOCK_API === "true";

let demoTasks = structuredClone(sampleWhtTasks);
let demoPayees = structuredClone(samplePayees);
let demoSignatures: SignatureAsset[] = [
  {
    id: "sig-001",
    name: "XINGLANHUI",
    originalFileName: "XING.png",
    mimeType: "image/png",
    sha256: "demo-sha256-xinglanhui",
    version: 1,
    status: "active",
    usage: ["wht"],
    isDefault: true,
    createdByName: "系统管理员",
    updatedByName: "系统管理员",
    createdAt: "2026-08-03T13:39:02Z",
    updatedAt: "2026-08-03T13:39:02Z",
    deletedAt: null,
    deletedByName: null,
  },
];
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
      branchType: payee.branchType,
      branchNumber: payee.branchNumber,
      incomeType: input.incomeType,
      paymentDate: input.paymentDate,
      dueDate: input.dueDate ?? null,
      whtRate: String(input.whtRate),
      totalAmount: input.totalAmount.toFixed(2),
      whtAmount: (input.totalAmount * input.whtRate).toFixed(2),
      amountTextThai: null,
      dateTextThai: null,
      sourceFileName: null,
      // 单张开具只能从主数据里选已有收款方，永远不会欠主数据一笔。
      payeePending: false,
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

export async function listPayees(deleted = false): Promise<Payee[]> {
  if (useDemoApi) {
    return clone(
      demoPayees.filter((payee) =>
        deleted ? payee.deletedAt !== null : payee.deletedAt === null,
      ),
    );
  }
  const params = new URLSearchParams({
    activeOnly: "false",
    deleted: String(deleted),
  });
  const response = await request<{ items: Payee[] }>(`/v1/wht/payees?${params}`);
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
      branchNumber: input.branchNumber ?? null,
      isActive: true,
      sourceFileName: null,
      createdByName: "系统管理员",
      updatedByName: "系统管理员",
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
      deletedByName: null,
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

export async function getPayeeDeletePreview(
  payeeId: string,
): Promise<PayeeDeletePreview> {
  if (useDemoApi) {
    const payee = demoPayees.find(
      (item) => item.id === payeeId && item.deletedAt === null,
    );
    if (!payee) throw new ApiError("payee was not found", 404);
    return {
      payeeId,
      taxId: payee.taxId,
      nameTh: payee.nameTh,
      referencingTasks: demoTasks.filter((task) => task.payeeId === payeeId).length,
    };
  }
  return request<PayeeDeletePreview>(
    `/v1/wht/payees/${payeeId}/delete-preview`,
  );
}

export async function deletePayee(payeeId: string): Promise<Payee> {
  if (useDemoApi) {
    const payee = demoPayees.find(
      (item) => item.id === payeeId && item.deletedAt === null,
    );
    if (!payee) throw new ApiError("payee was not found", 404);
    payee.deletedAt = nowIso();
    payee.deletedByName = "系统管理员";
    return clone(payee);
  }
  return request<Payee>(`/v1/wht/payees/${payeeId}`, { method: "DELETE" });
}

export async function restorePayee(payeeId: string): Promise<Payee> {
  if (useDemoApi) {
    const payee = demoPayees.find(
      (item) => item.id === payeeId && item.deletedAt !== null,
    );
    if (!payee) throw new ApiError("payee is not in the recycle bin", 409);
    const occupied = demoPayees.some(
      (item) =>
        item.id !== payeeId &&
        item.deletedAt === null &&
        item.taxId === payee.taxId,
    );
    if (occupied) {
      throw new ApiError(
        `taxId ${payee.taxId} is already used by another payee`,
        409,
      );
    }
    payee.deletedAt = null;
    payee.deletedByName = null;
    payee.updatedAt = nowIso();
    payee.updatedByName = "系统管理员";
    return clone(payee);
  }
  return request<Payee>(`/v1/wht/payees/${payeeId}/restore`, {
    method: "POST",
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

// 一步式的 POST /v1/wht/tasks/batch-create（上传即落库）在服务端仍然保留，供脚本和
// 既有集成直接调用；界面已全部改走下面的 preview → commit 两步，所以这里不再包一层。

/** 分步开票第一步：解析并配好收款方，交回前端核对。只读，不写库。 */
export async function previewBatchTasks(file: File): Promise<BatchPreviewResult> {
  if (useDemoApi) {
    const matched = demoPayees.find((payee) => payee.deletedAt === null && payee.isActive);
    const unmatchedPayee = {
      payeeId: null,
      taxId: "0105566123456",
      nameTh: null,
      nameEn: null,
      addressTh: null,
      whtType: null,
      branchType: "none" as const,
      branchNumber: null,
      isActive: false,
    };
    return {
      sourceFileName: file.name,
      rows: [
        {
          rowNumber: 2,
          status: "ready",
          period: "2026-08",
          issuanceType: "normal",
          supplementRun: 0,
          incomeType: "ค่าบริการ",
          paymentDate: "2026-08-01",
          totalAmount: "12500.00",
          payee: {
            payeeId: matched?.id ?? null,
            taxId: matched?.taxId ?? "0745554004117",
            nameTh: matched?.nameTh ?? "บริษัท เอ็น พี โอ ทรานสปอร์ต จำกัด",
            nameEn: matched?.nameEn ?? null,
            addressTh: matched?.addressTh ?? "18/3 หมู่ที่ 4 ต.คูโค้ง อ.พนัสนิคม จ.ชลบุรี",
            whtType: matched?.whtType ?? "PND53",
            branchType: matched?.branchType ?? "head_office",
            branchNumber: matched?.branchNumber ?? null,
            isActive: true,
          },
          whtRate: "0.03",
          statutoryRate: "0.03",
          whtAmount: "375.00",
          rateReason: null,
          errors: [],
        },
        {
          rowNumber: 3,
          status: "payee_missing",
          period: "2026-08",
          issuanceType: "normal",
          supplementRun: 0,
          incomeType: "ค่าบริการ",
          paymentDate: "2026-08-02",
          totalAmount: "28000.00",
          payee: unmatchedPayee,
          whtRate: null,
          statutoryRate: null,
          whtAmount: null,
          rateReason: null,
          errors: ["收款方税号未匹配主数据"],
        },
        {
          rowNumber: 4,
          status: "payee_missing",
          period: "2026-08",
          issuanceType: "normal",
          supplementRun: 0,
          incomeType: "ค่าเช่า",
          paymentDate: "2026-08-03",
          totalAmount: "9000.00",
          payee: unmatchedPayee,
          whtRate: null,
          statutoryRate: null,
          whtAmount: null,
          rateReason: null,
          errors: ["收款方税号未匹配主数据"],
        },
      ],
      ready: 1,
      payeeMissing: 2,
      needsInput: 0,
    };
  }
  const body = new FormData();
  body.append("file", file);
  return request<BatchPreviewResult>("/v1/wht/tasks/batch-preview", {
    method: "POST",
    body,
  });
}

/** 分步开票第二步：把核对（并补全）后的行落成草稿。 */
export async function commitBatchTasks(
  input: BatchCommitInput,
): Promise<BatchCreateResult> {
  if (useDemoApi) {
    return {
      sourceFileName: input.sourceFileName,
      created: input.rows.length,
      taskIds: [],
      payeesPending: input.rows.filter((row) => !row.payee.payeeId).length,
    };
  }
  return request<BatchCreateResult>("/v1/wht/tasks/batch-commit", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** 改草稿。version 是乐观锁：别人先改过就会 409，界面提示重新载入。 */
export async function updateWhtTask(
  task: WhtTask,
  input: WhtTaskUpdateInput,
): Promise<WhtTask> {
  if (useDemoApi) {
    const target = demoTasks.find((item) => item.id === task.id);
    if (!target) throw new ApiError("WHT task was not found", 404);
    // rateOverrideNote 落进服务端的事件流水，不是任务上的字段，别顺手贴到对象上。
    const { rateOverrideNote: _note, ...fields } = input;
    Object.assign(target, {
      ...fields,
      whtRate: input.whtRate === undefined ? target.whtRate : String(input.whtRate),
      totalAmount:
        input.totalAmount === undefined
          ? target.totalAmount
          : input.totalAmount.toFixed(2),
      version: target.version + 1,
      updatedAt: nowIso(),
    });
    target.whtAmount = (Number(target.totalAmount) * Number(target.whtRate)).toFixed(2);
    return clone(target);
  }
  return request<WhtTask>(`/v1/wht/tasks/${task.id}`, {
    method: "PATCH",
    body: JSON.stringify({ ...input, version: task.version }),
  });
}

/**
 * 把已批准/已开具的票据退回草稿以便更正。**票号保持不变**（业务口径 2026-08-01）：
 * 改完重新批准、重新出具，文件版本号 +1，旧版本留档。
 */
export async function reviseWhtTask(task: WhtTask, reason: string): Promise<WhtTask> {
  if (useDemoApi) {
    const target = demoTasks.find((item) => item.id === task.id);
    if (!target) throw new ApiError("WHT task was not found", 404);
    const previous = target.status;
    target.status = "draft";
    target.version += 1;
    target.updatedAt = nowIso();
    target.events.push({
      id: demoEventId++,
      eventType: "revised",
      fromStatus: previous,
      toStatus: "draft",
      actorName: "系统管理员",
      note: reason,
      createdAt: target.updatedAt,
    });
    return clone(target);
  }
  return request<WhtTask>(`/v1/wht/tasks/${task.id}/revise`, {
    method: "POST",
    body: JSON.stringify({ version: task.version, reason }),
  });
}

export async function downloadBatchTemplate(): Promise<void> {
  if (useDemoApi) return;
  const response = await apiFetch("/v1/wht/tasks/batch-template");
  saveBlobAsFile(
    await response.blob(),
    fileNameFromResponse(response, "ZWT-WHT-BatchIssue-Template.xlsx"),
  );
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
  deleted = false,
): Promise<SignatureAsset[]> {
  if (useDemoApi) {
    return clone(
      demoSignatures.filter((signature) => {
        const matchesDeleted = deleted
          ? signature.deletedAt !== null
          : signature.deletedAt === null;
        const matchesStatus =
          includeInactive || signature.status === "active" || deleted;
        const matchesUsage = !usage || signature.usage.includes(usage);
        return matchesDeleted && matchesStatus && matchesUsage;
      }),
    );
  }
  const scope = usage ? `&usage=${usage}` : "";
  return request<SignatureAsset[]>(
    `/v1/wht/signatures?includeInactive=${includeInactive ? "true" : "false"}&deleted=${deleted ? "true" : "false"}${scope}`,
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
      deletedAt: null,
      deletedByName: null,
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

export async function deleteSignature(
  signatureId: string,
): Promise<SignatureAsset> {
  if (useDemoApi) {
    const signature = demoSignatures.find(
      (item) => item.id === signatureId && item.deletedAt === null,
    );
    if (!signature) throw new ApiError("signature image was not found", 404);
    signature.deletedAt = nowIso();
    signature.deletedByName = "系统管理员";
    signature.isDefault = false;
    return clone(signature);
  }
  return request<SignatureAsset>(`/v1/wht/signatures/${signatureId}`, {
    method: "DELETE",
  });
}

export async function restoreSignature(
  signatureId: string,
): Promise<SignatureAsset> {
  if (useDemoApi) {
    const signature = demoSignatures.find(
      (item) => item.id === signatureId && item.deletedAt !== null,
    );
    if (!signature) {
      throw new ApiError("signature is not in the recycle bin", 409);
    }
    signature.deletedAt = null;
    signature.deletedByName = null;
    signature.updatedAt = nowIso();
    signature.updatedByName = "系统管理员";
    return clone(signature);
  }
  return request<SignatureAsset>(
    `/v1/wht/signatures/${signatureId}/restore`,
    { method: "POST" },
  );
}

export async function updateSignature(
  signatureId: string,
  input: Partial<Pick<SignatureAsset, "status" | "isDefault" | "usage" | "scalePercent">>,
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
  saveBlobAsFile(await response.blob(), fileNameFromResponse(response, document.fileName));
}
