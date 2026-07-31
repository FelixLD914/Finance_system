// @vitest-environment jsdom

/**
 * 详情抽屉的版式约定：
 * (1) 「客户及报关资料」排在「日期与编号规则」之前——先认这张票开给谁、对哪张
 *     报关单，日期与编号是主体确定后才核的口径。业务方明确要求这个顺序，钉死。
 * (2) 「商品明细」的合计行必须真的渲染出金额（合计是这一段的结论，不能只有表体）。
 */

import { cleanup, render, within } from "@testing-library/react";
import { App as AntApp } from "antd";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { InvoiceInspector } from "./TaxInvoiceWorkspace";
import { useI18n } from "../../i18n";
import type { TaxInvoice, TaxInvoiceItem } from "./types";

function makeItem(partial: Partial<TaxInvoiceItem> = {}): TaxInvoiceItem {
  return {
    id: 1,
    invoiceId: "inv",
    lineNumber: 1,
    productName: "WIFI ROUTER",
    productCode: "WLS-617-A-J",
    hsCode: null,
    unit: "PIECES",
    quantity: "9504",
    ciUnitPrice: null,
    fobUnitPriceUsd: "31.7137",
    fobRevenueUsd: "301407.00",
    fobRevenueThb: "9325231.17",
    customsFobUsd: "301407.00",
    ...partial,
  } as TaxInvoiceItem;
}

function makeInvoice(partial: Partial<TaxInvoice> = {}): TaxInvoice {
  return {
    id: "x",
    batchId: "b",
    correctionOfId: null,
    documentNo: null,
    status: "needs_review",
    ciNo: "ZWT-NSB26021307",
    cdn: "A0271690205564",
    ciDate: null,
    invoiceDate: "2026-02-27",
    exchangeTargetDate: "2026-02-27",
    exchangeRateDate: "2026-02-27",
    revenuePeriod: "202602",
    currency: "USD",
    exchangeRate: "30.9390",
    customerName: "Nokia Solutions and Networks OY",
    customerAddress: "Karakaari 7, 02610 Espoo. Finland",
    taxId: null,
    poNo: "4502162509",
    incoterms: "FCA",
    paymentTerm: null,
    fobRevenueUsdTotal: "301407.00",
    fobRevenueThbTotal: "9325231.17",
    isDap: false,
    fobVerificationFailed: false,
    submissionDateLowConfidence: false,
    submissionDateConfidence: null,
    submissionDateSource: null,
    declarationRefNo: null,
    customsExchangeRate: null,
    forwarderName: null,
    forwarderTaxNo: null,
    customsFobUsdTotal: "301407.00",
    customsFobThbLineTotal: "9342984.04",
    customsFobThbPrintedTotal: "9342984.04",
    sourceInvoiceFileName: null,
    sourceCustomsFileName: null,
    version: 1,
    createdByName: "u",
    updatedByName: "u",
    createdAt: "2026-02-27T00:00:00Z",
    updatedAt: "2026-02-27T00:00:00Z",
    approvedAt: null,
    issuedAt: null,
    voidedAt: null,
    rejectedAt: null,
    items: [makeItem()],
    events: [],
    ...partial,
  } as TaxInvoice;
}

function renderInspector(invoice: TaxInvoice) {
  function Harness() {
    const { t, locale } = useI18n();
    return (
      <AntApp>
        <InvoiceInspector
          busy={false}
          documents={[]}
          invoice={invoice}
          locale={locale}
          t={t}
          onApprove={() => {}}
          onClose={() => {}}
          onCorrection={() => {}}
          onDownload={() => {}}
          onEdit={() => {}}
          onGenerate={() => {}}
          onMatchRate={() => {}}
          onReject={() => {}}
          onRestore={() => {}}
          onVoid={() => {}}
        />
      </AntApp>
    );
  }
  return render(<Harness />);
}

beforeAll(() => {
  const storage = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      key: (index: number) => [...storage.keys()][index] ?? null,
      get length() {
        return storage.size;
      },
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, String(value)),
    } satisfies Storage,
  });
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(cleanup);

describe("详情抽屉版式", () => {
  it("客户及报关资料排在日期与编号规则之前", () => {
    const { container } = renderInspector(makeInvoice());
    const headings = Array.from(
      container.querySelectorAll(".inspector-section h3"),
    ).map((el) => el.textContent);
    const customerAt = headings.indexOf("客户及报关资料");
    const dateAt = headings.indexOf("日期与编号规则");
    expect(customerAt).toBeGreaterThanOrEqual(0);
    expect(dateAt).toBeGreaterThanOrEqual(0);
    expect(customerAt).toBeLessThan(dateAt);
  });

  it("商品明细合计行给出 USD / THB 两个金额", () => {
    const { container } = renderInspector(makeInvoice());
    const strip = container.querySelector(".tax-total-strip");
    expect(strip).toBeTruthy();
    const totals = within(strip as HTMLElement)
      .getAllByText(/[\d,]+\.\d{2}/)
      .map((el) => el.textContent);
    // 合计条上必须同时出现 USD 与 THB 两个金额（这一段真正要看的结论）。
    expect(totals.join(" ")).toContain("301,407.00");
    expect(totals.join(" ")).toContain("9,325,231.17");
  });
});
