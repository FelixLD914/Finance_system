import type { ThemeConfig } from "antd";

export const financeTheme: ThemeConfig = {
  cssVar: { key: "zwt-finance" },
  token: {
    colorPrimary: "#875334",
    colorPrimaryHover: "#6f4126",
    colorPrimaryActive: "#5f351e",
    colorInfo: "#315b78",
    colorSuccess: "#32613e",
    colorWarning: "#8a571b",
    colorError: "#8b3a36",
    colorText: "#222222",
    colorTextSecondary: "#5f5d59",
    colorBorder: "#d9d7d2",
    colorBgBase: "#f6f6f4",
    colorBgContainer: "#ffffff",
    borderRadius: 6,
    borderRadiusLG: 8,
    controlHeight: 32,
    fontFamily: "var(--font-ui)",
    fontSize: 14,
    boxShadowSecondary: "0 4px 8px rgba(34, 34, 34, 0.10)",
  },
  components: {
    Button: {
      primaryShadow: "none",
      fontWeight: 600,
      defaultBg: "#ffffff",
      defaultBorderColor: "#d9d7d2",
    },
    Input: {
      activeShadow: "0 0 0 2px rgba(135, 83, 52, 0.18)",
      hoverBorderColor: "#875334",
    },
    Select: {
      activeBorderColor: "#875334",
      activeOutlineColor: "rgba(135, 83, 52, 0.18)",
    },
    Table: {
      headerBg: "#f1f0ed",
      headerColor: "#5f5d59",
      rowHoverBg: "#f8f5f2",
      borderColor: "#e7e4df",
      cellPaddingBlock: 9,
      cellPaddingInline: 10,
    },
    Menu: {
      itemBg: "transparent",
      itemSelectedBg: "#e7e1dc",
      itemSelectedColor: "#222222",
      itemBorderRadius: 6,
      itemHeight: 40,
    },
    Modal: {
      contentBg: "#ffffff",
      headerBg: "#ffffff",
    },
    Drawer: {
      colorBgElevated: "#ffffff",
    },
  },
};
