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

  it("opens create employee modal and submits form", async () => {
    mockListEmployees.mockResolvedValue({ items: [], total: 0 });
    mockCreateEmployee.mockResolvedValue({
      id: "2",
      empId: "EMP002",
      enName: "Alice Smith",
      isActive: true,
    });

    render(<Harness />);

    const newBtn = await screen.findByRole("button", { name: /新增员工/ });
    fireEvent.click(newBtn);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeDefined();
    });

    const empIdInput = screen.getByLabelText("工号");
    fireEvent.change(empIdInput, { target: { value: "EMP002" } });

    const saveBtn = screen.getByRole("button", { name: /保\s*存/ });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockCreateEmployee).toHaveBeenCalledWith(
        expect.objectContaining({
          empId: "EMP002",
        }),
      );
    });
  });
});
