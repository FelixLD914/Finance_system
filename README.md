# ZWT Finance System

ZWT 泰国财务部独立业务系统。首期迁移 WHT 与 TAX INV，并为后续财务模块、
共享数据和相关链接保留可插拔扩展位。

## Repository layout

- `zwt-finance-system/`：正式 React + FastAPI 应用与 Windows 原生发布资料。
- `zwt-finance-ui-prototype/`：已确认的 Warm Ivory Editorial Workspace 交互原型。
- `Sample_previous_code/`：本地只读参考源码与历史样例，不纳入 Git。

## Production boundary

- Windows Server 2016 Standard 1607，纯 Windows 原生服务。
- PostgreSQL 15 与应用同机；数据库与 BOI 系统完全独立。
- FastAPI 由 WinSW 托管，Caddy 仅监听管理员配置的内网非标准 HTTPS 端口。
- IIS 的 80/443 站点和绑定不得修改。
- GitHub `main` 是发布源，服务器只做人工、分目录、可回退发布。

详细开发、运行和发布说明位于 `zwt-finance-system/docs/`。
