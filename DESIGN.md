---
name: ZWT Finance UI System
description: Dense, restrained and audit-friendly finance workspaces for WHT and TAX INV.
colors:
  primary: "#875334"
  primary-hover: "#6F4126"
  canvas: "#F6F6F4"
  surface: "#FFFFFF"
  surface-muted: "#F1F0ED"
  sidebar: "#EFEEEA"
  text: "#222222"
  text-muted: "#5F5D59"
  border: "#D9D7D2"
  selected: "#F3ECE7"
  success-text: "#32613E"
  success-bg: "#EDF5EF"
  warning-text: "#8A571B"
  warning-bg: "#FFF4E5"
  danger-text: "#8B3A36"
  danger-bg: "#FCEFED"
  info-text: "#365D78"
  info-bg: "#EDF4F8"
typography:
  headline:
    fontFamily: "DM Sans, Noto Sans SC Variable, Microsoft YaHei UI, sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  title:
    fontFamily: "DM Sans, Noto Sans SC Variable, Microsoft YaHei UI, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.4
  body:
    fontFamily: "DM Sans, Noto Sans SC Variable, Microsoft YaHei UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "DM Sans, Noto Sans SC Variable, Microsoft YaHei UI, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.4
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  xxl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    height: "32px"
    padding: "0 12px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    height: "32px"
    padding: "0 12px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    height: "32px"
    padding: "0 10px"
  status-warning:
    backgroundColor: "{colors.warning-bg}"
    textColor: "{colors.warning-text}"
    rounded: "{rounded.sm}"
    padding: "3px 8px"
---

# Design System: ZWT Finance UI System

## Overview

**Creative North Star: "The Audit Desk"**

ZWT Finance 是财务人员长时间使用的生产工具。界面以中性浅色工作面为主，信息
密度高但不拥挤，主操作明确而不过度强调。业务页面使用单一无衬线字体体系，只有
品牌标识允许保留衬线字形。

系统拒绝夸张的大标题、营销式文案、卡片拼贴和无业务含义的装饰。WHT 与 TAX INV
共享相同的生命周期导航、台账、详情抽屉、格式化和反馈组件。

**Key Characteristics:**

- 中性浅色工作面与单一深棕主色。
- 24–26px 页面标题、32px 控件、36–40px 台账行。
- 全宽台账与覆盖式详情抽屉。
- 金额右对齐，编号、日期和金额启用等宽数字。
- 150–200ms 的状态过渡，无装饰性页面入场动画。

## Colors

色彩策略为 restrained：中性表面承担绝大多数页面，棕色只用于主操作、当前选择
和焦点，业务状态使用低饱和背景与高对比文字。

### Primary

- **Approval Brown** (`#875334`)：主按钮、当前页签和关键焦点；白字对比度 6.33:1。
- **Approval Brown Deep** (`#6F4126`)：主操作悬停和按下状态。

### Neutral

- **Audit Canvas** (`#F6F6F4`)：应用主背景。
- **Working White** (`#FFFFFF`)：表格、表单和抽屉表面。
- **Quiet Rail** (`#EFEEEA`)：侧栏和辅助导航。
- **Ledger Ink** (`#222222`)：主要文字和财务数字。
- **Muted Ink** (`#5F5D59`)：辅助文字；在白色上对比度 6.57:1。
- **Rule Line** (`#D9D7D2`)：边框与分隔线。

### Named Rules

**The Status-Only Color Rule.** 绿、橙、红、蓝只用于业务状态、风险和反馈，不装饰
普通标题或容器。

## Typography

**Display Font:** DM Sans + Noto Sans SC Variable
**Body Font:** DM Sans + Noto Sans SC Variable
**Thai Font:** Sarabun

**Character:** 单一、清晰、稳定。中文、英文和泰文使用兼容的无衬线体系，避免业务
标题与表格之间出现展示型字体冲突。

### Hierarchy

- **Headline**（700，24–26px，1.25）：页面标题。
- **Title**（700，16px，1.4）：抽屉标题、主要区块标题。
- **Body**（400，14px，1.5）：正文、表格和表单值。
- **Label**（600，12px，1.4）：字段标签、表头和辅助导航。
- **Caption**（400，11px，1.4）：时间、来源和辅助说明。

### Named Rules

**The Business Sans Rule.** 衬线字体不得用于业务页面标题、标签、按钮、表格或数据；
只允许用于左上角品牌标识。

**The Tabular Number Rule.** 金额、编号、税号、日期和汇率使用
`font-variant-numeric: tabular-nums`。

