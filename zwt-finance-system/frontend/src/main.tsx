import React from "react";
import ReactDOM from "react-dom/client";
import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";

import { App } from "./app/App";
import { financeTheme } from "./app/theme";
import { AuthProvider } from "./auth/AuthContext";
// 顺序有意义：tokens.css 必须排在 global.css **之后**。它把 --paper/--surface/
// --line/--camel 这些旧变量名重新指向新的 --finance-* 色板，靠后声明覆盖
// global.css 里的旧硬编码值，legacy 选择器无需逐条改写就能换上新配色。
import "./styles/global.css";
import "./styles/tokens.css";
import "./ui/finance-ui.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={financeTheme}>
      <AntApp>
        <AuthProvider>
          <App />
        </AuthProvider>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);

