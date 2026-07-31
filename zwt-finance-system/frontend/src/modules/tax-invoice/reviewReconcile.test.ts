import { describe, expect, it } from "vitest";

import type { Translate } from "../../i18n";
import {
  hasLineMismatch,
  hasSummaryMismatch,
  needsAttention,
  reviewWarnings,
  usdMismatch,
  warningCount,
} from "./reviewReconcile";
import type { TaxInvoice, TaxInvoiceItem } from "./types";

function makeItem(partial: Partial<TaxInvoiceItem>): TaxInvoiceItem {
  return {
    id: 1,
    invoiceId: "inv",
    lineNumber: 1,
    productName: null,
    productCode: null,
    hsCode: null,
    unit: null,
    quantity: null,
    ciUnitPrice: null,
    fobUnitPriceUsd: null,
    fobRevenueUsd: null,
    fobRevenueThb: null,
    customsFobUsd: null,
    ...partial,
  };
}

function makeInvoice(partial: Partial<TaxInvoice>): TaxInvoice {
  return {
    id: "x",
    batchId: null,
    correctionOfId: null,
    documentNo: null,
    status: "needs_review",
    ciNo: "CI",
    cdn: null,
    ciDate: null,
    invoiceDate: "2026-03-02",
    exchangeTargetDate: null,
    exchangeRateDate: null,
    revenuePeriod: "202603",
    currency: "USD",
    exchangeRate: "34.10",
    customerName: "ACME",
    customerAddress: "addr",
    taxId: null,
    poNo: null,
    incoterms: "FCA",
    paymentTerm: null,
    fobRevenueUsdTotal: "0.00",
    fobRevenueThbTotal: "0.00",
    isDap: false,
    fobVerificationFailed: false,
    submissionDateLowConfidence: false,
    submissionDateConfidence: null,
    submissionDateSource: null,
    declarationRefNo: null,
    customsExchangeRate: null,
    forwarderName: null,
    forwarderTaxNo: null,
    customsFobUsdTotal: null,
    customsFobThbLineTotal: null,
    customsFobThbPrintedTotal: null,
    sourceInvoiceFileName: null,
    sourceCustomsFileName: null,
    version: 1,
    createdByName: "u",
    updatedByName: "u",
    createdAt: "",
    updatedAt: "",
    approvedAt: null,
    issuedAt: null,
    voidedAt: null,
    rejectedAt: null,
    items: [],
    events: [],
    ...partial,
  };
}

// 恒等 Translate：只关心「命中了哪条文案键」，不关心具体译文。
const t = ((key: string) => key) as unknown as Translate;

describe("usdMismatch", () => {
  it("任一为空＝没得核对，返回 false", () => {
    expect(usdMismatch(null, "1.00")).toBe(false);
    expect(usdMismatch("1.00", null)).toBe(false);
  });

  it("精确到分：分位相等不算不符（尾零/小数位不同也算相等）", () => {
    expect(usdMismatch("54000.00", "54000.0")).toBe(false);
    expect(usdMismatch("54000.00", "54000.00")).toBe(false);
  });

  it("差到分就是不符", () => {
    expect(usdMismatch("54000.00", "53460.00")).toBe(true);
    expect(usdMismatch("54000.00", "54000.01")).toBe(true);
  });
});

describe("hasLineMismatch / hasSummaryMismatch", () => {
  it("逐行：某一行发票与报关单对不上就为真", () => {
    const clean = makeInvoice({
      items: [makeItem({ fobRevenueUsd: "10.00", customsFobUsd: "10.00" })],
    });
    const off = makeInvoice({
      items: [
        makeItem({ lineNumber: 1, fobRevenueUsd: "10.00", customsFobUsd: "10.00" }),
        makeItem({ lineNumber: 2, fobRevenueUsd: "18.00", customsFobUsd: "18.06" }),
      ],
    });
    expect(hasLineMismatch(clean)).toBe(false);
    expect(hasLineMismatch(off)).toBe(true);
  });

  it("汇总：发票合计与报关单合计对不上就为真，报关单无合计不算不符", () => {
    expect(
      hasSummaryMismatch(
        makeInvoice({ fobRevenueUsdTotal: "100.00", customsFobUsdTotal: "100.00" }),
      ),
    ).toBe(false);
    expect(
      hasSummaryMismatch(
        makeInvoice({ fobRevenueUsdTotal: "100.00", customsFobUsdTotal: "99.00" }),
      ),
    ).toBe(true);
    expect(
      hasSummaryMismatch(
        makeInvoice({ fobRevenueUsdTotal: "100.00", customsFobUsdTotal: null }),
      ),
    ).toBe(false);
  });
});

describe("needsAttention", () => {
  it("干净、逐行一致、汇总一致、有汇率＝默认折叠（false）", () => {
    const ok = makeInvoice({
      exchangeRate: "34.10",
      fobRevenueUsdTotal: "10.00",
      customsFobUsdTotal: "10.00",
      items: [makeItem({ fobRevenueUsd: "10.00", customsFobUsd: "10.00" })],
    });
    expect(needsAttention(ok)).toBe(false);
  });

  it("有警告 / 行或汇总不符 / 汇率未匹配都要默认展开（true）", () => {
    expect(needsAttention(makeInvoice({ isDap: true }))).toBe(true);
    expect(needsAttention(makeInvoice({ exchangeRate: null }))).toBe(true);
    expect(
      needsAttention(
        makeInvoice({
          fobRevenueUsdTotal: "10.00",
          customsFobUsdTotal: "9.00",
        }),
      ),
    ).toBe(true);
    expect(
      needsAttention(
        makeInvoice({
          items: [makeItem({ fobRevenueUsd: "10.00", customsFobUsd: "9.00" })],
        }),
      ),
    ).toBe(true);
  });
});

describe("reviewWarnings", () => {
  it("列出逐行不符的行号与汇总不符", () => {
    const invoice = makeInvoice({
      fobRevenueUsdTotal: "54000.00",
      customsFobUsdTotal: "53460.00",
      items: [
        makeItem({ lineNumber: 1, fobRevenueUsd: "10.00", customsFobUsd: "10.00" }),
        makeItem({ lineNumber: 2, fobRevenueUsd: "18.00", customsFobUsd: "18.06" }),
      ],
    });
    const warnings = reviewWarnings(invoice, t);
    expect(warnings).toContain("tax.warnLineOff");
    expect(warnings).toContain("tax.warnSummaryOff");
  });

  it("老数据：后端标了 FOB 不符但报关单行值没落库，给兜底文案", () => {
    const legacy = makeInvoice({
      fobVerificationFailed: true,
      customsFobUsdTotal: null,
      items: [makeItem({ fobRevenueUsd: "10.00", customsFobUsd: null })],
    });
    const warnings = reviewWarnings(legacy, t);
    expect(warnings).toContain("tax.warnFobOff");
    expect(warnings).not.toContain("tax.warnLineOff");
  });

  it("干净票没有任何警告", () => {
    expect(reviewWarnings(makeInvoice({}), t)).toEqual([]);
  });
});

describe("warningCount", () => {
  it("按 DAP / FOB 不符 / 提交日低可信 / 超 18 行累加", () => {
    expect(warningCount(makeInvoice({}))).toBe(0);
    expect(
      warningCount(
        makeInvoice({ isDap: true, fobVerificationFailed: true }),
      ),
    ).toBe(2);
  });
});
