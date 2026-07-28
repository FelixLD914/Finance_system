import { apiFetch, apiRequest } from "../../shared/http";
import type {
  SalaryAdvanceBatch,
  SalaryAdvanceBatchDetail,
  SalaryAdvanceJob,
  SalaryAdvanceJobDetail,
  SalaryAdvanceRecord,
  SalaryAdvanceTemplate,
} from "./types";

const request = apiRequest;

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
): Promise<SalaryAdvanceJob> {
  return request<SalaryAdvanceJob>(
    `/v1/salary-advance/batches/${batchId}/generation-jobs`,
    { method: "POST" },
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

export function listSalaryAdvanceTemplates(): Promise<SalaryAdvanceTemplate[]> {
  return request<SalaryAdvanceTemplate[]>("/v1/salary-advance/templates");
}

async function download(path: string, fileName?: string): Promise<void> {
  const response = await apiFetch(path);
  const contentDisposition = response.headers.get("content-disposition") ?? "";
  const encodedName = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const resolvedName = encodedName ? decodeURIComponent(encodedName) : fileName;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = resolvedName ?? "download";
  anchor.click();
  URL.revokeObjectURL(url);
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
