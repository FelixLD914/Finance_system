// @vitest-environment jsdom

/**
 * 台账行内单元格编辑。为什么要有这组测试：
 * (1) 点格子里的铅笔必须 stopPropagation，不能连带触发整行点击把详情面板打开——
 *     这一条只有在真浏览器里点下去才看得见，光看代码容易漏；
 * (2) 保存必须只发 {version, 该字段} 的最小 patch。后端 update_invoice 靠
 *     exclude_unset 决定改哪些字段，多带一个字段就会把它一起覆盖（比如把
 *     整份明细清空）。这是税票编辑最容易出事的地方，钉死。
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntApp } from "antd";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { useI18n } from "../../i18n";
import type { TaxInvoice } from "./types";

// 一张未批准（needs_review）的票：默认「待处理」相里就能看到，可编辑。
const invoice: TaxInvoice = {
  id: "inv-1",
  batchId: "batch-1",
  correctionOfId: null,
  documentNo: null,
  status: "needs_review",
  ciNo: "ZWT-TEST-001",
  cdn: "A0231690118554",
  ciDate: "2026-01-23",
  invoiceDate: "2026-01-23",
  exchangeTargetDate: "2026-01-23",
  exchangeRateDate: "2026-01-22",
  revenuePeriod: "202601",
  currency: "USD",
  exchangeRate: "31.500000",
  customerName: "Nokia Solutions",
  customerAddress: "Bangkok",
  taxId: null,
  poNo: null,
  incoterms: "FCA",
  paymentTerm: null,
  fobRevenueUsdTotal: "7077.60",
  fobRevenueThbTotal: "222944.40",
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
  // 故意用 3：断言 patch 带的是这张票当前的 version，而不是写死的 1。
  version: 3,
  createdByName: "importer",
  updatedByName: "importer",
  createdAt: "2026-01-23T00:00:00Z",
  updatedAt: "2026-01-23T00:00:00Z",
  approvedAt: null,
  issuedAt: null,
  voidedAt: null,
  rejectedAt: null,
  items: [],
  events: [],
};

const updateTaxInvoice = vi.fn<
  (id: string, input: Record<string, unknown>) => Promise<TaxInvoice>
>(async (_id, input) => ({ ...invoice, ...input, version: invoice.version + 1 }));
// 打开详情才会调它；行内编辑绝不能碰到它。
const getTaxInvoice = vi.fn(async () => invoice);

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    listTaxInvoices: async () => ({
      items: [invoice],
      total: 1,
      page: 1,
      pageSize: 100,
    }),
    getTaxInvoice,
    updateTaxInvoice,
    listInvoiceDocuments: async () => [],
    listExchangeRateMonths: async () => [],
    listExchangeRates: async () => [],
    listRateCurrencies: async () => ["USD"],
    getBotApiStatus: async () => ({
      configured: false,
      baseUrl: "",
      endpoint: "",
      authHeader: "",
      keyHint: null,
      envVar: "ZWT_BOT_API_KEY",
    }),
  };
});

vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({
    can: () => true,
    principal: { actorName: "测试审批人", role: "admin" },
    signOut: vi.fn(),
  }),
}));

vi.mock("../wht/api", () => ({ listSignatures: async () => [] }));

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

afterEach(() => {
  cleanup();
  updateTaxInvoice.mockClear();
  getTaxInvoice.mockClear();
});

function Harness() {
  const { locale, t } = useI18n();
  return (
    <AntApp>
      <TaxInvoiceWorkspace locale={locale} t={t} />
    </AntApp>
  );
}

// 放在 mock 之后 import，否则拿到的是真实 api。
const { TaxInvoiceWorkspace } = await import("./TaxInvoiceWorkspace");

describe("台账行内单元格编辑", () => {
  it("点铅笔进编辑不打开详情，回车只发 {version, 该字段} 最小 patch", async () => {
    render(<Harness />);

    // 按月分组默认全折叠：第一层只有月份行，得先点开「2026-01」这一段，
    // 里面的票（连同可编辑的 incoterms 格）才渲染出来。
    const monthHead = await screen.findByRole("button", { name: /2026-01/ });
    fireEvent.click(monthHead);

    // 展开后这张票的 incoterms 格显示 FCA。
    const cell = await waitFor(() => {
      const value = screen.getByText("FCA");
      const editable = value.closest(".tax-cell-editable");
      if (!editable) throw new Error("incoterms 单元格没渲染成可编辑格");
      return editable as HTMLElement;
    });

    const pencil = cell.querySelector<HTMLButtonElement>(".tax-cell-edit-btn");
    expect(pencil).toBeTruthy();

    fireEvent.click(pencil as HTMLButtonElement);
    // 铅笔 stopPropagation：不该顺带打开详情（不去拉这张票的详情）。
    expect(getTaxInvoice).not.toHaveBeenCalled();

    const input = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>(".tax-cell-edit input");
      if (!el) throw new Error("行内输入框没出现");
      return el;
    });

    fireEvent.change(input, { target: { value: "FOB" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter", keyCode: 13 });

    await waitFor(() => expect(updateTaxInvoice).toHaveBeenCalledTimes(1));
    // 只带 version（这张票当前的 3）和改动的那一个字段，别的一律不带。
    expect(updateTaxInvoice.mock.calls[0][0]).toBe("inv-1");
    expect(updateTaxInvoice.mock.calls[0][1]).toEqual({
      version: 3,
      incoterms: "FOB",
    });
    // 这条要渲染整个工作台 + 展开手风琴 + 改格 + 保存，jsdom 里 antd 组件本就慢，
    // 并行跑整套时 CPU 抢占会超过默认 5s。给足 20s，别在负载下假红。
  }, 20000);
});
