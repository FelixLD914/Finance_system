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
import { Empty, Input, Modal, Tag } from "antd";

import type { Translate } from "../i18n";
import type { ModuleKey } from "../modules/registry";

interface SearchResultItem {
  id: string;
  moduleKey: ModuleKey;
  title: string;
  subtitle: string;
  category: string;
  tag?: { text: string; color: string };
  icon: React.ReactNode;
}

interface GlobalSearchModalProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (module: ModuleKey) => void;
  t: Translate;
}

export function GlobalSearchModal({
  open,
  onClose,
  onNavigate,
  t,
}: GlobalSearchModalProps) {
  const [query, setQuery] = useState("");

  const searchableItems: SearchResultItem[] = useMemo(
    () => [
      // WHT Items
      {
        id: "wht-ledger",
        moduleKey: "wht",
        title: "WHT 预扣税单据台账",
        subtitle: "查看与复核 WHT 凭证草稿、待出具及历史开票记录",
        category: "WHT 开票",
        tag: { text: "核心功能", color: "gold" },
        icon: <FileTextOutlined />,
      },
      {
        id: "wht-payee",
        moduleKey: "wht",
        title: "收款方主数据档案",
        subtitle: "维护泰国供应商 13 位税号、泰文名称、泰文地址及申报表类型",
        category: "WHT 开票",
        tag: { text: "主数据", color: "cyan" },
        icon: <UserOutlined />,
      },
      {
        id: "wht-batch",
        moduleKey: "wht",
        title: "WHT 批量开具与 Excel 导入",
        subtitle: "按标准 Excel 模板一次导入多条 WHT 草稿并逐行校验",
        category: "WHT 开票",
        tag: { text: "工具", color: "blue" },
        icon: <FileDoneOutlined />,
      },
      // TAX INV Items
      {
        id: "tax-ledger",
        moduleKey: "tax-invoice",
        title: "TAX INV 税票台账与月份视图",
        subtitle: "Export Sales Tax Invoice 出口税票台账与 18 行限制校验",
        category: "TAX INV 税票",
        tag: { text: "核心功能", color: "purple" },
        icon: <AuditOutlined />,
      },
      {
        id: "tax-dual",
        moduleKey: "tax-invoice",
        title: "发票 + 报关单双文件智能匹配",
        subtitle: "上传 Export Invoice 与 Thailand Customs PDF 自动配对识别",
        category: "TAX INV 税票",
        tag: { text: "智能识别", color: "green" },
        icon: <FileDoneOutlined />,
      },
      {
        id: "tax-rates",
        moduleKey: "tax-invoice",
        title: "BOT 泰国央行汇率中心",
        subtitle: "USD 每日 Buying Transfer 汇率自动同步与手工维护",
        category: "TAX INV 税票",
        tag: { text: "汇率中心", color: "geekblue" },
        icon: <SettingOutlined />,
      },
      // Salary Advance Items
      {
        id: "salary-ledger",
        moduleKey: "salary-advance",
        title: "工资预支单据台账",
        subtitle: "薪资预支批次管理、全字段校验与审批流程追踪",
        category: "工资预支单",
        tag: { text: "核心功能", color: "magenta" },
        icon: <FileTextOutlined />,
      },
      {
        id: "salary-employees",
        moduleKey: "salary-advance",
        title: "员工人员库档案",
        subtitle: "维护工号、中英文姓名、部门及职位，保障预支单引用准确",
        category: "工资预支单",
        tag: { text: "人员库", color: "lime" },
        icon: <UserOutlined />,
      },
      // Administration Items
      {
        id: "admin-signatures",
        moduleKey: "administration",
        title: "签名图库与套印印鉴",
        subtitle: "上传财务负责人与总经理签名图片，配置适用单据与默认版本",
        category: "系统管理",
        tag: { text: "印鉴管理", color: "volcano" },
        icon: <SettingOutlined />,
      },
      {
        id: "admin-audit",
        moduleKey: "administration",
        title: "审计日志与回收站",
        subtitle: "操作全轨迹留痕记录，以及物理删除保护与主数据一键恢复",
        category: "系统管理",
        tag: { text: "安全审计", color: "orange" },
        icon: <AuditOutlined />,
      },
    ],
    [],
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
      width={640}
      destroyOnClose
      onCancel={onClose}
      className="global-search-modal"
    >
      <div style={{ padding: "8px 0 16px 0" }}>
        <Input
          prefix={<SearchOutlined style={{ color: "#a0988e", fontSize: 18 }} />}
          placeholder="全局搜索功能模块、单据台账、主数据或设置..."
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
            description="没有找到匹配的功能或数据"
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
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <span>{item.title}</span>
                      {item.tag && (
                        <Tag color={item.tag.color} style={{ margin: 0 }}>
                          {item.tag.text}
                        </Tag>
                      )}
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
        <span>提示：点击任意选项即可直接跳转对应功能</span>
        <span>按 ESC 键关闭</span>
      </div>
    </Modal>
  );
}
