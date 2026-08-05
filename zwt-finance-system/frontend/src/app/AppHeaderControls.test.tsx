// @vitest-environment jsdom

import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GlobalSearchModal } from "./GlobalSearchModal";
import { HelpModal } from "./HelpModal";
import { NotificationsDrawer } from "./NotificationsDrawer";
import { resources } from "../i18n";

const t = (key: string) => (resources["zh-CN"] as Record<string, string>)[key] ?? key;

describe("App Header Controls", () => {
  afterEach(() => cleanup());

  it("renders GlobalSearchModal and supports query filtering", () => {
    const onNavigate = vi.fn();
    const onClose = vi.fn();

    render(
      <GlobalSearchModal
        open={true}
        onClose={onClose}
        onNavigate={onNavigate}
        t={t}
      />,
    );

    expect(screen.getByPlaceholderText(/全局搜索功能模块/i)).toBeTruthy();
    expect(screen.getByText("WHT 预扣税单据台账")).toBeTruthy();

    const input = screen.getByPlaceholderText(/全局搜索功能模块/i);
    fireEvent.change(input, { target: { value: "TAX INV" } });

    expect(screen.getByText("TAX INV 税票台账与月份视图")).toBeTruthy();
  });

  it("renders NotificationsDrawer and supports mark as read", () => {
    const onNavigate = vi.fn();
    const onClose = vi.fn();

    render(
      <NotificationsDrawer
        open={true}
        onClose={onClose}
        onNavigate={onNavigate}
        t={t}
      />,
    );

    expect(screen.getByText("系统通知中心")).toBeTruthy();
    expect(screen.getByText("WHT 待复核单据提醒")).toBeTruthy();

    const markReadBtn = screen.getByText("全部已读");
    fireEvent.click(markReadBtn);

    expect(screen.getByText("未读 (0)")).toBeTruthy();
  });

  it("renders HelpModal and displays module business logic and operations", () => {
    const onClose = vi.fn();

    render(<HelpModal open={true} onClose={onClose} t={t} />);

    expect(screen.getByText("ZWT Finance 业务逻辑与操作指南")).toBeTruthy();
    expect(screen.getByText("WHT 预扣税开票管理 (Withholding Tax)")).toBeTruthy();
    expect(screen.getByText("核心业务逻辑与核算规范")).toBeTruthy();
    expect(screen.getByText("标准业务操作流程")).toBeTruthy();

    // Switch tab to TAX INV
    const taxTab = screen.getByText("TAX INV 税票");
    fireEvent.click(taxTab);

    expect(screen.getByText("TAX INV 出口税票管理 (Export Sales Tax Invoice)")).toBeTruthy();
    expect(screen.getByText("单张凭证 18 行商品限制")).toBeTruthy();
  });
});
