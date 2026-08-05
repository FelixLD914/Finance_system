import { useMemo, useState } from "react";
import {
  AuditOutlined,
  BookOutlined,
  CheckCircleOutlined,
  FileDoneOutlined,
  FileTextOutlined,
  InfoCircleOutlined,
  QuestionCircleOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  SettingOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Alert, Card, Input, Modal, Segmented, Space, Tag } from "antd";

import type { Translate } from "../i18n";
import type { ModuleKey } from "../modules/registry";

interface HelpSection {
  title: string;
  badge?: string;
  logicRules: { title: string; desc: string; important?: boolean }[];
  steps: { step: string; text: string }[];
  faqs: { q: string; a: string }[];
}

interface HelpModalProps {
  open: boolean;
  onClose: () => void;
  t: Translate;
}

export function HelpModal({ open, onClose, t }: HelpModalProps) {
  const [activeTab, setActiveTab] = useState<ModuleKey>("wht");
  const [searchQuery, setSearchQuery] = useState("");

  const helpData: Partial<Record<ModuleKey, HelpSection>> = useMemo(
    () => ({
      wht: {
        title: "WHT 预扣税开票管理 (Withholding Tax)",
        badge: "PND3 / PND53 预扣税凭证",
        logicRules: [
          {
            title: "正式凭证编号生成机制",
            desc: "正式 WHT 凭证编号只在财务主管点击「批准」时由后端数据库事务安全分配，前端不允许指定或修改编号。草稿阶段无编号，确保顺序连贯、防错重号。",
            important: true,
          },
          {
            title: "金额计算与 ROUND_HALF_UP 舍入",
            desc: "预扣税额 = 不含税金额 × 预扣税率（%）。计算结果按标准的 ROUND_HALF_UP（四舍五入）精确保留两位小数，与服务器计算逻辑一致。",
          },
          {
            title: "法定税率目录与偏离理由",
            desc: "各收入类型对应法定预扣税率（如服务费 3%、租金 5%）。当手工修改为非法定税率时，系统要求必须填写「偏离理由」，并永久写入凭证日志备查。",
          },
          {
            title: "补开（BK）与历史凭证迁移",
            desc: "支持补开（BK）序号标记；迁移旧系统历史台账时会完整保留旧凭证原编号，导入即为「已出具」状态。",
          },
        ],
        steps: [
          {
            step: "步骤 1",
            text: "选择开票路径：点击「新建 WHT 任务」单张录入，或选择「批量开具」上传 Excel。",
          },
          {
            step: "步骤 2",
            text: "匹配或补录收款方：支持由 13 位税号搜索泰文名称、泰文地址，主数据未收录时可实时手工补录。",
          },
          {
            step: "步骤 3",
            text: "提交复核与批准取号：确认不含税金额与税率无误后提交复核；主管批准即分配正式编号。",
          },
          {
            step: "步骤 4",
            text: "套印签名与生成 PDF/Excel：选择经批准的默认签名，一键生成正式凭证并导出。",
          },
        ],
        faqs: [
          {
            q: "问：为什么填写的税率被拒绝提交？",
            a: "答：若填写的税率偏离法定标准（如 3% 改为 5%），必须在「改用非法定税率的理由」文本框中填写说明（例如：合同约定专条备查），否则提交会被退回。",
          },
          {
            q: "问：批量开具 Excel 模板为什么不能填凭证编号？",
            a: "答：根据系统审计要求，所有新发凭证编号必须由数据库事务统一发放。批量 Excel 中请留空编号列，系统会在批准时按序号自动生成。",
          },
        ],
      },
      "tax-invoice": {
        title: "TAX INV 出口税票管理 (Export Sales Tax Invoice)",
        badge: "报关单与发票自动识别对账",
        logicRules: [
          {
            title: "双文件（发票 + 报关单）智能配对",
            desc: "上传 Export Invoice (.xlsx) 与 Thailand Customs PDF，系统通过 C/I No. 自动跨格式配对，比对 FOB 金额、报关提交日及货代信息。",
            important: true,
          },
          {
            title: "BOT 泰国央行汇率自动匹配",
            desc: "开票取 USD 的 BOT buying transfer 汇率，按报关单提交日自动匹配当日央行汇率，自动换算成泰铢 FOB THB 金额。",
          },
          {
            title: "单张凭证 18 行商品限制",
            desc: "单张 TAX INV 出口税票模板容量严格限制为最多 18 条商品明细。若批量表格中同一关单超过 18 行，系统将禁止批准并提醒拆单。",
          },
          {
            title: "作废与更正单（Credit Note / Debit Note）",
            desc: "已开具的税票不可直接物理删除；作废后原编号永久保留。若内容需修改，可生成关联更正单并分配新编号。",
          },
        ],
        steps: [
          {
            step: "步骤 1",
            text: "汇率就绪确认：先在「BOT 汇率中心」确认当月汇率已入库，支持一键 API 同步或 Excel 导入。",
          },
          {
            step: "步骤 2",
            text: "双文件导入识别：把发票 Excel 与报关单 PDF 一起拖入向导，系统完成 C/I 智能匹配。",
          },
          {
            step: "步骤 3",
            text: "批次对账复核：在复核台逐行比对发票与关单 FOB USD 差异，警示提示确认无误后点击批量批准。",
          },
          {
            step: "步骤 4",
            text: "打包导出正式文件：主管批准后直接导出盖章版 Excel/PDF 或按整期一键打包导出 ZIP。",
          },
        ],
        faqs: [
          {
            q: "问：发票与报关单的 FOB USD 金额不一致怎么办？",
            a: "答：复核台会红字标出差异行。请开抽屉核对发票明细与报关单，若是关单修改导致，可在对账界面修改发票数据后再行批准。",
          },
          {
            q: "问：如何处理缺少当月 BOT 汇率的报关单？",
            a: "答：若报关提交日未抓到央行汇率，凭证会停在「待匹配汇率」。请点击「从 BOT API 同步」或手工补录汇率即可解除停滞。",
          },
        ],
      },
      "salary-advance": {
        title: "SALARY ADVANCE 工资预支单管理",
        badge: "全字段校验与多重印鉴防伪",
        logicRules: [
          {
            title: "Excel 全字段强校验与人员库匹配",
            desc: "导入工资预支 Excel 时，系统自动核查工号是否在人员库中在职，自动校验申请金额与月扣额逻辑，确保无缺失错漏。",
            important: true,
          },
          {
            title: "财务负责人与总经理/董事双重签名策略",
            desc: "预支单正式文件印鉴需同时包含财务负责人与总经理/董事签名。支持按适用单据指定默认签名版本。",
          },
          {
            title: "数据指纹（Fingerprint）与全链路防伪留痕",
            desc: "每张预支单生成时会计算全局数据哈希指纹，正式 PDF 文件底部打印验证指纹与生成版本，避免人工篡改。",
          },
          {
            title: "纯 Python 引擎（无 Office 依赖）",
            desc: "后端采用 ReportLab + pypdf 高性能渲染 PDF，服务器完全脱离 Office/WPS 依赖，毫秒级快速生成凭证。",
          },
        ],
        steps: [
          {
            step: "步骤 1",
            text: "维护员工人员库：确认申请员工工号、中英文姓名、部门及职位已在人员库中完成登记。",
          },
          {
            step: "步骤 2",
            text: "导入预支表批次：选择标准 Excel 文件上传，系统自动校验并标记有效与异常记录。",
          },
          {
            step: "步骤 3",
            text: "选择多重签名印鉴：选定财务负责人与总经理/董事的签名版本。",
          },
          {
            step: "步骤 4",
            text: "批量出具与下载：提交生成任务，完成后可下载单张 PDF/Excel 或一键导出合并 PDF 与 ZIP 包。",
          },
        ],
        faqs: [
          {
            q: "问：为什么预支单提示「工号未在人员库中找到」？",
            a: "答：系统为防范冒领及财务风险，要求所有预支人员必须先在「员工人员库」建档。请先在人员库新增该员工后再重新校验。",
          },
          {
            q: "问：申请金额与月扣额填错了如何更正？",
            a: "答：在批次单据列表中点击「修改记录」，调整金额并确认后，系统会自动重新计算校验状态并更新指纹。",
          },
        ],
      },
      administration: {
        title: "SHARED & ADMIN 共享数据与系统管理",
        badge: "主数据别名、签名图库与审计日志",
        logicRules: [
          {
            title: "收款方主数据别名（Alias）智能匹配",
            desc: "针对同家公司存在多种泰文/英文写法，支持维护 Alias 别名库。批量导入时可通过别名自动归集到统一 13 位税号主数据。",
            important: true,
          },
          {
            title: "签名图库多模块通用与适用范围划分",
            desc: "一张签名支持勾选适用单据（WHT、TAX INV、工资预支单）。工资预支单勾选时要求填写「签名人姓名」，套印在签名线下方。",
          },
          {
            title: "软删除与回收站恢复保障",
            desc: "删除主数据或签名图库时仅放入「回收站」，历史单据快照与关联永不受破坏，可随时从回收站一键无损恢复。",
          },
          {
            title: "审计日志（Audit Log）不可篡改追踪",
            desc: "系统记录所有关键业务操作（新建、批准、作废、修订、签名修改），记录包含操作人真实姓名、时间戳与变动内容。",
          },
        ],
        steps: [
          {
            step: "步骤 1",
            text: "上传签名印鉴：在系统管理上传 PNG/JPEG 透明背景图片（不超过 5 MiB）。",
          },
          {
            step: "步骤 2",
            text: "设置适用范围：勾选签名适用的单据模块，并设定是否作为该模块的默认签名。",
          },
          {
            step: "步骤 3",
            text: "管理回收站：误删的主数据或签名，可通过系统管理/主数据页面的「回收站」视图点击恢复。",
          },
          {
            step: "步骤 4",
            text: "查看审计追溯：所有审批与修改记录可在各模块明细面板的「流程记录」中查看。",
          },
        ],
        faqs: [
          {
            q: "问：为什么删除收款方提示「有历史单据引用」？",
            a: "答：系统采用主数据快照机制，移入回收站不会破坏已生成的历史凭证，您可以随时从回收站安全恢复该档案。",
          },
          {
            q: "问：如何让不同模块使用不同的默认签名？",
            a: "答：每张签名图片可设置适用模块。系统按「WHT」、「TAX INV」、「工资预支单」各自维护独立的默认签名，互不冲突。",
          },
        ],
      },
    }),
    [],
  );

  const currentSection = helpData[activeTab] ?? helpData.wht!;

  // 搜索过滤 logicRules, steps, faqs
  const filteredRules = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return currentSection.logicRules;
    return currentSection.logicRules.filter(
      (r) =>
        r.title.toLowerCase().includes(q) || r.desc.toLowerCase().includes(q),
    );
  }, [currentSection.logicRules, searchQuery]);

  const filteredSteps = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return currentSection.steps;
    return currentSection.steps.filter((s) => s.text.toLowerCase().includes(q));
  }, [currentSection.steps, searchQuery]);

  const filteredFaqs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return currentSection.faqs;
    return currentSection.faqs.filter(
      (f) => f.q.toLowerCase().includes(q) || f.a.toLowerCase().includes(q),
    );
  }, [currentSection.faqs, searchQuery]);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={860}
      title={
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <QuestionCircleOutlined style={{ color: "#8c6b3f", fontSize: 22 }} />
          <span style={{ fontSize: 18, fontWeight: 700 }}>
            ZWT Finance 业务逻辑与操作指南
          </span>
        </div>
      }
      className="help-modal"
    >
      <div style={{ marginBottom: 16 }}>
        <Input
          prefix={<SearchOutlined style={{ color: "#9e9488" }} />}
          placeholder="在业务逻辑与提示中搜索关键字（如：税率、编号、签名、配对...）"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          allowClear
          style={{ borderRadius: 8, background: "#faf7f4" }}
        />
      </div>

      <div style={{ marginBottom: 20 }}>
        <Segmented
          block
          value={activeTab}
          onChange={(val) => setActiveTab(val as ModuleKey)}
          options={[
            { label: "WHT 预扣税", value: "wht", icon: <FileTextOutlined /> },
            { label: "TAX INV 税票", value: "tax-invoice", icon: <AuditOutlined /> },
            {
              label: "工资预支单",
              value: "salary-advance",
              icon: <FileDoneOutlined />,
            },
            {
              label: "共享数据与系统管理",
              value: "administration",
              icon: <SettingOutlined />,
            },
          ]}
        />
      </div>

      <div
        style={{
          maxHeight: 520,
          overflowY: "auto",
          paddingRight: 6,
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingBottom: 8,
            borderBottom: "1px solid #eee6dc",
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 700,
              color: "#2a2622",
            }}
          >
            {currentSection.title}
          </h2>
          {currentSection.badge && (
            <Tag color="gold" style={{ fontSize: 12 }}>
              {currentSection.badge}
            </Tag>
          )}
        </div>

        {/* 核心业务逻辑与规范 */}
        <div>
          <h3
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#8c6b3f",
              marginBottom: 10,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <BookOutlined /> 核心业务逻辑与核算规范
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {filteredRules.map((rule, idx) => (
              <Card
                key={idx}
                size="small"
                style={{
                  borderRadius: 8,
                  borderColor: rule.important ? "#d8c2a8" : "#ede6de",
                  background: rule.important ? "#fffcf7" : "#fff",
                }}
              >
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: "#2a2622",
                    marginBottom: 4,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span>{rule.title}</span>
                  {rule.important && (
                    <Tag color="volcano" style={{ fontSize: 11 }}>
                      关键规则
                    </Tag>
                  )}
                </div>
                <div style={{ fontSize: 13, color: "#665e55", lineHeight: 1.5 }}>
                  {rule.desc}
                </div>
              </Card>
            ))}
          </div>
        </div>

        {/* 操作步骤 */}
        <div>
          <h3
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#8c6b3f",
              marginBottom: 10,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <CheckCircleOutlined /> 标准业务操作流程
          </h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
            }}
          >
            {filteredSteps.map((step, idx) => (
              <div
                key={idx}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  background: "#f7f3ed",
                  border: "1px solid #eae2d8",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#8c6b3f",
                    letterSpacing: "0.05em",
                  }}
                >
                  {step.step}
                </span>
                <span style={{ fontSize: 13, color: "#3b3630", lineHeight: 1.4 }}>
                  {step.text}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 常见问题解答 */}
        <div>
          <h3
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#8c6b3f",
              marginBottom: 10,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <InfoCircleOutlined /> 常见问题与操作提示 (FAQ)
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {filteredFaqs.map((faq, idx) => (
              <Alert
                key={idx}
                type="info"
                showIcon={false}
                style={{
                  borderRadius: 8,
                  borderColor: "#e3dad0",
                  background: "#faf7f4",
                }}
                message={
                  <span style={{ fontWeight: 700, color: "#2a2622", fontSize: 13 }}>
                    {faq.q}
                  </span>
                }
                description={
                  <span style={{ color: "#5c544c", fontSize: 13 }}>
                    {faq.a}
                  </span>
                }
              />
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
