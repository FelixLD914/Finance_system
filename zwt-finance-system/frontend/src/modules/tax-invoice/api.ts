import {
  ApiError,
  UnauthorizedError,
  apiFetch,
  apiRequest,
} from "../../shared/http";
import type {
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

export function listExchangeRates(): Promise<ExchangeRate[]> {
  return request<ExchangeRate[]>("/v1/tax-invoice/exchange-rates?currency=USD");
}

export function importExchangeRates(file: File): Promise<ExchangeRateImportResult> {
  const form = new FormData();
  form.append("currency", "USD");
  form.append("file", file);
  return request<ExchangeRateImportResult>("/v1/tax-invoice/exchange-rates/import", {
    method: "POST",
    body: form,
  });
}

export function fetchExchangeRates(
  startDate: string,
  endDate: string,
): Promise<ExchangeRateImportResult> {
  return request<ExchangeRateImportResult>("/v1/tax-invoice/exchange-rates/fetch", {
    method: "POST",
    body: JSON.stringify({ currency: "USD", startDate, endDate }),
  });
}

export function listTaxInvoiceDocuments(
  invoiceId: string,
): Promise<TaxInvoiceDocument[]> {
  return request<TaxInvoiceDocument[]>(
    `/v1/tax-invoice/invoices/${invoiceId}/documents`,
  );
}

export function generateTaxInvoiceXlsx(
  invoiceId: string,
): Promise<TaxInvoiceDocument[]> {
  return request<TaxInvoiceDocument[]>(
    `/v1/tax-invoice/invoices/${invoiceId}/generate-documents`,
    {
      method: "POST",
      body: JSON.stringify({
        includeSignature: false,
        signatureId: null,
        formats: ["xlsx"],
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
