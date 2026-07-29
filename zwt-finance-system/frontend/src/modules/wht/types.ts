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
  /**
   * 税率偏离收入类型目录法定值时必填的理由，服务端写进建单事件的 note。
   * 偏离与否由服务端按目录自己判定，前端的必填只是把话说在前面。
   */
  rateOverrideNote?: string | null;
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
  deletedAt: string | null;
  deletedByName: string | null;
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

export interface PayeeDeletePreview {
  payeeId: string;
  taxId: string;
  nameTh: string;
  referencingTasks: number;
}

export interface ImportResult {
  sourceFileName: string;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

/** 收入类型目录项。落库的仍是 labelTh —— WHT 正式文件按泰文打印。 */
export interface IncomeTypeOption {
  code: string;
  labelTh: string;
  labelEn: string;
  labelZh: string;
  section: string;
  rates: Array<{ whtType: WhtType; rate: string }>;
  /** 本公司历史台账里实际用过的类型，排在目录前面。 */
  inUse: boolean;
}

export interface BatchCreateResult {
  sourceFileName: string;
  created: number;
  taskIds: string[];
}

export interface BatchTransitionItem {
  taskId: string;
  succeeded: boolean;
  taskNo: string | null;
  error: string | null;
}

export interface BatchTransitionResult {
  action: string;
  succeeded: number;
  failed: number;
  items: BatchTransitionItem[];
}

/**
 * 一张签名图能盖在哪些单据上。各模块的签字人可能不同，所以是集合而不是单选。
 * 旧的 "both"（WHT + TAX INV）已在 migration 0011 展开成具体模块。
 */
export type SignatureUsage = "wht" | "tax_inv" | "salary_advance";

export interface SignatureAsset {
  id: string;
  name: string;
  originalFileName: string;
  mimeType: string;
  sha256: string;
  version: number;
  status: "active" | "inactive";
  usage: SignatureUsage[];
  /** 默认签名按适用范围各算各的：各模块可以各有一张默认。 */
  isDefault: boolean;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  deletedByName: string | null;
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
