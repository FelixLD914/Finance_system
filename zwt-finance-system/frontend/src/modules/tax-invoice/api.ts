import type {
  ExchangeRate,
  ExchangeRateImportResult,
  TaxInvoice,
  TaxInvoiceDocument,
  TaxInvoiceImportResult,
  TaxInvoiceList,
} from "./types";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "/api";

export class TaxInvoiceApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new TaxInvoiceApiError(
      body?.detail ?? `API request failed (${response.status})`,
      response.status,
    );
  }
  return (await response.json()) as T;
}

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
  const response = await fetch(
    `${apiBase}/v1/tax-invoice/documents/${document.id}/download`,
  );
  if (!response.ok) {
    throw new TaxInvoiceApiError("文件下载失败", response.status);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = document.fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
