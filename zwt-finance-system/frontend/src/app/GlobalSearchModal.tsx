import { useMemo, useState } from "react";
import {
  AuditOutlined,
  FileDoneOutlined,
  FileTextOutlined,
  RightOutlined,
  SearchOutlined,
  SettingOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Empty, Input, Modal } from "antd";

import type { Locale, Translate } from "../i18n";
import type { ModuleKey } from "../modules/registry";

interface SearchResultItem {
  id: string;
  moduleKey: ModuleKey;
  title: string;
  subtitle: string;
  category: string;
  icon: React.ReactNode;
}

interface GlobalSearchModalProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (module: ModuleKey) => void;
  locale: Locale;
  t: Translate;
}

export function GlobalSearchModal({
  open,
  onClose,
  onNavigate,
  locale,
  t,
}: GlobalSearchModalProps) {
  const [query, setQuery] = useState("");
  const isEn = locale === "en-US";

  const searchableItems: SearchResultItem[] = useMemo(
    () => [
      // WHT Items
      {
        id: "wht-ledger",
        moduleKey: "wht",
        title: isEn ? "WHT Withholding Tax Ledger" : "WHT 预扣税单据台账",
        subtitle: isEn
          ? "View and review WHT drafts, pending issuance, and history records"
          : "查看与复核 WHT 凭证草稿、待出具及历史开票记录",
        category: isEn ? "WHT Issuance" : "WHT 开票",
        icon: <FileTextOutlined />,
      },
      {
        id: "wht-payee",
        moduleKey: "wht",
        title: isEn ? "Payee Master Data Directory" : "收款方主数据档案",
        subtitle: isEn
          ? "Maintain 13-digit Tax ID, Thai name, Thai address, and form type for Thai suppliers"
          : "维护泰国供应商 13 位税号、泰文名称、泰文地址及申报表类型",
        category: isEn ? "WHT Issuance" : "WHT 开票",
        icon: <UserOutlined />,
      },
      {
        id: "wht-batch",
        moduleKey: "wht",
        title: isEn ? "WHT Batch Issuance & Excel Import" : "WHT 批量开具与 Excel 导入",
        subtitle: isEn
          ? "Import multiple WHT drafts at once using standard Excel template with line validation"
          : "按标准 Excel 模板一次导入多条 WHT 草稿并逐行校验",
        category: isEn ? "WHT Issuance" : "WHT 开票",
        icon: <FileDoneOutlined />,
      },
      // TAX INV Items
      {
        id: "tax-ledger",
        moduleKey: "tax-invoice",
        title: isEn ? "TAX INV Ledger & Monthly View" : "TAX INV 税票台账与月份视图",
        subtitle: isEn
          ? "Export Sales Tax Invoice ledger with 18-line item limit validation"
          : "Export Sales Tax Invoice 出口税票台账与 18 行限制校验",
        category: isEn ? "TAX INV" : "TAX INV 税票",
        icon: <AuditOutlined />,
      },
      {
        id: "tax-dual",
        moduleKey: "tax-invoice",
        title: isEn ? "Invoice + Customs PDF Smart Pairing" : "发票 + 报关单双文件智能匹配",
        subtitle: isEn
          ? "Upload Export Invoice & Thailand Customs PDF for auto pairing and field reconciliation"
          : "上传 Export Invoice 与 Thailand Customs PDF 自动配对识别",
        category: isEn ? "TAX INV" : "TAX INV 税票",
        icon: <FileDoneOutlined />,
      },
      {
        id: "tax-rates",
        moduleKey: "tax-invoice",
        title: isEn ? "BOT Exchange Rate Center" : "BOT 泰国央行汇率中心",
        subtitle: isEn
          ? "USD daily Buying Transfer rate auto-sync and manual maintenance"
          : "USD 每日 Buying Transfer 汇率自动同步与手工维护",
        category: isEn ? "TAX INV" : "TAX INV 税票",
        icon: <SettingOutlined />,
      },
      // Salary Advance Items
      {
        id: "salary-ledger",
        moduleKey: "salary-advance",
        title: isEn ? "Salary Advance Ledger" : "工资预支单据台账",
        subtitle: isEn
          ? "Batch management, full field validation, and approval workflow tracking"
          : "薪资预支批次管理、全字段校验与审批流程追踪",
        category: isEn ? "Salary Advance" : "工资预支单",
        icon: <FileTextOutlined />,
      },
      {
        id: "salary-employees",
        moduleKey: "salary-advance",
        title: isEn ? "Employee Directory" : "员工人员库档案",
        subtitle: isEn
          ? "Maintain employee ID, English/Chinese name, department, and position"
          : "维护工号、中英文姓名、部门及职位，保障预支单引用准确",
        category: isEn ? "Salary Advance" : "工资预支单",
        icon: <UserOutlined />,
      },
      // Administration Items
      {
        id: "admin-signatures",
        moduleKey: "administration",
        title: isEn ? "Signature Asset Library & Stamp" : "签名图库与套印印鉴",
        subtitle: isEn
          ? "Upload supervisor & MD signatures, configure scope and default version"
          : "上传财务负责人与总经理签名图片，配置适用单据与默认版本",
        category: isEn ? "System Admin" : "系统管理",
        icon: <SettingOutlined />,
      },
      {
        id: "admin-audit",
        moduleKey: "administration",
        title: isEn ? "Audit Log & Recycle Bin" : "审计日志与回收站",
        subtitle: isEn
          ? "Track operation logs, physical deletion protection, and one-click data restore"
          : "操作全轨迹留痕记录，以及物理删除保护与主数据一键恢复",
        category: isEn ? "System Admin" : "系统管理",
        icon: <AuditOutlined />,
      },
    ],
    [isEn],
  );

  const filteredResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return searchableItems;
    return searchableItems.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.subtitle.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q),
    );
  }, [query, searchableItems]);

  const handleSelect = (item: SearchResultItem) => {
    onNavigate(item.moduleKey);
    onClose();
  };

  return (
    <Modal
      open={open}
      footer={null}
      title={null}
      closeIcon={null}
      width={640}
      style={{ top: 50 }}
      destroyOnClose
      onCancel={onClose}
      className="global-search-modal"
    >
      <div style={{ padding: "8px 0 16px 0" }}>
        <Input
          prefix={<SearchOutlined style={{ color: "#a0988e", fontSize: 18 }} />}
          placeholder={
            isEn
              ? "Search modules, ledgers, master data or settings..."
              : "全局搜索功能模块、单据台账、主数据或设置..."
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          allowClear
          autoFocus
          size="large"
          style={{
            borderRadius: 8,
            fontSize: 16,
            background: "#faf7f2",
            borderColor: "#e8dfd5",
          }}
        />
      </div>

      <div
        style={{
          maxHeight: 420,
          overflowY: "auto",
          paddingRight: 4,
        }}
      >
        {filteredResults.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              isEn
                ? "No matching functions or data found"
                : "没有找到匹配的功能或数据"
            }
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {filteredResults.map((item) => (
              <div
                key={item.id}
                onClick={() => handleSelect(item)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "12px 14px",
                  borderRadius: 8,
                  cursor: "pointer",
                  border: "1px solid #f0e9e1",
                  background: "#fff",
                  transition: "all 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#f7f2ea";
                  e.currentTarget.style.borderColor = "#c6a982";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "#fff";
                  e.currentTarget.style.borderColor = "#f0e9e1";
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 8,
                      background: "#f3ede4",
                      color: "#735c40",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 18,
                    }}
                  >
                    {item.icon}
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: "#2a2622",
                      }}
                    >
                      {item.title}
                    </div>
                    <div style={{ fontSize: 12, color: "#877f76", marginTop: 2 }}>
                      {item.subtitle}
                    </div>
                  </div>
                </div>
                <div style={{ color: "#b5aa9d", fontSize: 14 }}>
                  <RightOutlined />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div
        style={{
          marginTop: 16,
          paddingTop: 12,
          borderTop: "1px solid #ece4da",
          display: "flex",
          justifyContent: "space-between",
          color: "#9c9388",
          fontSize: 12,
        }}
      >
        <span>
          {isEn
            ? "Tip: Click any item to navigate directly"
            : "提示：点击任意选项即可直接跳转对应功能"}
        </span>
        <span>{isEn ? "Press ESC to close" : "按 ESC 键关闭"}</span>
      </div>
    </Modal>
  );
}
