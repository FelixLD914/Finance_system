// @vitest-environment jsdom

import { StyleProvider } from "@ant-design/cssinjs";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntApp } from "antd";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { useI18n } from "../../i18n";
import { SalaryAdvanceWorkspace } from "./SalaryAdvanceWorkspace";
import type { SignatureAsset } from "../wht/types";
import type { SalaryAdvanceBatchDetail } from "./types";

const mockListSignatures = vi.fn();
const mockListBatches = vi.fn();
const mockGetBatch = vi.fn();
const mockLockBatch = vi.fn();
const mockCreateJob = vi.fn();
const mockListJobs = vi.fn();
const mockGetJob = vi.fn();

vi.mock("../wht/api", () => ({
  listSignatures: (...args: unknown[]) => mockListSignatures(...args),
}));

vi.mock("./api", () => ({
  listSalaryAdvanceBatches: (...args: unknown[]) => mockListBatches(...args),
  getSalaryAdvanceBatch: (...args: unknown[]) => mockGetBatch(...args),
  lockSalaryAdvanceBatch: (...args: unknown[]) => mockLockBatch(...args),
  createSalaryAdvanceJob: (...args: unknown[]) => mockCreateJob(...args),
  listSalaryAdvanceJobs: (...args: unknown[]) => mockListJobs(...args),
  getSalaryAdvanceJob: (...args: unknown[]) => mockGetJob(...args),
  importSalaryAdvanceBatch: vi.fn(),
  updateSalaryAdvanceRecord: vi.fn(),
  revalidateSalaryAdvanceBatch: vi.fn(),
  deleteSalaryAdvanceBatch: vi.fn(),
  retrySalaryAdvanceJob: vi.fn(),
  downloadImportTemplate: vi.fn(),
  downloadValidationReport: vi.fn(),
  previewSalaryAdvanceRecord: vi.fn(),
  downloadJobArtifact: vi.fn(),
  downloadSalaryAdvanceDocument: vi.fn(),
}));

const mockSignatures: SignatureAsset[] = [
  {
    id: "sig-fin-1",
    name: "财务第一章",
    originalFileName: "fin1.png",
    mimeType: "image/png",
    sha256: "111",
    version: 1,
    status: "active",
    usage: ["salary_advance_finance"],
    signerName: "张财务",
    isDefault: true,
    createdByName: "admin",
    updatedByName: "admin",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    deletedAt: null,
    deletedByName: null,
  },
  {
    id: "sig-md-1",
    name: "董事章",
    originalFileName: "md1.png",
    mimeType: "image/png",
    sha256: "222",
    version: 1,
    status: "active",
    usage: ["salary_advance_md"],
    signerName: "李董事",
    isDefault: true,
    createdByName: "admin",
    updatedByName: "admin",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    deletedAt: null,
    deletedByName: null,
  },
];

const mockBatchDetail: SalaryAdvanceBatchDetail = {
  batch: {
    id: "batch-1",
    batchNo: "SA202608-001",
    period: "202608",
    sourceFileName: "salary.xlsx",
    sourceSha256: "hash123",
    status: "ready",
    totalRows: 5,
    validRows: 5,
    warningRows: 0,
    invalidRows: 0,
    createdByName: "admin",
    lockedByName: null,
    createdAt: "2026-08-01T00:00:00Z",
    lockedAt: null,
  },
  records: [],
};

beforeAll(() => {
  globalThis.ResizeObserver ??= class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const storage = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
      clear: () => storage.clear(),
    },
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }),
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function Harness() {
  const { t } = useI18n();
  return (
    <StyleProvider mock="server">
      <AntApp>
        <SalaryAdvanceWorkspace t={t} />
      </AntApp>
    </StyleProvider>
  );
}

describe("SalaryAdvanceWorkspace 签名选择与批量批准开具", () => {
  it("调用 listSignatures(false, 'salary_advance') 获取签名列表", async () => {
    mockListBatches.mockResolvedValue([mockBatchDetail.batch]);
    mockGetBatch.mockResolvedValue(mockBatchDetail);
    mockListSignatures.mockResolvedValue(mockSignatures);
    mockListJobs.mockResolvedValue([]);

    render(<Harness />);

    await waitFor(() => {
      expect(mockListSignatures).toHaveBeenCalledWith(false, "salary_advance");
    });
  });

  it("点击「批量批准开具」能打开弹窗，自动锁定批次并创建生成任务", async () => {
    mockListBatches.mockResolvedValue([mockBatchDetail.batch]);
    mockGetBatch.mockResolvedValue(mockBatchDetail);
    mockListSignatures.mockResolvedValue(mockSignatures);
    mockListJobs.mockResolvedValue([]);
    mockLockBatch.mockResolvedValue({
      ...mockBatchDetail.batch,
      status: "locked",
    });
    mockCreateJob.mockResolvedValue({
      id: "job-1",
      batchId: "batch-1",
      templateId: "tpl-1",
      status: "queued",
      totalCount: 5,
      successCount: 0,
      failedCount: 0,
      requestedByName: "admin",
      financeSignatureId: "sig-fin-1",
      mdSignatureId: "sig-md-1",
      startedAt: null,
      finishedAt: null,
      errorSummary: null,
    });
    mockGetJob.mockResolvedValue({
      job: {
        id: "job-1",
        batchId: "batch-1",
        templateId: "tpl-1",
        status: "queued",
        totalCount: 5,
        successCount: 0,
        failedCount: 0,
        requestedByName: "admin",
        startedAt: null,
        finishedAt: null,
        errorSummary: null,
      },
      documents: [],
    });

    render(<Harness />);

    // 等待批次数据加载
    await screen.findAllByText(/SA202608-001/);

    // 点击 批量批准开具 按钮
    const btn = await screen.findByRole("button", { name: /批量批准开具/ });
    fireEvent.click(btn);

    // 校验弹窗出现
    await screen.findByText("选择签名资产并生成凭证");

    // 点击 确认 按钮
    const confirmBtn = screen.getByRole("button", { name: /确 认/ });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockLockBatch).toHaveBeenCalledWith("batch-1");
      expect(mockCreateJob).toHaveBeenCalledWith(
        "batch-1",
        expect.objectContaining({
          financeSignatureId: "sig-fin-1",
          mdSignatureId: "sig-md-1",
        }),
      );
    });
  });
});
