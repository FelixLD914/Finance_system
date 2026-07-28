import { useState } from "react";

import type { Translate } from "../../i18n";
import { SignatureLibrary } from "./SignatureLibrary";

type AdminView = "signatures";

/**
 * 系统管理。
 *
 * 签名图库原来挂在 WHT 模块下，但它是 WHT 与 TAX INV 共用的资产
 * （见 SignatureAsset.usage），放在其中一个业务模块里会让人以为改动只影响那一边。
 * 它同时也是权限最敏感的一项——signature:manage 只给 admin，决定正式文件上
 * 出现谁的名字——所以归到系统管理下维护。
 */
export function AdministrationWorkspace({ t }: { t: Translate }) {
  const [view] = useState<AdminView>("signatures");

  return (
    <section className="workspace-main" aria-label={t("nav.administration")}>
      <div className="page-heading">
        <div>
          <h1>
            <span>{t("nav.administration")}</span>
            <small>{t("admin.title")}</small>
          </h1>
          <div className="workspace-view-switch" role="tablist">
            <button className="is-active" type="button">
              {t("wht.signatureLibrary")}
            </button>
          </div>
        </div>
      </div>
      <p className="admin-intro">{t("admin.signatureScopeHint")}</p>
      {view === "signatures" && <SignatureLibrary t={t} />}
    </section>
  );
}
