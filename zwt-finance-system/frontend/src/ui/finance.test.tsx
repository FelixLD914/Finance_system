// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FinanceStatusBadge, FinanceTabs } from "./finance";

describe("finance UI primitives", () => {
  it("renders semantic status tone classes", () => {
    render(<FinanceStatusBadge label="待复核" tone="warning" />);

    const badge = screen.getByText("待复核");
    expect(badge.classList.contains("finance-status-badge")).toBe(true);
    expect(badge.classList.contains("is-warning")).toBe(true);
  });

  it("changes lifecycle tabs without losing their counts", () => {
    const onChange = vi.fn();
    render(
      <FinanceTabs
        activeKey="pending"
        ariaLabel="WHT 生命周期"
        items={[
          { key: "pending", label: "待处理", count: 6 },
          { key: "issuing", label: "待出具", count: 2 },
        ]}
        onChange={onChange}
      />,
    );

    expect(
      screen.getByRole("button", { name: "待处理6" }).getAttribute("aria-current"),
    ).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: "待出具2" }));
    expect(onChange).toHaveBeenCalledWith("issuing");
  });
});
