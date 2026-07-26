export type WhtStatus = "draft" | "pending_review" | "approved" | "issued" | "voided";
export type WhtType = "PND3" | "PND53";
export type IssuanceType = "normal" | "supplement";

export interface WhtTaskEvent {
  id: number;
  eventType: string;
  fromStatus: WhtStatus | null;
  toStatus: WhtStatus;
  actorName: string;
  note: string | null;
  createdAt: string;
}

export interface WhtTask {
  id: string;
  taskNo: string | null;
  bookNo: string | null;
  period: string;
  issuanceType: IssuanceType;
  supplementRun: number;
  status: WhtStatus;
  payeeId: string | null;
  companyName: string;
  companyNameEn: string | null;
  payeeAddress: string | null;
  taxId: string | null;
  whtType: WhtType | null;
  incomeType: string | null;
  paymentDate: string | null;
  dueDate: string | null;
  whtRate: string | null;
  totalAmount: string;
  whtAmount: string;
  documentCount: number;
  amountTextThai: string | null;
  dateTextThai: string | null;
  sourceFileName: string | null;
  version: number;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  issuedAt: string | null;
  voidedAt: string | null;
  events: WhtTaskEvent[];
}

export interface WhtTaskCreateInput {
  period: string;
  issuanceType: IssuanceType;
  supplementRun: number;
  payeeId: string;
  incomeType: string;
  paymentDate: string;
  dueDate?: string | null;
  whtRate: number;
  totalAmount: number;
  documentCount: number;
}

export interface Payee {
  id: string;
  taxId: string;
  nameTh: string;
  nameEn: string | null;
  addressTh: string;
  whtType: WhtType;
  aliases: string[];
  isActive: boolean;
  sourceFileName: string | null;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface PayeeInput {
  taxId: string;
  nameTh: string;
  nameEn?: string | null;
  addressTh: string;
  whtType: WhtType;
  aliases: string[];
  isActive?: boolean;
}

export interface ImportResult {
  sourceFileName: string;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

export interface SignatureAsset {
  id: string;
  name: string;
  originalFileName: string;
  mimeType: string;
  sha256: string;
  version: number;
  status: "active" | "inactive";
  isDefault: boolean;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface WhtDocument {
  id: string;
  taskId: string;
  signatureId: string | null;
  fileFormat: "xlsx" | "pdf";
  version: number;
  fileName: string;
  sha256: string;
  templateSha256: string;
  createdByName: string;
  createdAt: string;
}
