import type { ThemeConfig } from "antd";

export const financeTheme: ThemeConfig = {
  cssVar: { key: "zwt-finance" },
  token: {
    colorPrimary: "#a87349",
    colorInfo: "#315b78",
    colorSuccess: "#55764a",
    colorWarning: "#b57627",
    colorError: "#a7473f",
    colorText: "#24211e",
    colorTextSecondary: "#746b62",
    colorBorder: "#ded6cc",
    colorBgBase: "#f7f3ed",
    colorBgContainer: "#fffdf9",
    borderRadius: 8,
    borderRadiusLG: 12,
    controlHeight: 40,
    fontFamily: "var(--font-ui)",
    fontSize: 14,
    boxShadowSecondary: "0 18px 45px rgba(62, 47, 34, 0.12)",
  },
  components: {
    Button: {
      primaryShadow: "none",
      fontWeight: 600,
      defaultBg: "#fffdf9",
      defaultBorderColor: "#d9d0c6",
    },
    Input: {
      activeShadow: "0 0 0 2px rgba(168, 115, 73, 0.12)",
      hoverBorderColor: "#b78862",
    },
    Select: {
      activeBorderColor: "#a87349",
      activeOutlineColor: "rgba(168, 115, 73, 0.12)",
    },
    Table: {
      headerBg: "#f6f1eb",
      headerColor: "#655b52",
      rowHoverBg: "#faf5ef",
      borderColor: "#ebe3da",
      cellPaddingBlock: 14,
      cellPaddingInline: 10,
    },
    Menu: {
      itemBg: "transparent",
      itemSelectedBg: "#eee8e1",
      itemSelectedColor: "#24211e",
      itemBorderRadius: 8,
      itemHeight: 46,
    },
    Modal: {
      contentBg: "#fffdf9",
      headerBg: "#fffdf9",
    },
  },
};
