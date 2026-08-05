import { useState } from "react";
import { ConfigProvider, Empty, Spin } from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";

import { useAuth } from "../auth/AuthContext";
import { LoginScreen } from "../auth/LoginScreen";
import { useI18n } from "../i18n";
import type { ModuleKey } from "../modules/registry";
import { AdministrationWorkspace } from "../modules/administration/AdministrationWorkspace";
import { SalaryAdvanceWorkspace } from "../modules/salary-advance/SalaryAdvanceWorkspace";
import { TaxInvoiceWorkspace } from "../modules/tax-invoice/TaxInvoiceWorkspace";
import { WhtWorkspace } from "../modules/wht/WhtWorkspace";
import { AppShell } from "./AppShell";
import { GlobalSearchModal } from "./GlobalSearchModal";
import { HelpModal } from "./HelpModal";
import { NotificationsDrawer } from "./NotificationsDrawer";
import { financeTheme } from "./theme";

export function App() {
  const { locale, t, toggleLocale } = useI18n();
  const { user, initializing } = useAuth();
  const [activeModule, setActiveModule] = useState<ModuleKey>("wht");
  const [collapsed, setCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const antdLocale = locale === "en-US" ? enUS : zhCN;

  // 首次挂载时仍在向后端确认会话。这里直接渲染登录页的话，
  // 已登录用户每次刷新都会看到登录界面闪一下。
  if (initializing) {
    return (
      <ConfigProvider locale={antdLocale} theme={financeTheme}>
        <main className="app-bootstrap">
          {/* antd 6 里 Spin 的 tip 已弃用，改用 description。 */}
          <Spin size="large" description={t("common.loadFailed") ? (locale === "en-US" ? "Checking login status..." : "正在确认登录状态") : "正在确认登录状态"} />
        </main>
      </ConfigProvider>
    );
  }

  if (user === null) {
    // 登录页也要能切语言：useI18n 的状态在这一层，直接把 t 和 toggle 传下去，
    // 不必为了一个页面再包一层 context。
    return (
      <ConfigProvider locale={antdLocale} theme={financeTheme}>
        <LoginScreen onToggleLocale={toggleLocale} t={t} />
      </ConfigProvider>
    );
  }

  return (
    <ConfigProvider locale={antdLocale} theme={financeTheme}>
      <AppShell
        activeModule={activeModule}
        collapsed={collapsed}
        locale={locale}
        onModuleChange={setActiveModule}
        onToggleCollapsed={() => setCollapsed((current) => !current)}
        onToggleLocale={toggleLocale}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenNotifications={() => setNotificationsOpen(true)}
        onOpenHelp={() => setHelpOpen(true)}
        t={t}
      >
        {activeModule === "wht" ? (
          <WhtWorkspace locale={locale} t={t} />
        ) : activeModule === "tax-invoice" ? (
          <TaxInvoiceWorkspace locale={locale} t={t} />
        ) : activeModule === "salary-advance" ? (
          <SalaryAdvanceWorkspace t={t} />
        ) : activeModule === "administration" ? (
          <AdministrationWorkspace t={t} />
        ) : (
          <section className="module-placeholder">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <div>
                  <h1>{t("placeholder.title")}</h1>
                  <p>{t("placeholder.body")}</p>
                </div>
              }
            />
          </section>
        )}

        <GlobalSearchModal
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          onNavigate={setActiveModule}
          t={t}
        />

        <NotificationsDrawer
          open={notificationsOpen}
          onClose={() => setNotificationsOpen(false)}
          onNavigate={setActiveModule}
          t={t}
        />

        <HelpModal
          open={helpOpen}
          onClose={() => setHelpOpen(false)}
          t={t}
        />
      </AppShell>
    </ConfigProvider>
  );
}

