import type { Translate } from "../../i18n";
import type { TaxInvoice } from "./types";

// 复核台的核对口径集中在这里——这一页的核心业务判定，独立成模块方便单测与调整。
//
// TODO(业务确认)：usdMismatch 目前是「精确到分、无容差」，与后端 recognition.py 的
// Decimal != 一致。若业务允许 ±x 的四舍五入容差，只改这一个函数即可（逐行、汇总、
// 默认展开全都走它）。

/** 识别期已标出来的、要人看的几种情况（DAP / FOB 不符 / 提交日低可信 / 明细超 18 行）。 */
export function warningCount(invoice: TaxInvoice): number {
  return [
    invoice.submissionDateLowConfidence,
    invoice.fobVerificationFailed,
    invoice.isDap,
    invoice.items.length > 18,
  ].filter(Boolean).length;
}

/** 两个 FOB USD 是否对不上。任一为空＝没得核对，返回 false（不是核对不过）。 */
export function usdMismatch(
  invoiceUsd: string | null,
  customsUsd: string | null,
): boolean {
  if (invoiceUsd == null || customsUsd == null) return false;
  return Number(invoiceUsd).toFixed(2) !== Number(customsUsd).toFixed(2);
}

/** 逐行：发票行 FOB USD 与报关单该行是否有任一不符。 */
export function hasLineMismatch(invoice: TaxInvoice): boolean {
  return invoice.items.some((item) =>
    usdMismatch(item.fobRevenueUsd, item.customsFobUsd),
  );
}

/** 汇总：发票合计 FOB USD 与报关单 PDF 底部合计是否不符。 */
export function hasSummaryMismatch(invoice: TaxInvoice): boolean {
  return usdMismatch(invoice.fobRevenueUsdTotal, invoice.customsFobUsdTotal);
}

/**
 * 进批时哪张卡默认展开：有警告、或行/汇总 USD 不符、或汇率还没匹配上——都要人细看；
 * 其余（干净且一致的）默认折成一行。用户可随时手动展开或「全部展开」。
 */
export function needsAttention(invoice: TaxInvoice): boolean {
  return (
    warningCount(invoice) > 0 ||
    hasSummaryMismatch(invoice) ||
    hasLineMismatch(invoice) ||
    !invoice.exchangeRate
  );
}

/** 复核卡顶部警告条要列的条目（已本地化）。 */
export function reviewWarnings(invoice: TaxInvoice, t: Translate): string[] {
  const out: string[] = [];
  if (invoice.isDap) out.push(t("tax.warnDap"));
  if (invoice.submissionDateLowConfidence) out.push(t("tax.warnSubmissionDate"));
  if (invoice.items.length > 18) out.push(t("tax.warnTooManyItems"));
  const offLines = invoice.items
    .filter((item) => usdMismatch(item.fobRevenueUsd, item.customsFobUsd))
    .map((item) => item.lineNumber);
  if (offLines.length) {
    out.push(t("tax.warnLineOff", { lines: offLines.join("、") }));
  }
  if (hasSummaryMismatch(invoice)) out.push(t("tax.warnSummaryOff"));
  // 老数据/重识别前：后端标了 FOB 不符但报关单行值没落库，给一条兜底说明。
  if (
    invoice.fobVerificationFailed &&
    !offLines.length &&
    !hasSummaryMismatch(invoice)
  ) {
    out.push(t("tax.warnFobOff"));
  }
  return out;
}
