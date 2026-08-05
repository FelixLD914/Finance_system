export type TaxInvoiceStatus =
  | "draft"
  | "needs_review"
  | "ready"
  | "approved"
  | "issued"
  | "voided"
  | "rejected";

export interface TaxInvoiceItem {
  id: number;
  invoiceId: string;
  lineNumber: number;
  productName: string | null;
  productCode: string | null;
  hsCode: string | null;
  unit: string | null;
  quantity: string | null;
  ciUnitPrice: string | null;
  fobUnitPriceUsd: string | null;
  fobRevenueUsd: string | null;
  fobRevenueThb: string | null;
  // 报关单该行自印的 FOB USD，仅供复核台逐行核对（发票行 ↔ 报关单行）。
  // 报关单无明细、或发票行多于报关单行时为 null（没得核对）。
  customsFobUsd: string | null;
}

export interface TaxInvoiceEvent {
  id: number;
  eventType: string;
  fromStatus: TaxInvoiceStatus | null;
  toStatus: TaxInvoiceStatus;
  actorName: string;
  note: string | null;
  createdAt: string;
}

export interface TaxInvoice {
  id: string;
  batchId: string | null;
  correctionOfId: string | null;
  documentNo: string | null;
  status: TaxInvoiceStatus;
  ciNo: string;
  cdn: string | null;
  ciDate: string | null;
  invoiceDate: string | null;
  exchangeTargetDate: string | null;
  exchangeRateDate: string | null;
  revenuePeriod: string | null;
  currency: string;
  exchangeRate: string | null;
  customerName: string;
  customerAddress: string;
  taxId: string | null;
  poNo: string | null;
  incoterms: string | null;
  paymentTerm: string | null;
  fobRevenueUsdTotal: string;
  fobRevenueThbTotal: string;
  isDap: boolean;
  fobVerificationFailed: boolean;
  submissionDateLowConfidence: boolean;
  submissionDateConfidence: string | null;
  submissionDateSource: string | null;
  // 报关单侧留痕，仅供复核台对账（不参与计价）。
  declarationRefNo: string | null;
  customsExchangeRate: string | null;
  forwarderName: string | null;
  forwarderTaxNo: string | null;
  customsFobUsdTotal: string | null;
  customsFobThbLineTotal: string | null;
  customsFobThbPrintedTotal: string | null;
  sourceInvoiceFileName: string | null;
  sourceCustomsFileName: string | null;
  version: number;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  issuedAt: string | null;
  voidedAt: string | null;
  rejectedAt: string | null;
  items: TaxInvoiceItem[];
  events: TaxInvoiceEvent[];
}

