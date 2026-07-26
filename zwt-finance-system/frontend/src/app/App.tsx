import { useState } from "react";
import { Empty } from "antd";

import { useI18n } from "../i18n";
import type { ModuleKey } from "../modules/registry";
import { TaxInvoiceWorkspace } from "../modules/tax-invoice/TaxInvoiceWorkspace";
import { WhtWorkspace } from "../modules/wht/WhtWorkspace";
import { AppShell } from "./AppShell";

export function App() {
  const { locale, t, toggleLocale } = useI18n();
  const [activeModule, setActiveModule] = useState<ModuleKey>("wht");
  const [collapsed, setCollapsed] = useState(false);

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
        <WhtWorkspace t={t} />
      ) : activeModule === "tax-invoice" ? (
        <TaxInvoiceWorkspace t={t} />
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
