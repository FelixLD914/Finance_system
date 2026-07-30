// @vitest-environment jsdom

/**
 * 识别与导入界面：Excel 与 PDF 分成两份清单单独列出，配对结果一组一行。
 *
 * 为什么要有这组测试：配对规则从"文件名同名"改成了"后端按 C/I No. 撮合"，界面
 * 因此必须做到两件事——(1) 未识别前只按类型分两份清单、绝不自作聪明配对；
 * (2) 识别后按后端给的结果一组一行，conflict 组不许进导入。
 * 这两条都在浏览器里才看得见，光靠后端测试盯不住。
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App as AntApp } from "antd";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { useI18n } from "../../i18n";
import type { DualBatchImportResult, DualIdentifyResult } from "./types";

// 这两个真实文件名取自 Sample_reg 归档，刻意保留最容易踩坑的那一组：
// 发票 Excel 与「发票自己的 PDF 打印件」同名，真报关单叫 QECL603151144.pdf。
// 旧的同名规则会把打印件当报关单配上去。
const INVOICE_NAME =
  "3.ZWT：20260123-NOKIA-IV&PL(ZWT-NSB26012304)-120台 WLS604-A-B FCA USD7,077.60.xlsx";
const INVOICE_PRINTOUT = INVOICE_NAME.replace(".xlsx", ".pdf");
const DECLARATION_NAME = "QECL603151144.pdf";

const identifyResult: DualIdentifyResult = {
  readyCount: 1,
  invoiceOnlyCount: 1,
  customsOnlyCount: 0,
  conflictCount: 1,
  rejected: [
    {
      fileName: INVOICE_PRINTOUT,
      kind: "customs",
      reason: "这份 PDF 不像出口报关单（既没有表格编号 กศก. 101/1，也没有报关单号 A…）。",
    },
  ],
  pairs: [
    {
      key: "ZWT-NSB26099999",
      status: "conflict",
      supersededCustomsFileNames: ["A0201690101886.pdf"],
      conflicts: ["同一个 C/I No. 配到了多份**不同**的报关单（A0091690101266、A0201690101886）。"],
      invoice: {
        fileName: "conflict.xlsx",
        ciNo: "ZWT-NSB26099999",
        ciDate: "2026-01-09",
        incoterms: "FCA",
        customerName: "Nokia Solutions and Networks Oy",
        itemCount: 1,
        fobAmountUsd: "172273.68",
        quantityTotal: "7200",
      },
      customs: {
        fileName: "A0091690101266.pdf",
        ciNo: "ZWT-NSB26099999",
        cdn: "A0091690101266",
        declarationRefNo: "DRKW100008659",
        submissionDate: "2026-01-09",
        submissionDateConfidence: "trusted_exact",
        submissionDateLowConfidence: false,
        customsExchangeRate: "31.062700",
        forwarderName: "KUEHNE NAGEL LTD.",
        forwarderNameTh: "บริษัท คูห์เน่ พลัส นาเกิ้ล จำกัด",
        forwarderNameEn: "KUEHNE NAGEL LTD.",
        forwarderTaxNo: "0105528008441",
        customsFobUsdTotal: "172273.68",
        customsFobThbLineTotal: "5351285.64",
        customsFobThbPrintedTotal: "5351285.64",
        warnings: [],
      },
    },
    {
      key: "ZWT-NSB26012304",
      status: "ready",
      supersededCustomsFileNames: [],
      conflicts: [],
      invoice: {
        fileName: INVOICE_NAME,
        ciNo: "ZWT-NSB26012304",
        ciDate: "2026-01-23",
        incoterms: "FCA",
        customerName: "Nokia Solutions and Networks Oy",
        itemCount: 1,
        fobAmountUsd: "7077.60",
        quantityTotal: "120",
      },
      customs: {
        fileName: DECLARATION_NAME,
        ciNo: "ZWT-NSB26012304",
        cdn: "A0231690118554",
        declarationRefNo: "QECL603151144",
        submissionDate: "2026-01-23",
        submissionDateConfidence: "trusted_exact",
        submissionDateLowConfidence: false,
        customsExchangeRate: "31.062700",
        forwarderName: "DHL EXPRESS (THAILAND) LIMITED",
        forwarderNameTh: "บริษัท ดีเอชแอล เอ็กซ์เพรส (ประเทศไทย) จำกัด",
        forwarderNameEn: "DHL EXPRESS (THAILAND) LIMITED",
        forwarderTaxNo: "0105533022910",
        customsFobUsdTotal: "7289.93",
        customsFobThbLineTotal: "226444.91",
        customsFobThbPrintedTotal: "226444.91",
        warnings: [],
      },
    },
    {
      key: "ZWT-NSB26013002",
      status: "invoice_only",
      supersededCustomsFileNames: [],
      conflicts: [],
      invoice: {
        fileName: "pending.xlsx",
        ciNo: "ZWT-NSB26013002",
        ciDate: "2026-01-30",
        incoterms: "FCA",
        customerName: "Nokia Solutions and Networks Oy",
        itemCount: 1,
        fobAmountUsd: "193896.00",
        quantityTotal: "7200",
      },
      customs: null,
    },
  ],
};

// 给足签名，断言时才能直接读 mock.calls 的参数类型（不用 as 硬转）。
const identifyDualFiles =
  vi.fn<(files: File[]) => Promise<DualIdentifyResult>>(async () => identifyResult);
const importDualBatch = vi.fn<
  (files: File[], currency?: string) => Promise<DualBatchImportResult>
>(async () => ({
  batchId: "b1",
  invoiceCount: 1,
  itemCount: 1,
  needsReviewCount: 0,
  results: [
    {
      key: "ZWT-NSB26012304",
      invoiceFileName: INVOICE_NAME,
      customsFileName: DECLARATION_NAME,
      invoiceId: "i1",
      itemCount: 1,
      needsReview: false,
    },
  ],
  rejected: [],
  skipped: [],
}));

// 只替掉这条链路要用的几个导出，其余原样透传。手写一整份 mock 会漏导出
// （首屏还会拉 listRateCurrencies / getBotApiStatus 等），漏一个就整组红。
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    identifyDualFiles,
    importDualBatch,
    listTaxInvoices: async () => ({ items: [], total: 0, page: 1, pageSize: 100 }),
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
    listInvoiceDocuments: async () => [],
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
  identifyDualFiles.mockClear();
  importDualBatch.mockClear();
});

function Harness() {
  const { locale, t } = useI18n();
  return (
    <AntApp>
      <TaxInvoiceWorkspace locale={locale} t={t} />
    </AntApp>
  );
}

// 放在 mock 之后 import，否则拿到的是真实的 api 模块。
const { TaxInvoiceWorkspace } = await import("./TaxInvoiceWorkspace");

function makeFile(name: string): File {
  return new File([new Uint8Array(64)], name);
}

/** 走 antd Upload 的隐藏 input，等价于用户选文件。 */
function dropFiles(files: File[]) {
  const input = document.querySelector(
    ".dual-drop-zone input[type=file]",
  ) as HTMLInputElement;
  expect(input).toBeTruthy();
  fireEvent.change(input, { target: { files } });
}

