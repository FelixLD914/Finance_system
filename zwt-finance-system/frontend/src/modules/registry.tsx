import type { ReactNode } from "react";
import {
  AppstoreOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  HomeOutlined,
  LinkOutlined,
  SettingOutlined,
  WalletOutlined,
} from "@ant-design/icons";

import type { TranslationKey } from "../i18n";

export type ModuleKey =
  | "home"
  | "wht"
  | "tax-invoice"
  | "salary-advance"
  | "shared-data"
  | "related-links"
  | "administration";

export interface FinanceModule {
  key: ModuleKey;
  labelKey: TranslationKey;
  icon: ReactNode;
  enabled: boolean;
}

export const financeModules: FinanceModule[] = [
  { key: "home", labelKey: "nav.home", icon: <HomeOutlined />, enabled: true },
  { key: "wht", labelKey: "nav.wht", icon: <FileTextOutlined />, enabled: true },
  {
    key: "tax-invoice",
    labelKey: "nav.taxInvoice",
    icon: <FileTextOutlined />,
    enabled: true,
  },
  {
    key: "salary-advance",
    labelKey: "nav.salaryAdvance",
    icon: <WalletOutlined />,
    enabled: import.meta.env.VITE_SALARY_ADVANCE_ENABLED !== "false",
  },
  {
    key: "shared-data",
    labelKey: "nav.sharedData",
    icon: <DatabaseOutlined />,
    enabled: true,
  },
  {
    key: "related-links",
    labelKey: "nav.relatedLinks",
    icon: <LinkOutlined />,
    enabled: true,
  },
  {
    key: "administration",
    labelKey: "nav.administration",
    icon: <SettingOutlined />,
    enabled: true,
  },
];

export const homeModuleIcon = <AppstoreOutlined />;

