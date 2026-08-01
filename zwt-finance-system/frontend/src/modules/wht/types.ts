export type WhtStatus = "draft" | "pending_review" | "approved" | "issued" | "voided";
export type WhtType = "PND3" | "PND53";
export type IssuanceType = "normal" | "supplement";
export type BranchType = "none" | "head_office" | "branch";

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
  branchType: BranchType;
  branchNumber: string | null;
  incomeType: string | null;
  paymentDate: string | null;
  dueDate: string | null;
  whtRate: string | null;
  totalAmount: string;
  whtAmount: string;
  amountTextThai: string | null;
  dateTextThai: string | null;
  sourceFileName: string | null;
  /** 收款方是批量导入时人工补录的，还没进主数据；批准这张票时才写库。 */
  payeePending: boolean;
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

/** 草稿可改的字段。已开具的票要先走「修订」退回草稿才能用它。 */
export interface WhtTaskUpdateInput {
  incomeType?: string;
  paymentDate?: string;
  whtRate?: number;
  totalAmount?: number;
  /**
   * 改完之后税率偏离目录法定值时必填的理由。偏离与否由服务端按改后的值自己判定，
   * 前端的必填只是把话说在前面 —— 与建单那条路径同一口径。
   */
  rateOverrideNote?: string | null;
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
  branchType: BranchType;
  branchNumber: string | null;
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
  branchType: BranchType;
  branchNumber?: string | null;
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
  /** 其中有多少条带着「批准时才写进主数据」的新收款方。 */
  payeesPending: number;
}

/**
 * 核对表里一行的状态。只有 ready 能落库。
 *
 *   ready          齐了
 *   payee_missing  税号在主数据里查不到，等人补录收款方资料
 *   needs_input    行本身还缺东西（税率带不出来 / 偏离法定税率却没写理由 / 收款方停用）
 */
export type BatchRowStatus = "ready" | "payee_missing" | "needs_input";

export interface BatchPreviewPayee {
  /** 为空即「主数据里没有」。补录时前端只填下面几项，id 仍留空。 */
  payeeId: string | null;
  taxId: string;
  nameTh: string | null;
  nameEn: string | null;
  addressTh: string | null;
  whtType: WhtType | null;
  branchType: BranchType;
  branchNumber: string | null;
  isActive: boolean;
}

export interface BatchPreviewRow {
  rowNumber: number;
  status: BatchRowStatus;
  period: string;
  issuanceType: IssuanceType;
  supplementRun: number;
  incomeType: string;
  paymentDate: string;
  totalAmount: string;
  payee: BatchPreviewPayee;
  whtRate: string | null;
  /** 目录法定税率。收款方未补录时为空——不知道走哪张 PND 表，算不出来。 */
  statutoryRate: string | null;
  whtAmount: string | null;
  rateReason: string | null;
  errors: string[];
}

export interface BatchPreviewResult {
  sourceFileName: string;
  rows: BatchPreviewRow[];
  ready: number;
  payeeMissing: number;
  needsInput: number;
}

export interface BatchCommitPayeeInput {
  payeeId: string | null;
  taxId: string;
  nameTh?: string | null;
  nameEn?: string | null;
  addressTh?: string | null;
  whtType?: WhtType | null;
  branchType?: BranchType | null;
  branchNumber?: string | null;
}

export interface BatchCommitRowInput {
  rowNumber: number;
  period: string;
  issuanceType: IssuanceType;
  supplementRun: number;
  incomeType: string;
  paymentDate: string;
  totalAmount: number;
  whtRate: number | null;
  rateReason: string | null;
  payee: BatchCommitPayeeInput;
}

export interface BatchCommitInput {
  sourceFileName: string;
  rows: BatchCommitRowInput[];
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
