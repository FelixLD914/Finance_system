import { fileNameFromResponse, saveBlobAsFile } from "../../shared/download";
import { apiFetch, apiRequest } from "../../shared/http";
import type {
  EmployeeDeletePreview,
  EmployeeImportResult,
  EmployeeInput,
  SalaryAdvanceBatch,
  SalaryAdvanceBatchDetail,
  SalaryAdvanceEmployee,
  SalaryAdvanceJob,
  SalaryAdvanceJobDetail,
  SalaryAdvanceRecord,
  SingleSalaryAdvanceInput,
} from "./types";

const request = apiRequest;

export function createSingleSalaryAdvanceRecord(
  payload: SingleSalaryAdvanceInput,
): Promise<SalaryAdvanceBatchDetail> {
  return request<SalaryAdvanceBatchDetail>("/v1/salary-advance/single-records", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listSalaryAdvanceBatches(
  period?: string,
  status?: string,
): Promise<SalaryAdvanceBatch[]> {
  const query = new URLSearchParams();
  if (period) query.set("period", period);
  if (status) query.set("status", status);
  const suffix = query.size ? `?${query.toString()}` : "";
  return request<SalaryAdvanceBatch[]>(`/v1/salary-advance/batches${suffix}`);
}

export function getSalaryAdvanceBatch(
  batchId: string,
): Promise<SalaryAdvanceBatchDetail> {
  return request<SalaryAdvanceBatchDetail>(
    `/v1/salary-advance/batches/${batchId}`,
  );
}

export function importSalaryAdvanceBatch(
  period: string,
  file: File,
): Promise<SalaryAdvanceBatchDetail> {
  const form = new FormData();
  form.append("period", period);
  form.append("file", file);
  return request<SalaryAdvanceBatchDetail>("/v1/salary-advance/batches/import", {
    method: "POST",
    body: form,
  });
}

export function updateSalaryAdvanceRecord(
  recordId: string,
  version: number,
  values: Record<string, unknown>,
): Promise<SalaryAdvanceRecord> {
  return request<SalaryAdvanceRecord>(
    `/v1/salary-advance/records/${recordId}`,
    {
      method: "PATCH",
      body: JSON.stringify({ version, values }),
    },
  );
}

export function revalidateSalaryAdvanceBatch(
  batchId: string,
): Promise<SalaryAdvanceBatchDetail> {
  return request<SalaryAdvanceBatchDetail>(
    `/v1/salary-advance/batches/${batchId}/revalidate`,
    { method: "POST" },
  );
}

export function deleteSalaryAdvanceBatch(batchId: string): Promise<void> {
  return request<void>(`/v1/salary-advance/batches/${batchId}`, {
    method: "DELETE",
  });
}

export function lockSalaryAdvanceBatch(
  batchId: string,
): Promise<SalaryAdvanceBatch> {
  return request<SalaryAdvanceBatch>(
    `/v1/salary-advance/batches/${batchId}/lock`,
    {
      method: "POST",
      body: JSON.stringify({ note: "工资预支批次复核通过" }),
    },
  );
}

export function createSalaryAdvanceJob(
  batchId: string,
  signatures?: {
    financeSignatureId?: string;
    mdSignatureId?: string;
    financeSignatureCode?: string;
    mdSignatureCode?: string;
    finance_signature_id?: string;
    md_signature_id?: string;
    finance_signature_code?: string;
    md_signature_code?: string;
  },
): Promise<SalaryAdvanceJob> {
  return request<SalaryAdvanceJob>(
    `/v1/salary-advance/batches/${batchId}/generation-jobs`,
    {
      method: "POST",
      body: signatures ? JSON.stringify(signatures) : undefined,
    },
  );
}

export function listSalaryAdvanceJobs(
  batchId: string,
): Promise<SalaryAdvanceJob[]> {
  return request<SalaryAdvanceJob[]>(
    `/v1/salary-advance/batches/${batchId}/generation-jobs`,
  );
}

export function getSalaryAdvanceJob(
  jobId: string,
): Promise<SalaryAdvanceJobDetail> {
  return request<SalaryAdvanceJobDetail>(
    `/v1/salary-advance/generation-jobs/${jobId}`,
  );
}

export function retrySalaryAdvanceJob(jobId: string): Promise<SalaryAdvanceJob> {
  return request<SalaryAdvanceJob>(
    `/v1/salary-advance/generation-jobs/${jobId}/retry-failed`,
    { method: "POST" },
  );
}

async function download(path: string, fileName?: string): Promise<void> {
  // 走 shared/download：anchor 挂进 DOM 再点、revoke 延后一个宏任务，
  // 修掉原先复制版的两个脆点（detached anchor 静默无下载 / 过早 revoke）。
  const response = await apiFetch(path);
  saveBlobAsFile(await response.blob(), fileNameFromResponse(response, fileName ?? "download"));
}

export async function downloadImportTemplate(): Promise<void> {
  const response = await apiFetch("/v1/salary-advance/batches/import-template");
  saveBlobAsFile(
    await response.blob(),
    fileNameFromResponse(response, "ZWT-SalaryAdvance-Import-Template.xlsx"),
  );
}

export function downloadValidationReport(batchId: string): Promise<void> {
  return download(
    `/v1/salary-advance/batches/${batchId}/validation-report`,
    "validation-report.xlsx",
  );
}

export async function previewSalaryAdvanceRecord(
  recordId: string,
): Promise<void> {
  const response = await apiFetch(
    `/v1/salary-advance/records/${recordId}/preview`,
    { method: "POST" },
  );
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function downloadJobArtifact(
  jobId: string,
  artifact: "zip" | "merged-pdf" | "manifest",
): Promise<void> {
  return download(`/v1/salary-advance/generation-jobs/${jobId}/${artifact}`);
}

export function downloadSalaryAdvanceDocument(
  documentId: string,
  format: "xlsx" | "pdf",
  fileName: string,
): Promise<void> {
  return download(
    `/v1/salary-advance/documents/${documentId}/${format}`,
    fileName,
  );
}

export interface EmployeeListResponse {
  items: SalaryAdvanceEmployee[];
  total: number;
}

export function listEmployees(
  query?: string,
  activeOnly: boolean = true,
  deleted: boolean = false,
  page: number = 1,
  pageSize: number = 50,
): Promise<EmployeeListResponse> {
  const params = new URLSearchParams();
  if (query) params.set("query", query);
  params.set("activeOnly", String(activeOnly));
  params.set("deleted", String(deleted));
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  return request<EmployeeListResponse>(`/v1/salary-advance/employees?${params.toString()}`);
}

export function createEmployee(payload: EmployeeInput): Promise<SalaryAdvanceEmployee> {
  return request<SalaryAdvanceEmployee>("/v1/salary-advance/employees", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateEmployee(
  employeeId: string,
  payload: EmployeeInput,
): Promise<SalaryAdvanceEmployee> {
  return request<SalaryAdvanceEmployee>(`/v1/salary-advance/employees/${employeeId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteEmployee(employeeId: string): Promise<SalaryAdvanceEmployee> {
  return request<SalaryAdvanceEmployee>(`/v1/salary-advance/employees/${employeeId}`, {
    method: "DELETE",
  });
}

export function restoreEmployee(employeeId: string): Promise<SalaryAdvanceEmployee> {
  return request<SalaryAdvanceEmployee>(`/v1/salary-advance/employees/${employeeId}/restore`, {
    method: "POST",
  });
}

export function getEmployeeDeletePreview(employeeId: string): Promise<EmployeeDeletePreview> {
  return request<EmployeeDeletePreview>(`/v1/salary-advance/employees/${employeeId}/delete-preview`);
}

export function importEmployees(file: File): Promise<EmployeeImportResult> {
  const form = new FormData();
  form.append("file", file);
  return request<EmployeeImportResult>("/v1/salary-advance/employees/import", {
    method: "POST",
    body: form,
  });
}

export async function downloadEmployeeTemplate(): Promise<void> {
  const response = await apiFetch("/v1/salary-advance/employees/template");
  saveBlobAsFile(
    await response.blob(),
    fileNameFromResponse(response, "工资预支单员工导入模板.xlsx"),
  );
}