async function openRecognitionView() {
  render(<Harness />);
  // 台账首屏会去拉列表，等它落定再切页，避免 act 警告。
  await waitFor(() => expect(screen.getByText("识别与导入")).toBeTruthy());
  fireEvent.click(screen.getByText("识别与导入"));
  await waitFor(() => expect(document.querySelector(".dual-drop-zone")).toBeTruthy());
}

describe("识别与导入：两份清单", () => {
  it("同名的 Excel 与 PDF 不会被自作聪明配成一组，只按类型分两份清单", async () => {
    await openRecognitionView();
    dropFiles([
      makeFile(INVOICE_NAME),
      makeFile(INVOICE_PRINTOUT),
      makeFile(DECLARATION_NAME),
    ]);

    const columns = await waitFor(() => {
      const found = document.querySelectorAll(".dual-file-column");
      if (found.length < 2) throw new Error("两份清单没渲染出来");
      return found;
    });

    const excelColumn = within(columns[0] as HTMLElement);
    const pdfColumn = within(columns[1] as HTMLElement);
    // Excel 清单只有一份 xlsx；那份同名的 PDF 属于 PDF 清单，绝不能进 Excel 清单。
    expect(excelColumn.getByText(INVOICE_NAME)).toBeTruthy();
    expect(excelColumn.queryByText(INVOICE_PRINTOUT)).toBeNull();
    // PDF 清单两份都在，界面这一层不判断哪份才是真报关单——那是后端的事。
    expect(pdfColumn.getByText(INVOICE_PRINTOUT)).toBeTruthy();
    expect(pdfColumn.getByText(DECLARATION_NAME)).toBeTruthy();

    // 还没识别，就不该出现任何配对行。
    expect(document.querySelectorAll(".dual-pair-row")).toHaveLength(0);
  });

  it("识别前不调用导入接口；点识别才把整批发给后端", async () => {
    await openRecognitionView();
    dropFiles([makeFile(INVOICE_NAME), makeFile(DECLARATION_NAME)]);
    await waitFor(() => expect(document.querySelectorAll(".dual-file-column")).toHaveLength(2));
    expect(identifyDualFiles).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /并按 C\/I No\. 配对/ }));
    await waitFor(() => expect(identifyDualFiles).toHaveBeenCalledTimes(1));
    expect(identifyDualFiles.mock.calls[0][0]).toHaveLength(2);
  });
});

