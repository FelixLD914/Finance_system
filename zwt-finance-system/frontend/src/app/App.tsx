import { useState } from "react";
import { Empty, Spin } from "antd";

import { useAuth } from "../auth/AuthContext";
import { LoginScreen } from "../auth/LoginScreen";
import { useI18n } from "../i18n";
import type { ModuleKey } from "../modules/registry";
import { AdministrationWorkspace } from "../modules/administration/AdministrationWorkspace";
import { TaxInvoiceWorkspace } from "../modules/tax-invoice/TaxInvoiceWorkspace";
import { WhtWorkspace } from "../modules/wht/WhtWorkspace";
import { AppShell } from "./AppShell";

export function App() {
  const { locale, t, toggleLocale } = useI18n();
  const { user, initializing } = useAuth();
  const [activeModule, setActiveModule] = useState<ModuleKey>("wht");
  const [collapsed, setCollapsed] = useState(false);

  // 首次挂载时仍在向后端确认会话。这里直接渲染登录页的话，
  // 已登录用户每次刷新都会看到登录界面闪一下。
  if (initializing) {
    return (
      <main className="app-bootstrap">
        {/* antd 6 里 Spin 的 tip 已弃用，改用 description。 */}
        <Spin size="large" description="正在确认登录状态" />
      </main>
    );
  }

  if (user === null) {
    return <LoginScreen />;
  }

  return (
    <AppShell
      activeModule={activeModule}
      collapsed={collapsed}
      locale={locale}
      onModuleChange={setActiveModule}
      onToggleCollapsed={() => setCollapsed((current) => !current)}
      onToggleLocale={toggleLocale}
      t={t}
    >
      {activeModule === "wht" ? (
        <WhtWorkspace locale={locale} t={t} />
      ) : activeModule === "tax-invoice" ? (
        <TaxInvoiceWorkspace locale={locale} t={t} />
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
    </AppShell>
  );
}