export interface TaxInvoiceList {
  items: TaxInvoice[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TaxInvoiceImportResult {
  batchId: string;
  invoiceIds: string[];
  invoiceCount: number;
  itemCount: number;
  needsReviewCount: number;
}

// ── 双文件识别：后端按 C/I No. 配好组再回给界面预览 ──────────────────────────

/** Export Invoice Excel 认出来的身份与摘要。 */
export interface DualIdentifiedInvoice {
  fileName: string;
  ciNo: string;
  ciDate: string | null;
  incoterms: string | null;
  customerName: string | null;
  itemCount: number;
  fobAmountUsd: string | null;
  quantityTotal: string | null;
}

/** 出口报关单认出来的身份 + 核对字段。 */
export interface DualIdentifiedCustoms {
  fileName: string;
  ciNo: string;
  cdn: string | null;
  declarationRefNo: string | null;
  submissionDate: string | null;
  submissionDateConfidence: string | null;
  submissionDateLowConfidence: boolean;
  customsExchangeRate: string | null;
  /** 报关单印英文就是英文，只印泰文就是泰文。界面显示用这个。 */
  forwarderName: string | null;
  forwarderNameTh: string | null;
  forwarderNameEn: string | null;
  forwarderTaxNo: string | null;
  customsFobUsdTotal: string | null;
  customsFobThbLineTotal: string | null;
  customsFobThbPrintedTotal: string | null;
  warnings: string[];
}

/** 一组配对结果。两边任一缺失也保留——界面要显示是哪一组没配上。 */
export interface DualPairPreview {
  key: string;
  /** conflict = 同一 C/I No. 配到多份不同的报关单，撮合阶段就要人工处理。 */
  status: "ready" | "invoice_only" | "customs_only" | "conflict";
  invoice: DualIdentifiedInvoice | null;
  customs: DualIdentifiedCustoms | null;
  supersededCustomsFileNames: string[];
  conflicts: string[];
}

export interface DualRejectedFile {
  fileName: string;
  kind: "invoice" | "customs" | "unsupported";
  reason: string;
}

export interface DualIdentifyResult {
  pairs: DualPairPreview[];
  rejected: DualRejectedFile[];
  readyCount: number;
  invoiceOnlyCount: number;
  customsOnlyCount: number;
  conflictCount: number;
}

// ── 双文件批量导入：一次上传的全部可导入配对 → 一个复核批次（不自动出编号）──────

/** 成功落库的一组：这一对文件建成的税票。 */
export interface DualBatchPairResult {
  key: string;
  invoiceFileName: string;
  customsFileName: string | null;
  invoiceId: string;
  itemCount: number;
  needsReview: boolean;
}

/** 识别出来但没导入的一组：孤立关单（缺发票）或冲突（多份不同关单）。 */
export interface DualSkippedPair {
  key: string;
  status: "customs_only" | "conflict";
  reason: string;
}

export interface DualBatchImportResult {
  /** 全批没有一组可导入时为 null（只有孤立关单/冲突/读不了的文件）。 */
  batchId: string | null;
  invoiceCount: number;
  itemCount: number;
  needsReviewCount: number;
  results: DualBatchPairResult[];
  rejected: DualRejectedFile[];
  skipped: DualSkippedPair[];
}

// ── 复核台：批次总览 + 单条/整批 批准·拒批 ────────────────────────────────────

/** 一个导入批次 + 当前各状态实时计数（随逐条批准/拒批变动）。 */
export interface ImportBatch {
  id: string;
  importMode: string;
  status: string;
  currency: string;
  sourceFileNames: string;
  createdByName: string;
  createdAt: string;
  total: number;
  pending: number;
  needsReview: number;
  approved: number;
}

export interface BatchApproveResult {
  approvedCount: number;
  approvedIds: string[];
  /** 够不上批准的（缺字段/汇率/超 18 行），逐条附原因。 */
  skipped: { invoiceId: string; reason: string }[];
}

export interface BatchRejectResult {
  rejectedCount: number;
  rejectedIds: string[];
}

export interface BatchGenerateResult {
  /** 成功开出文件的税票张数。 */
  generatedCount: number;
  generatedInvoiceIds: string[];
  /** 落盘文件总数（每张票按所选格式可能是 1 或 2 个）。 */
  documentCount: number;
  /** 开不出来的，逐条附票号与原因；票号让用户能直接对上账。 */
  skipped: { invoiceId: string; documentNo: string | null; reason: string }[];
}

export interface ExchangeRate {
  id: number;
  currency: string;
  rateDate: string;
  /** 出口税票计价用的汇率，必有值。 */
  buyingTransfer: string;
  /** BOT 同条记录里的另外三种报价；Excel 导入的行为 null。 */
  buyingSight: string | null;
  selling: string | null;
  midRate: string | null;
  source: string;
  sourceFileName: string | null;
  isActive: boolean;
  updatedByName: string;
  updatedAt: string;
  deletedAt: string | null;
  deletedByName: string | null;
}

export interface ExchangeRateMonth {
  currency: string;
  month: string;
  dayCount: number;
  inactiveCount: number;
  minRate: string;
  maxRate: string;
  latestDate: string;
  updatedAt: string;
}

export interface ExchangeRateInput {
  currency: string;
  rateDate: string;
  buyingTransfer: number;
  buyingSight?: number | null;
  selling?: number | null;
  midRate?: number | null;
  isActive: boolean;
}

export type ExchangeRateUpdate = Omit<
  ExchangeRateInput,
  "currency" | "rateDate"
>;

export interface ExchangeRateImportResult {
  sourceFileName: string;
  currency: string;
  created: number;
  updated: number;
}

/** BOT 接口配置自检。keyHint 只有首尾各 4 位，完整密钥不出服务器。 */
export interface BotApiStatus {
  configured: boolean;
  baseUrl: string;
  endpoint: string;
  authHeader: string;
  keyHint: string | null;
  envVar: string;
}

export interface TaxInvoiceDocument {
  id: string;
  invoiceId: string;
  signatureId: string | null;
  fileFormat: "xlsx" | "pdf";
  version: number;
  fileName: string;
  sha256: string;
  templateSha256: string;
  createdByName: string;
  createdAt: string;
}
