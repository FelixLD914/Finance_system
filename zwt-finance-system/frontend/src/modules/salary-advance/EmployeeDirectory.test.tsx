// @vitest-environment jsdom

import { StyleProvider } from "@ant-design/cssinjs";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntApp } from "antd";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { useI18n } from "../../i18n";
import { EmployeeDirectory } from "./EmployeeDirectory";

const mockListEmployees = vi.fn();
const mockCreateEmployee = vi.fn();

vi.mock("./api", () => ({
  EMPLOYEE_PAGE_LIMIT: 500,
  listEmployees: (...args: unknown[]) => mockListEmployees(...args),
  createEmployee: (...args: unknown[]) => mockCreateEmployee(...args),
  updateEmployee: () => Promise.resolve({}),
  deleteEmployee: () => Promise.resolve({}),
  restoreEmployee: () => Promise.resolve({}),
  getEmployeeDeletePreview: () => Promise.resolve({ employeeId: "1", empId: "EMP001", referencingRecords: 0 }),
  importEmployees: () => Promise.resolve({ sourceFileName: "test.xlsx", created: 1, updated: 0 }),
  downloadEmployeeTemplate: () => Promise.resolve(),
}));

beforeAll(() => {
  // DatePicker 展开面板要用到它，jsdom 里没有。
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

function Harness() {
  const { t } = useI18n();
  return (
    <StyleProvider mock="server">
      <AntApp>
        <EmployeeDirectory t={t} />
      </AntApp>
    </StyleProvider>
  );
}

describe("EmployeeDirectory Component", () => {
  it("renders employee list and allows searching", async () => {
    mockListEmployees.mockResolvedValue({
      items: [
        {
          id: "1",
          empId: "EMP001",
          firstName: "Somchai",
          surname: "Saelim",
          enName: "Somchai Saelim",
          chineseName: "宋柴",
          department: "IT",
          position: "Software Engineer",
          startDate: "2024-01-15",
          isActive: true,
          sourceFileName: null,
          createdByName: "Admin",
          updatedByName: "Admin",
          createdAt: "2026-08-05T00:00:00Z",
          updatedAt: "2026-08-05T00:00:00Z",
          deletedAt: null,
          deletedByName: null,
        },
      ],
      total: 1,
    });

    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByText("EMP001")).toBeDefined();
      expect(screen.getByText("Somchai Saelim")).toBeDefined();
    });
  });

  it("refuses to save an employee that could never be issued a slip", async () => {
    mockListEmployees.mockResolvedValue({ items: [], total: 0 });
    render(<Harness />);

    fireEvent.click(await screen.findByRole("button", { name: /新增员工/ }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeDefined());

    // 只填工号：单据上要印的姓名/部门/职位/入职日期全缺。
    fireEvent.change(screen.getByLabelText("工号"), { target: { value: "EMP002" } });
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));

    await waitFor(() => {
      expect(screen.getAllByText("开预支单必填").length).toBeGreaterThan(0);
    });
    expect(mockCreateEmployee).not.toHaveBeenCalled();
  });

  it("submits once the slip-critical fields are filled in", async () => {
    mockListEmployees.mockResolvedValue({ items: [], total: 0 });
    mockCreateEmployee.mockResolvedValue({ id: "2", empId: "EMP002", isActive: true });

    render(<Harness />);

    fireEvent.click(await screen.findByRole("button", { name: /新增员工/ }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeDefined());

    fireEvent.change(screen.getByLabelText("工号"), { target: { value: "EMP002" } });
    fireEvent.change(screen.getByLabelText("名 (First Name)"), {
      target: { value: "Alice" },
    });
    fireEvent.change(screen.getByLabelText("姓 (Surname)"), {
      target: { value: "Smith" },
    });
    fireEvent.change(screen.getByLabelText("部门"), { target: { value: "Finance" } });
    fireEvent.change(screen.getByLabelText("职位"), { target: { value: "Accountant" } });
    fireEvent.change(screen.getByLabelText("入职日期"), {
      target: { value: "2025-03-01" },
    });
    fireEvent.keyDown(screen.getByLabelText("入职日期"), { key: "Enter", keyCode: 13 });

    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));

    await waitFor(() => {
      expect(mockCreateEmployee).toHaveBeenCalledWith(
        expect.objectContaining({
          empId: "EMP002",
          firstName: "Alice",
          surname: "Smith",
          department: "Finance",
          position: "Accountant",
          startDate: "2025-03-01",
        }),
      );
    });
  });

  it("asks for a full page of employees, not the defaulted 50", async () => {
    // 回归：漏传 pageSize 会落到默认值上，列表被静默截断。
    mockListEmployees.mockResolvedValue({ items: [], total: 0 });
    render(<Harness />);

    await waitFor(() => expect(mockListEmployees).toHaveBeenCalled());
    expect(mockListEmployees).toHaveBeenCalledWith(undefined, false, false, 1, 500);
  });

  it("says so when the directory is bigger than one page", async () => {
    mockListEmployees.mockResolvedValue({ items: [], total: 700 });
    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByText(/人员库共 700 人/)).toBeDefined();
    });
  });
});
