export type BatchStatus =
  | "validating"
  | "validation_failed"
  | "ready"
  | "locked"
  | "generating"
  | "completed"
  | "partially_completed"
  | "failed";

export type ValidationStatus = "valid" | "warning" | "invalid";
export type GenerationStatus = "pending" | "generating" | "success" | "failed";

export interface ValidationIssue {
  field: string;
  code: string;
  message: string;
}

export interface SalaryAdvanceBatch {
  id: string;
  batchNo: string;
  period: string;
  sourceFileName: string;
  sourceSha256: string;
  status: BatchStatus;
  totalRows: number;
  validRows: number;
  warningRows: number;
  invalidRows: number;
  createdByName: string;
  lockedByName: string | null;
  createdAt: string;
  lockedAt: string | null;
}

export interface SalaryAdvanceRecord {
  id: string;
  batchId: string;
  sourceRowNo: number;
  period: string;
  empId: string;
  rawData: Record<string, unknown>;
  normalizedData: Record<string, unknown>;
  dataFingerprint: string;
  validationStatus: ValidationStatus;
  validationErrors: ValidationIssue[];
  validationWarnings: ValidationIssue[];
  generationStatus: GenerationStatus;
  version: number;
  updatedAt: string;
}

export interface SalaryAdvanceBatchDetail {
  batch: SalaryAdvanceBatch;
  records: SalaryAdvanceRecord[];
}

export interface SalaryAdvanceDocument {
  id: string;
  jobId: string;
  recordId: string;
  generationVersion: number;
  xlsxFileName: string | null;
  pdfFileName: string | null;
  xlsxSha256: string | null;
  pdfSha256: string | null;
  templateSha256: string;
  pdfUnderlaySha256: string;
  pdfLayoutVersion: string;
  signatureVersions: Record<string, unknown>;
  dataFingerprint: string;
  status: "success" | "failed";
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export type JobStatus =
  | "queued"
  | "generating"
  | "completed"
  | "partially_completed"
  | "failed";

export interface SalaryAdvanceJob {
  id: string;
  batchId: string;
  templateId: string;
  status: JobStatus;
  totalCount: number;
  successCount: number;
  failedCount: number;
  requestedByName: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorSummary: string | null;
}

export interface SalaryAdvanceJobDetail {
  job: SalaryAdvanceJob;
  documents: SalaryAdvanceDocument[];
}
