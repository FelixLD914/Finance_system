import {
  ApiError,
  UnauthorizedError,
  apiFetch,
  apiRequest,
} from "../../shared/http";
import type {
  BotApiStatus,
  DualIdentifyResult,
  ExchangeRate,
  ExchangeRateInput,
  ExchangeRateImportResult,
  ExchangeRateMonth,
  ExchangeRateUpdate,
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

/**
 * 按报关提交日重新匹配 BOT 汇率并重算 THB。
 *
 * 用于「先导票、后同步汇率」：识别建单时汇率表还没当期数据，这张票的汇率就一直
 * 空着。同步/导入 BOT 汇率之后点一次，后端按同一套 9 天回溯规则回填，不用手抄。
 */
export function matchTaxInvoiceRate(
  invoiceId: string,
  version: number,
): Promise<TaxInvoice> {
  return request<TaxInvoice>(`/v1/tax-invoice/invoices/${invoiceId}/match-rate`, {
    method: "POST",
    body: JSON.stringify({ version }),
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

/**
 * 认一批文件的身份并按 C/I No. 配对，不入库。
 *
 * 配对键在文件内容里，只有后端解析得动，所以"哪个 Excel 对哪份报关单"必须先来
 * 后端问一趟，再把结果摆给用户确认。按文件名配对是原来的做法，实测 100% 配错：
 * 同名的那份 PDF 全都是发票自己的打印件，不是报关单。
 */
export function identifyDualFiles(files: File[]): Promise<DualIdentifyResult> {
  const form = new FormData();
  for (const file of files) form.append("files", file);
  return request<DualIdentifyResult>("/v1/tax-invoice/import/dual/identify", {
    method: "POST",
    body: form,
  });
}

/**
 * 一组文件导入成一张税票。
 *
 * `customsFile` 可以不传：关单还没下来时先按发票开票，这张票停在"待补关单"
 * （CDN / 提交日期 / 汇率 / THB 全空），补到关单再回填。
 */
export function importDualFiles(
  invoiceFile: File,
  customsFile: File | null,
  currency = "USD",
): Promise<TaxInvoiceImportResult> {
  const form = new FormData();
  form.append("currency", currency);
  form.append("invoiceFile", invoiceFile);
  if (customsFile) form.append("customsFile", customsFile);
  return request<TaxInvoiceImportResult>("/v1/tax-invoice/import/dual", {
    method: "POST",
    body: form,
  });
}

/**
 * 批量开具：编号由批准时的事务生成，文件里带编号会被整批退回。
 *
 * 补开以前月份的税票也走这里——把 Invoice Date 填成当时的报关提交日，编号会
 * 按那一天发。原先另有一条允许沿用旧系统编号的 /import/migration，已摘除。
 */
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
  options: {
    startDate?: string;
    endDate?: string;
    month?: string;
    deleted?: boolean;
  } = {},
): Promise<ExchangeRate[]> {
  const params = new URLSearchParams({ currency });
  if (options.startDate) params.set("startDate", options.startDate);
  if (options.endDate) params.set("endDate", options.endDate);
  if (options.month) params.set("month", options.month);
  if (options.deleted) params.set("deleted", "true");
  return request<ExchangeRate[]>(`/v1/tax-invoice/exchange-rates?${params}`);
}

export function listExchangeRateMonths(
  currency = "USD",
): Promise<ExchangeRateMonth[]> {
  const params = new URLSearchParams({ currency });
  return request<ExchangeRateMonth[]>(
    `/v1/tax-invoice/exchange-rates/months?${params}`,
  );
}

export function saveExchangeRate(
  input: ExchangeRateInput,
  rateId?: number,
): Promise<ExchangeRate> {
  const endpoint = rateId
    ? `/v1/tax-invoice/exchange-rates/${rateId}`
    : "/v1/tax-invoice/exchange-rates";
  const payload: ExchangeRateInput | ExchangeRateUpdate = rateId
    ? {
        buyingTransfer: input.buyingTransfer,
        buyingSight: input.buyingSight,
        selling: input.selling,
        midRate: input.midRate,
        isActive: input.isActive,
      }
    : input;
  return request<ExchangeRate>(endpoint, {
    method: rateId ? "PATCH" : "POST",
    body: JSON.stringify(payload),
  });
}

export function updateExchangeRate(
  rateId: number,
  input: Partial<ExchangeRateUpdate>,
): Promise<ExchangeRate> {
  return request<ExchangeRate>(`/v1/tax-invoice/exchange-rates/${rateId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteExchangeRate(rateId: number): Promise<ExchangeRate> {
  return request<ExchangeRate>(`/v1/tax-invoice/exchange-rates/${rateId}`, {
    method: "DELETE",
  });
}

export function restoreExchangeRate(rateId: number): Promise<ExchangeRate> {
  return request<ExchangeRate>(
    `/v1/tax-invoice/exchange-rates/${rateId}/restore`,
    { method: "POST" },
  );
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
