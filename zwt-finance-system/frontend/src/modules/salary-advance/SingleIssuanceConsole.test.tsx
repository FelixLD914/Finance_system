// @vitest-environment jsdom

import { StyleProvider } from "@ant-design/cssinjs";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntApp } from "antd";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SingleIssuanceConsole } from "./SingleIssuanceConsole";

const mockListEmployees = vi.fn();
const mockCreateSingleRecord = vi.fn();

vi.mock("./api", () => ({
  EMPLOYEE_PAGE_LIMIT: 500,
  listEmployees: (...args: unknown[]) => mockListEmployees(...args),
  createSingleSalaryAdvanceRecord: (...args: unknown[]) => mockCreateSingleRecord(...args),
}));

beforeAll(() => {
  class MockResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as Record<string, unknown>).ResizeObserver = MockResizeObserver;
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
  vi.resetAllMocks();
});

describe("SingleIssuanceConsole", () => {
  it("renders single issuance console and triggers cancel", async () => {
    mockListEmployees.mockResolvedValue({
      items: [
        {
          id: "emp-1",
          empId: "EMP001",
          enName: "Somchai Saelim",
          chineseName: "宋柴",
          department: "Engineering",
          position: "Senior Developer",
          startDate: "2023-01-15",
          isActive: true,
        },
      ],
      total: 1,
    });

    const handleSuccess = vi.fn();
    const handleClose = vi.fn();

    render(
      <StyleProvider mock="server">
        <AntApp>
          <SingleIssuanceConsole open={true} onClose={handleClose} onSuccess={handleSuccess} />
        </AntApp>
      </StyleProvider>,
    );

    expect(screen.getByText("单张开具工资预支单")).toBeDefined();

    await waitFor(() => {
      expect(mockListEmployees).toHaveBeenCalled();
    });

    const cancelBtn = screen.getByRole("button", { name: /取\s*消/i });
    fireEvent.click(cancelBtn);

    expect(handleClose).toHaveBeenCalled();
  });

  it("asks for a full page of employees, not the defaulted 50", async () => {
    // 回归：本来只传了 2 个参数，pageSize 落到默认 50 上——
    // 第 51 个员工开不了单，界面上还看不出来。
    mockListEmployees.mockResolvedValue({ items: [], total: 0 });

    render(
      <StyleProvider mock="server">
        <AntApp>
          <SingleIssuanceConsole open onClose={vi.fn()} onSuccess={vi.fn()} />
        </AntApp>
      </StyleProvider>,
    );

    await waitFor(() => expect(mockListEmployees).toHaveBeenCalled());
    expect(mockListEmployees).toHaveBeenCalledWith(undefined, true, false, 1, 500);
  });

  it("warns instead of silently hiding employees beyond the first page", async () => {
    mockListEmployees.mockResolvedValue({
      items: [{ id: "e1", empId: "EMP001", enName: "Somchai", isActive: true }],
      total: 640,
    });

    render(
      <StyleProvider mock="server">
        <AntApp>
          <SingleIssuanceConsole open onClose={vi.fn()} onSuccess={vi.fn()} />
        </AntApp>
      </StyleProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText(/人员库共 640 人/)).toBeDefined();
    });
  });
});
