import {
  ApiError,
  UnauthorizedError,
  apiFetch,
  apiRequest,
} from "../../shared/http";
import type {
  BotApiStatus,
  ExchangeRate,
  ExchangeRateImportResult,
  TaxInvoice,
  TaxInvoiceDocument,
  TaxInvoiceImportResult,
  TaxInvoiceList,
} from "./types";

// TaxInvoiceApiError 保留为 ApiError 的别名，既有调用方不用改。
// 请求实现统一在 shared/http，那里处理 CSRF 头与会话凭证。
export { ApiError as TaxInvoiceApiError, UnauthorizedError };

const request = apiRequest;

export function listTaxInvoices(): Promise<TaxInvoiceList> {
  return request<TaxInvoiceList>("/v1/tax-invoice/invoices?pageSize=100");
}

export function getTaxInvoice(invoiceId: string): Promise<TaxInvoice> {
  return request<TaxInvoice>(`/v1/tax-invoice/invoices/${invoiceId}`);
}

/**
 * 按当前筛选条件导出台账 Excel（Sample 格式，改完能原样再导回）。
 *
 * 文件名以后端 Content-Disposition 为准：导出时间戳是后端打的，前端另算一份
 * 会和文件内容对不上。
 */
export async function exportTaxInvoiceLedger(filters: {
  status?: string;
  period?: string;
  query?: string;
}): Promise<void> {
  const params = new URLSearchParams();
  if (filters.status && filters.status !== "all") params.set("status", filters.status);
  if (filters.period && filters.period !== "all") params.set("period", filters.period);
  if (filters.query?.trim()) params.set("query", filters.query.trim());
  const suffix = params.toString() ? `?${params}` : "";
  const response = await apiFetch(`/v1/tax-invoice/invoices/export${suffix}`);
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const fileName =
    disposition.match(/filename="?([^"]+)"?/)?.[1] ?? "tax-inv-ledger.xlsx";
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function approveTaxInvoice(
  invoiceId: string,
  version: number,
  acceptWarnings: boolean,
): Promise<TaxInvoice> {
  return request<TaxInvoice>(`/v1/tax-invoice/invoices/${invoiceId}/approve`, {
    method: "POST",
    body: JSON.stringify({ version, acceptWarnings }),
  });
}

export function updateTaxInvoice(
  invoiceId: string,
  input: Record<string, unknown>,
): Promise<TaxInvoice> {
  return request<TaxInvoice>(`/v1/tax-invoice/invoices/${invoiceId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function voidTaxInvoice(
  invoiceId: string,
  version: number,
  reason: string,
): Promise<TaxInvoice> {
  return request<TaxInvoice>(`/v1/tax-invoice/invoices/${invoiceId}/void`, {
    method: "POST",
    body: JSON.stringify({ version, reason }),
  });
}

export function createTaxInvoiceCorrection(
  invoiceId: string,
  version: number,
  reason: string,
): Promise<TaxInvoice> {
  return request<TaxInvoice>(`/v1/tax-invoice/invoices/${invoiceId}/corrections`, {
    method: "POST",
    body: JSON.stringify({ version, reason }),
  });
}

export function importDualFiles(
  invoiceFile: File,
  customsFile: File,
  currency = "USD",
): Promise<TaxInvoiceImportResult> {
  const form = new FormData();
  form.append("currency", currency);
  form.append("invoiceFile", invoiceFile);
  form.append("customsFile", customsFile);
  return request<TaxInvoiceImportResult>("/v1/tax-invoice/import/dual", {
    method: "POST",
    body: form,
  });
}

export function importSample(file: File): Promise<TaxInvoiceImportResult> {
  const form = new FormData();
  form.append("file", file);
  return request<TaxInvoiceImportResult>("/v1/tax-invoice/import/sample", {
    method: "POST",
    body: form,
  });
}

export function listExchangeRates(
  currency = "USD",
  startDate?: string,
  endDate?: string,
): Promise<ExchangeRate[]> {
  const params = new URLSearchParams({ currency });
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  return request<ExchangeRate[]>(`/v1/tax-invoice/exchange-rates?${params}`);
}

/** 台账里已有数据的币种，用于币种下拉。 */
export function listRateCurrencies(): Promise<string[]> {
  return request<string[]>("/v1/tax-invoice/exchange-rates/currencies");
}

export function importExchangeRates(
  file: File,
  currency = "USD",
): Promise<ExchangeRateImportResult> {
  const form = new FormData();
  form.append("currency", currency);
  form.append("file", file);
  return request<ExchangeRateImportResult>("/v1/tax-invoice/exchange-rates/import", {
    method: "POST",
    body: form,
  });
}

export function fetchExchangeRates(
  startDate: string,
  endDate: string,
  currency = "USD",
): Promise<ExchangeRateImportResult> {
  return request<ExchangeRateImportResult>("/v1/tax-invoice/exchange-rates/fetch", {
    method: "POST",
    body: JSON.stringify({ currency, startDate, endDate }),
  });
}

/** BOT 接口配置自检。进页面就查，密钥没配好直接在界面上说清楚怎么配。 */
export function getBotApiStatus(): Promise<BotApiStatus> {
  return request<BotApiStatus>("/v1/tax-invoice/exchange-rates/bot-status");
}

export function listTaxInvoiceDocuments(
  invoiceId: string,
): Promise<TaxInvoiceDocument[]> {
  return request<TaxInvoiceDocument[]>(
    `/v1/tax-invoice/invoices/${invoiceId}/documents`,
  );
}

export function generateTaxInvoiceDocuments(
  invoiceId: string,
  signatureId: string | null = null,
): Promise<TaxInvoiceDocument[]> {
  return request<TaxInvoiceDocument[]>(
    `/v1/tax-invoice/invoices/${invoiceId}/generate-documents`,
    {
      method: "POST",
      body: JSON.stringify({
        // 签名只盖在 PDF 上；后端还会再校验这张图的适用范围是否含 tax_inv。
        includeSignature: signatureId !== null,
        signatureId,
        formats: ["xlsx", "pdf"],
      }),
    },
  );
}

export async function downloadTaxInvoiceDocument(
  document: TaxInvoiceDocument,
): Promise<void> {
  // 走 apiFetch：下载同样要带会话 Cookie，否则受保护的端点会 401。
  const response = await apiFetch(
    `/v1/tax-invoice/documents/${document.id}/download`,
  );
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = document.fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
