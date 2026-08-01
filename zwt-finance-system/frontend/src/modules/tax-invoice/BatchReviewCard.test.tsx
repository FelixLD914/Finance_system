// @vitest-environment jsdom

/**
 * 复核卡的可视核对：为什么要有这组测试——
 * (1) 逐行「发票 FOB USD ↔ 报关单 FOB USD」并排、对不上的行整行标红（review-line-off），
 *     汇总对不上时整条描红（review-summary.is-off）。这是这一页存在的理由，钉死；
 * (2) 折叠态要给出一眼可判的状态标（需细看 / 全部一致），否则「默认折叠」就等于把
 *     状态藏起来了。
 */

import { StyleProvider } from "@ant-design/cssinjs";
import { cleanup, render } from "@testing-library/react";
import { App as AntApp } from "antd";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { BatchReviewCard } from "./TaxInvoiceWorkspace";
import { useI18n } from "../../i18n";
import type { TaxInvoice, TaxInvoiceItem } from "./types";

function makeItem(partial: Partial<TaxInvoiceItem>): TaxInvoiceItem {
  return {
    id: partial.lineNumber ?? 1,
    invoiceId: "inv",
    lineNumber: 1,
    productName: "ROUTER",
    productCode: null,
    hsCode: null,
    unit: "PIECES",
    quantity: "10",
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
    batchId: "b",
    correctionOfId: null,
    documentNo: null,
    status: "needs_review",
    ciNo: "ZWT-TEST-001",
    cdn: "A001234567890",
    ciDate: null,
    invoiceDate: "2026-03-02",
    exchangeTargetDate: null,
    exchangeRateDate: null,
    revenuePeriod: "202603",
    currency: "USD",
    exchangeRate: "34.10",
    customerName: "Nokia",
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
    createdAt: "2026-03-02T00:00:00Z",
    updatedAt: "2026-03-02T00:00:00Z",
    approvedAt: null,
    issuedAt: null,
    voidedAt: null,
    rejectedAt: null,
    items: [],
    events: [],
    ...partial,
  };
}

// `mock="server"` 让 antd 的 cssinjs 只算样式、不把 <style> 灌进 jsdom：样式表一大，
// 之后每次 getComputedStyle 都要线性跑完整份级联。类名由 token 哈希算出、与注不注入
// 无关，本文件断言的「标红」也是查类名而非计算样式，一律不受影响。
// 实测数据见 wht/IssuanceConsole.test.tsx 的 Harness。
function renderCard(invoice: TaxInvoice, expanded: boolean) {
  function Harness() {
    const { t, locale } = useI18n();
    return (
      <StyleProvider mock="server">
        <AntApp>
          <BatchReviewCard
            busy={false}
            expanded={expanded}
            invoice={invoice}
            locale={locale}
            selectable
            selected={false}
            t={t}
            onApprove={() => {}}
            onEdit={() => {}}
            onMatchRate={() => {}}
            onOpenDrawer={() => {}}
            onReject={() => {}}
            onToggle={() => {}}
            onToggleSelect={() => {}}
          />
        </AntApp>
      </StyleProvider>
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
  globalThis.ResizeObserver ??= class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => cleanup());

describe("BatchReviewCard 展开态", () => {
  it("逐行不符的行标红、汇总不符整条描红", () => {
    const invoice = makeInvoice({
      fobRevenueUsdTotal: "54000.00",
      customsFobUsdTotal: "53460.00",
      items: [
        makeItem({
          lineNumber: 1,
          fobRevenueUsd: "32400.00",
          customsFobUsd: "32400.00",
        }),
        makeItem({
          lineNumber: 2,
          fobRevenueUsd: "18600.00",
          customsFobUsd: "18060.00",
        }),
      ],
    });
    const { container } = renderCard(invoice, true);

    // 只有第 2 行对不上，整行标红。
    expect(container.querySelectorAll(".review-line-off")).toHaveLength(1);
    // 至少一个逐行 ✗ + 汇总条转红。
    expect(container.querySelector(".review-check-off")).not.toBeNull();
    expect(container.querySelector(".review-summary.is-off")).not.toBeNull();
  });

  it("逐行与汇总都一致时不标红", () => {
    const invoice = makeInvoice({
      fobRevenueUsdTotal: "27000.00",
      customsFobUsdTotal: "27000.00",
      items: [
        makeItem({
          lineNumber: 1,
          fobRevenueUsd: "27000.00",
          customsFobUsd: "27000.00",
        }),
      ],
    });
    const { container } = renderCard(invoice, true);

    expect(container.querySelector(".review-line-off")).toBeNull();
    expect(container.querySelector(".review-summary.is-off")).toBeNull();
    expect(container.querySelector(".review-check-ok")).not.toBeNull();
  });
});

describe("BatchReviewCard 折叠态", () => {
  it("需细看的给警告标、展开区不渲染", () => {
    const invoice = makeInvoice({ isDap: true });
    const { container } = renderCard(invoice, false);

    expect(container.querySelector(".tax-review-card.is-flagged")).not.toBeNull();
    expect(container.querySelector(".review-card-flag")).not.toBeNull();
    expect(container.querySelector(".review-card-body")).toBeNull();
  });

  it("干净且一致的给「全部一致」标", () => {
    const invoice = makeInvoice({
      fobRevenueUsdTotal: "27000.00",
      customsFobUsdTotal: "27000.00",
      items: [
        makeItem({
          lineNumber: 1,
          fobRevenueUsd: "27000.00",
          customsFobUsd: "27000.00",
        }),
      ],
    });
    const { container } = renderCard(invoice, false);

    expect(container.querySelector(".tax-review-card.is-flagged")).toBeNull();
    expect(container.querySelector(".review-card-ok")).not.toBeNull();
  });
});
