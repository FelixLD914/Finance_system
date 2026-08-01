// @vitest-environment jsdom

import { StyleProvider } from "@ant-design/cssinjs";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App as AntApp } from "antd";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { useI18n } from "../../i18n";
import { BatchIssuanceWizard } from "./BatchIssuanceWizard";
import { demoIncomeTypes } from "./sampleData";
import type { BatchCommitInput, BatchPreviewResult } from "./types";

beforeAll(() => {
  // Codex 的 Node 启动参数会注入一个没有可用路径的 localStorage，
  // jsdom 因而留下了对象却没有标准方法。测试只关心语言默认值，用内存桩隔离它。
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

/** 第 2 行收款方在库里，第 3 行不在 —— 核对页两种状态各测一条。 */
const preview: BatchPreviewResult = {
  sourceFileName: "BatchIssue.xlsx",
  rows: [
    {
      rowNumber: 2,
      status: "ready",
      period: "2026-06",
      issuanceType: "normal",
      supplementRun: 0,
      incomeType: "ค่าบริการ",
      paymentDate: "2026-06-05",
      totalAmount: "3000",
      payee: {
        payeeId: "payee-1",
        taxId: "0105540057561",
        nameTh: "บริษัท ทดสอบ จำกัด",
        nameEn: "Test Co., Ltd.",
        addressTh: "99/1 ถนนสุขุมวิท กรุงเทพมหานคร",
        whtType: "PND53",
        branchType: "head_office",
        branchNumber: null,
        isActive: true,
      },
      whtRate: "0.03",
      statutoryRate: "0.03",
      whtAmount: "90.00",
      rateReason: null,
      errors: [],
    },
    {
      rowNumber: 3,
      status: "payee_missing",
      period: "2026-06",
      issuanceType: "normal",
      supplementRun: 0,
      incomeType: "ค่าบริการ",
      paymentDate: "2026-06-08",
      totalAmount: "5000",
      payee: {
        payeeId: null,
        taxId: "0999999999999",
        nameTh: null,
        nameEn: null,
        addressTh: null,
        whtType: null,
        branchType: "none",
        branchNumber: null,
        isActive: true,
      },
      whtRate: null,
      statutoryRate: null,
      whtAmount: null,
      rateReason: null,
      errors: [],
    },
  ],
  ready: 1,
  payeeMissing: 1,
  needsInput: 0,
};

/**
 * `mock="server"` 让 antd 6 的 cssinjs 只算样式、不把 <style> 灌进 document。
 * 原理与实测数据见 IssuanceConsole.test.tsx 的同名 Harness —— 新写 antd 用例照抄它，
 * 否则 jsdom 的线性 CSS 级联会把每次 getByRole 拖到秒级。
 */
function Harness({
  onPreview,
  onCommit,
}: {
  onPreview: (file: File) => Promise<BatchPreviewResult>;
  onCommit: (input: BatchCommitInput) => Promise<never> | Promise<unknown>;
}) {
  const { t } = useI18n();
  return (
    <StyleProvider mock="server">
      <AntApp>
        <BatchIssuanceWizard
          incomeTypes={demoIncomeTypes}
          payees={[]}
          pending={false}
          t={t}
          viewSwitch={null}
          onBackToLedger={vi.fn()}
          onCommit={onCommit as never}
          onPreview={onPreview}
        />
      </AntApp>
    </StyleProvider>
  );
}

const commitResult = {
  sourceFileName: "BatchIssue.xlsx",
  created: 2,
  taskIds: [],
  payeesPending: 1,
};

/** 走到核对步：塞一个文件进 antd Upload 的隐藏 input，再点「读取并核对」。 */
async function reachReviewStep(
  onCommit = vi.fn().mockResolvedValue(commitResult),
  previewResult: BatchPreviewResult = preview,
) {
  const onPreview = vi.fn().mockResolvedValue(previewResult);
  const { container } = render(<Harness onCommit={onCommit} onPreview={onPreview} />);

  const input = container.querySelector('input[type="file"]');
  if (!input) throw new Error("upload input not found");
  fireEvent.change(input, {
    target: { files: [new File(["x"], "BatchIssue.xlsx")] },
  });

  const next = screen.getByRole("button", { name: "读取并核对" });
  await waitFor(() => expect((next as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(next);
  await screen.findByText(new RegExp(`${previewResult.rows.length} 项任务`));
  return { onPreview, onCommit };
}

describe("批量开具向导", () => {
  it("上传只做解析，核对页把每一行摊开", async () => {
    const { onPreview } = await reachReviewStep();

    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".workspace-main.is-review")).toBeTruthy();
    // 汇总条要说清楚有几行要动手，否则人只会盯着表格一行行找。
    const summary = document.querySelector(".wht-review-summary");
    expect(summary?.textContent).toContain("2 项任务");
    expect(summary?.textContent).toContain("可开具 1");
    expect(summary?.textContent).toContain("待补收款方 1");
    // 待办数字才上色；全部就绪时这条汇总应当是安静的。
    expect(summary?.querySelectorAll(".is-todo")).toHaveLength(1);
    expect(screen.getByText("主数据中无此税号")).toBeTruthy();
  });

  it("未匹配税号默认收起，需要维护时再展开，不长期占用表格高度", async () => {
    await reachReviewStep();

    expect(document.querySelector(".wht-payee-maintenance-list")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /展开 1 个税号/ }));
    expect(document.querySelector(".wht-payee-maintenance-list")).toBeTruthy();
    expect(screen.getByRole("button", { name: "维护一次" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /收起维护/ }));
    expect(document.querySelector(".wht-payee-maintenance-list")).toBeNull();
  });

  it("每一行都能打开完整详情，并可连续查看上一份和下一份", async () => {
    await reachReviewStep();

    fireEvent.click(screen.getAllByRole("button", { name: "查看" })[0]);
    const firstTitle = await screen.findByText("第 2 行详情");
    const first = firstTitle.closest(".ant-drawer");
    if (!first) throw new Error("row detail drawer not found");
    const firstDetail = within(first as HTMLElement);
    expect(firstDetail.getByText("BatchIssue.xlsx")).toBeTruthy();
    expect(firstDetail.getByText("99/1 ถนนสุขุมวิท กรุงเทพมหานคร")).toBeTruthy();
    expect(firstDetail.getByText("0105540057561")).toBeTruthy();
    expect(firstDetail.getByText("第 1 / 2 份")).toBeTruthy();

    fireEvent.click(firstDetail.getByRole("button", { name: "下一份" }));
    const secondTitle = await screen.findByText("第 3 行详情");
    const second = secondTitle.closest(".ant-drawer");
    if (!second) throw new Error("next row detail drawer not found");
    expect(within(second as HTMLElement).getByText("0999999999999")).toBeTruthy();
    expect(within(second as HTMLElement).getByText("第 2 / 2 份")).toBeTruthy();
  });

  it("87 条数据按页显示，不会一次全部铺开，并支持按状态筛选", async () => {
    const readyRow = preview.rows[0];
    const manyPreview: BatchPreviewResult = {
      ...preview,
      rows: Array.from({ length: 87 }, (_, index) => ({
        ...readyRow,
        rowNumber: index + 2,
        payee: {
          ...readyRow.payee,
          taxId: String(105540057561 + index).padStart(13, "0"),
        },
      })),
      ready: 87,
      payeeMissing: 0,
      needsInput: 0,
    };

    await reachReviewStep(vi.fn().mockResolvedValue(commitResult), manyPreview);

    expect(await screen.findByText("第 1-10 条，共 87 条")).toBeTruthy();
    expect(document.querySelector(".ant-pagination")).toBeTruthy();
    expect(document.querySelectorAll(".wht-review-table .ant-table-tbody > .ant-table-row"))
      .toHaveLength(10);

    fireEvent.click(screen.getByRole("button", { name: "可开具 87" }));
    expect(screen.getByRole("button", { name: "可开具 87" }).getAttribute("aria-pressed"))
      .toBe("true");
  });

  it("还有行没处理完时不让建草稿", async () => {
    await reachReviewStep();

    const commit = screen.getByRole("button", { name: /建 2 条草稿/ }) as HTMLButtonElement;
    expect(commit.disabled).toBe(true);
  });

  it("补录收款方后那一行立刻带出法定税率并放行", async () => {
    const onCommit = vi.fn().mockResolvedValue(commitResult);
    await reachReviewStep(onCommit);

    fireEvent.click(screen.getByRole("button", { name: /补录收款方/ }));
    const dialog = await screen.findByRole("dialog");
    const fields = within(dialog);

    fireEvent.change(fields.getByLabelText("泰文名称"), {
      target: { value: "บริษัท ใหม่ จำกัด" },
    });
    fireEvent.change(fields.getByLabelText("泰文地址"), {
      target: { value: "กรุงเทพมหานคร" },
    });
    fireEvent.click(fields.getByRole("radio", { name: "PND53" }));
    fireEvent.click(fields.getByRole("button", { name: /保\s*存/ }));

    // 补完就该能提交了 —— 状态是在前端重算的，没有再走一次服务器。
    const commitButton = screen.getByRole("button", {
      name: /建 2 条草稿/,
    }) as HTMLButtonElement;
    await waitFor(() => expect(commitButton.disabled).toBe(false));

    fireEvent.click(commitButton);
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));

    const payload = onCommit.mock.calls[0][0] as BatchCommitInput;
    const [known, added] = payload.rows;
    expect(known.payee.payeeId).toBe("payee-1");
    // 新收款方不带 id：服务端据此知道要在批准时建档。
    expect(added.payee.payeeId).toBeNull();
    expect(added.payee.nameTh).toBe("บริษัท ใหม่ จำกัด");
    expect(added.payee.whtType).toBe("PND53");
    // 表里没填税率，选完 PND53 后由目录带出 3%，提交的是定值而不是 null。
    expect(added.whtRate).toBe(0.03);
  });

  it("提交成功后告诉用户有几个新收款方会在批准时写库", async () => {
    const onCommit = vi.fn().mockResolvedValue(commitResult);
    await reachReviewStep(onCommit);

    fireEvent.click(screen.getByRole("button", { name: /补录收款方/ }));
    const dialog = await screen.findByRole("dialog");
    const fields = within(dialog);
    fireEvent.change(fields.getByLabelText("泰文名称"), {
      target: { value: "บริษัท ใหม่ จำกัด" },
    });
    fireEvent.change(fields.getByLabelText("泰文地址"), {
      target: { value: "กรุงเทพมหานคร" },
    });
    fireEvent.click(fields.getByRole("radio", { name: "PND53" }));
    fireEvent.click(fields.getByRole("button", { name: /保\s*存/ }));

    const commitButton = screen.getByRole("button", {
      name: /建 2 条草稿/,
    }) as HTMLButtonElement;
    await waitFor(() => expect(commitButton.disabled).toBe(false));
    fireEvent.click(commitButton);

    expect(await screen.findByText("已建 2 条草稿")).toBeTruthy();
    expect(
      screen.getByText(/其中 1 条带着新收款方，会在票据批准时写入主数据/),
    ).toBeTruthy();
  });
});
