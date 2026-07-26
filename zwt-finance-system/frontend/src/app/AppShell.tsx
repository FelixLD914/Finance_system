import type { PropsWithChildren } from "react";
import {
  BellOutlined,
  DownOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  QuestionCircleOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { Avatar, Button, Dropdown, Menu, Tooltip } from "antd";

import { useAuth } from "../auth/AuthContext";
import type { Locale, Translate } from "../i18n";
import { financeModules, type ModuleKey } from "../modules/registry";

/** 头像缩写：中文名取姓，拉丁名取首字母缩写。 */
function avatarInitials(displayName: string): string {
  const trimmed = displayName.trim();
  if (trimmed === "") return "?";
  if (/[一-鿿]/.test(trimmed)) return trimmed.slice(0, 1);
  return trimmed
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

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
  const { user, logout } = useAuth();
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
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [
                {
                  key: "username",
                  label: user?.username ?? "",
                  disabled: true,
                },
                { type: "divider" },
                {
                  key: "logout",
                  icon: <LogoutOutlined />,
                  label: "退出登录",
                  danger: true,
                  onClick: () => void logout(),
                },
              ],
            }}
          >
            <button className="profile-button" type="button">
              <Avatar className="profile-avatar">
                {avatarInitials(user?.displayName ?? "")}
              </Avatar>
              <span className="profile-copy">
                {/* 显示真实登录用户：这个名字同时也是写进审计记录的 actor_name。 */}
                <strong>{user?.displayName ?? ""}</strong>
                <small>{user?.role ?? ""}</small>
              </span>
              <DownOutlined />
            </button>
          </Dropdown>
        </div>
      </header>

      <main className="main-region" lang={locale}>
        {children}
      </main>
    </div>
  );
}

