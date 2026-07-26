import type { PropsWithChildren } from "react";
import {
  BellOutlined,
  DownOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  QuestionCircleOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { Avatar, Button, Menu, Tooltip } from "antd";

import type { Locale, Translate } from "../i18n";
import { financeModules, type ModuleKey } from "../modules/registry";

interface AppShellProps extends PropsWithChildren {
  activeModule: ModuleKey;
  collapsed: boolean;
  locale: Locale;
  onModuleChange: (key: ModuleKey) => void;
  onToggleCollapsed: () => void;
  onToggleLocale: () => void;
  t: Translate;
}

export function AppShell({
  activeModule,
  children,
  collapsed,
  locale,
  onModuleChange,
  onToggleCollapsed,
  onToggleLocale,
  t,
}: AppShellProps) {
  const menuItems = financeModules
    .filter((module) => module.enabled)
    .map((module) => ({
      key: module.key,
      icon: module.icon,
      label: t(module.labelKey),
    }));

  return (
    <div className={`app-shell ${collapsed ? "is-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="brand" aria-label="ZWT Finance">
          <span className="brand-zwt">ZWT</span>
          {!collapsed && <span className="brand-finance">Finance</span>}
        </div>
        <Menu
          className="module-menu"
          mode="inline"
          inlineCollapsed={collapsed}
          selectedKeys={[activeModule]}
          items={menuItems}
          onSelect={({ key }) => onModuleChange(key as ModuleKey)}
        />
      </aside>

      <header className="topbar">
        <Tooltip title={t("common.collapse")}>
          <Button
            aria-label={t("common.collapse")}
            className="icon-button"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            type="text"
            onClick={onToggleCollapsed}
          />
        </Tooltip>
        <div className="topbar-actions">
          <Tooltip title={t("common.search")}>
            <Button className="icon-button" icon={<SearchOutlined />} type="text" />
          </Tooltip>
          <Tooltip title={t("common.notifications")}>
            <Button className="icon-button notification-button" icon={<BellOutlined />} type="text">
              <span className="notification-dot" />
            </Button>
          </Tooltip>
          <Tooltip title={t("common.help")}>
            <Button className="icon-button" icon={<QuestionCircleOutlined />} type="text" />
          </Tooltip>
          <Button className="language-button" type="text" onClick={onToggleLocale}>
            {t("common.language")}
          </Button>
          <span className="topbar-divider" />
          <button className="profile-button" type="button">
            <Avatar className="profile-avatar">SP</Avatar>
            <span className="profile-copy">
              <strong>Supaporn P.</strong>
              <small>{t("role.supervisor")}</small>
            </span>
            <DownOutlined />
          </button>
        </div>
      </header>

      <main className="main-region" lang={locale}>
        {children}
      </main>
    </div>
  );
}