## Elevation

系统以分隔线和表面层级为主。静态表格与筛选区不使用宽模糊阴影。覆盖式详情抽屉
允许使用单一结构阴影，帮助用户识别其覆盖关系。

### Shadow Vocabulary

- **Drawer Overlay** (`-8px 0 16px rgba(34, 34, 34, 0.10)`)：仅用于右侧详情抽屉。
- **Floating Menu** (`0 4px 8px rgba(34, 34, 34, 0.10)`)：仅用于下拉菜单和浮层。

### Named Rules

**The Flat-by-Default Rule.** 静态容器只选边框或阴影之一；普通工作表面默认无阴影。

## Components

### Buttons

- **Shape:** 6px 圆角，高度 32px。
- **Primary:** `#875334` 背景、白色文字、水平内边距 12px。
- **Hover / Focus:** 悬停使用 `#6F4126`；键盘焦点使用 2px 半透明棕色外环。
- **Secondary:** 白色表面、`#D9D7D2` 边框、`#222222` 文字。

### Chips

- **Style:** 无装饰胶囊；状态标签使用 6px 圆角、3px × 8px 内边距。
- **State:** 每个状态由浅背景与达到 AA 的深色文字共同表达。

### Cards / Containers

- **Corner Style:** 表格与筛选组合最大 8px；独立弹层最大 12px。
- **Background:** 白色工作表面或中性辅助表面。
- **Shadow Strategy:** 静态容器不用宽阴影。
- **Border:** 1px `#D9D7D2`。
- **Internal Padding:** 12–20px，随组件职责变化。

### Inputs / Fields

- **Style:** 32px 高、6px 圆角、白色背景和 1px 中性边框。
- **Focus:** 主色边框与 2px 透明焦点环。
- **Error / Disabled:** 错误同时使用文字和状态色；禁用状态保持文字可读。

### Navigation

侧栏宽 208px，顶部栏高 56px。业务模块内使用生命周期页签：业务操作台、待处理、
待出具、历史记录；数据维护为平行辅助入口。当前项使用浅棕背景和 600 字重，不使用
大面积高饱和色。

### Finance Ledger

台账默认全宽，表头 12px/600，内容 13–14px，行高 36–40px。金额右对齐；长公司名
允许截断但必须提供完整值；详情通过覆盖式抽屉打开，不改变表格宽度或滚动位置。

### Batch Actions

批量操作沿用台账本身的选择列。选中记录后，表格工具条原位切换为批量操作条，不新增
浮动卡片，不改变表格纵向位置。按钮必须显示适用记录数；不满足当前动作状态的记录不
可执行。批量建草稿属于业务操作，批量审批属于“待处理”，不得混入历史记录。

### Import Choice

“批量开具”和“迁移历史台账”是两种不同业务：前者建立未编号草稿，后者迁移已开具且
已有正式编号的旧票。两项使用标题、短说明和业务标签同时区分，不只依赖图标或颜色。

### Signature Scope

签名图库属于数据维护。每个签名显示适用范围（仅 WHT、仅 TAX INV、两者通用），默认
签名按适用范围分别计算。WHT 与 TAX INV 生成文件时必须明确展示是否使用签名以及具体
版本，不得静默选择不适用的签名。

### Exchange-rate Maintenance

BOT 汇率置于 TAX INV 数据维护页。币种、接口配置状态、Buying Transfer 主报价及其他
留档报价使用紧凑表格呈现；配置异常使用可恢复的状态提示，不使用宣传式健康卡片。

## Do's and Don'ts

### Do:

- **Do** 使用 24–26px 页面标题、32px 控件和 36–40px 台账行。
- **Do** 让 WHT 与 TAX INV 共享页面骨架、生命周期导航、台账和详情抽屉。
- **Do** 在加载、空数据、错误、权限不足时提供明确且可恢复的状态。
- **Do** 使用等宽数字、右对齐金额和稳定的业务状态颜色。

### Don't:

- **Don't** 使用夸张的大字号衬线标题、营销式文案或装饰性排版。
- **Don't** 使用 dashboard 卡片拼贴、装饰渐变、玻璃拟态和大面积阴影。
- **Don't** 在详情关闭或没有记录时预留空白面板，不让表格无故变窄或横向滚动。
- **Don't** 用颜色装饰普通内容；颜色只表达主操作、选择和业务状态。
- **Don't** 让 WHT、TAX INV、主数据和历史页面各自发明一套组件与间距。
- **Don't** 给静态容器同时使用 1px 边框和宽模糊阴影。