describe("识别与导入：配对结果", () => {
  it("一组一行，并把关单侧核对字段摆出来", async () => {
    await openRecognitionView();
    dropFiles([makeFile(INVOICE_NAME), makeFile(DECLARATION_NAME)]);
    fireEvent.click(await screen.findByRole("button", { name: /并按 C\/I No\. 配对/ }));

    const rows = await waitFor(() => {
      const found = document.querySelectorAll(".dual-pair-row");
      if (found.length !== 3) throw new Error(`配对行数 ${found.length}，期望 3`);
      return found;
    });

    // conflict 排最前：不处理就会被埋在后面。
    expect((rows[0] as HTMLElement).className).toContain("is-conflict");
    const ready = within(rows[1] as HTMLElement);
    expect(ready.getByText(INVOICE_NAME)).toBeTruthy();
    expect(ready.getByText(DECLARATION_NAME)).toBeTruthy();
    // 海关汇率与货代名称要能在配对行上直接看到，不用点进去。
    expect(ready.getByText(/31\.062700/)).toBeTruthy();
    expect(ready.getByText(/DHL EXPRESS \(THAILAND\) LIMITED/)).toBeTruthy();

    // 待补关单那组要明确写出来，不能只留空白。
    expect(within(rows[2] as HTMLElement).getByText(/待补关单|未配到/)).toBeTruthy();
  });

  it("被拒的文件必须有说明，不能静默消失", async () => {
    await openRecognitionView();
    dropFiles([makeFile(INVOICE_NAME), makeFile(INVOICE_PRINTOUT)]);
    fireEvent.click(await screen.findByRole("button", { name: /并按 C\/I No\. 配对/ }));

    await waitFor(() => expect(document.querySelectorAll(".dual-pair-row").length).toBe(3));
    const rejected = document.querySelector(".dual-reject-list");
    expect(rejected).toBeTruthy();
    expect(rejected?.textContent).toContain(INVOICE_PRINTOUT);
    expect(rejected?.textContent).toContain("不像出口报关单");
  });

  it("conflict 组不参与导入：按钮上的组数排掉它", async () => {
    await openRecognitionView();
    dropFiles([makeFile(INVOICE_NAME), makeFile(DECLARATION_NAME)]);
    fireEvent.click(await screen.findByRole("button", { name: /并按 C\/I No\. 配对/ }));
    await waitFor(() => expect(document.querySelectorAll(".dual-pair-row").length).toBe(3));

    // 后端回了 3 组：1 conflict + 1 ready + 1 待补关单。按钮上的数字就是"会真的
    // 导几组"，必须是 2——conflict 组被排掉。直接断言按钮文案而不是真跑一遍导入：
    // 导入是串行 await + antd 提示动画，在 jsdom 里跑完要好几秒，断言的又不是它。
    expect(await screen.findByRole("button", { name: /开始识别 2 组/ })).toBeTruthy();
    // conflict 组的冲突说明必须显示出来，否则用户不知道为什么少导了一组。
    const conflictRow = document.querySelector(".dual-pair-row.is-conflict");
    expect(conflictRow?.textContent).toContain("多份");
  });
});
