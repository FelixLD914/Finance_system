export type TaxInvoiceStatus =
  | "draft"
  | "needs_review"
  | "ready"
  | "approved"
  | "issued"
  | "voided";

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

export interface ExchangeRate {
  currency: string;
  rateDate: string;
  buyingTransfer: string;
  source: string;
  sourceFileName: string | null;
  updatedByName: string;
  updatedAt: string;
}

export interface ExchangeRateImportResult {
  sourceFileName: string;
  currency: string;
  created: number;
  updated: number;
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
