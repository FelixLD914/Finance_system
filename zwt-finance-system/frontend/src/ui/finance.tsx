import type { ReactNode } from "react";
import { Drawer, Tag } from "antd";

export type FinanceStatusTone =
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "info";

export interface FinanceTabItem<Key extends string = string> {
  key: Key;
  label: ReactNode;
  count?: number;
}

export type FinanceLifecyclePhase = "pending" | "issuing" | "history" | "all";

export function FinanceStatusBadge({
  label,
  tone,
}: {
  label: ReactNode;
  tone: FinanceStatusTone;
}) {
  return (
    <Tag className={`finance-status-badge is-${tone}`}>
      {label}
    </Tag>
  );
}

export function FinanceTabs<Key extends string>({
  activeKey,
  ariaLabel,
  items,
  onChange,
}: {
  activeKey: Key;
  ariaLabel: string;
  items: FinanceTabItem<Key>[];
  onChange: (key: Key) => void;
}) {
  return (
    <nav className="finance-tabs" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          aria-current={item.key === activeKey ? "page" : undefined}
          className={item.key === activeKey ? "is-active" : ""}
          key={item.key}
          type="button"
          onClick={() => onChange(item.key)}
        >
          <span>{item.label}</span>
          {item.count !== undefined && (
            <span className="finance-tab-count">{item.count}</span>
          )}
        </button>
      ))}
    </nav>
  );
}

export function FinanceLifecycleTabs({
  activeKey,
  ariaLabel,
  counts,
  labels,
  onChange,
}: {
  activeKey: FinanceLifecyclePhase;
  ariaLabel: string;
  counts: Record<FinanceLifecyclePhase, number>;
  labels: Record<FinanceLifecyclePhase, ReactNode>;
  onChange: (key: FinanceLifecyclePhase) => void;
}) {
  const order: FinanceLifecyclePhase[] = [
    "pending",
    "issuing",
    "history",
    "all",
  ];

  return (
    <div className="finance-ledger-tabs">
      <FinanceTabs
        activeKey={activeKey}
        ariaLabel={ariaLabel}
        items={order.map((key) => ({
          key,
          label: labels[key],
          count: counts[key],
        }))}
        onChange={onChange}
      />
    </div>
  );
}

export function FinancePageHeader<Key extends string>({
  actions,
  activeTab,
  description,
  onTabChange,
  tabs,
  title,
}: {
  actions?: ReactNode;
  activeTab?: Key;
  description?: ReactNode;
  onTabChange?: (key: Key) => void;
  tabs?: FinanceTabItem<Key>[];
  title: ReactNode;
}) {
  return (
    <header className="finance-page-header">
      <div className="finance-page-heading">
        <h1>{title}</h1>
        {description && <p>{description}</p>}
        {tabs && activeTab && onTabChange && (
          <FinanceTabs
            activeKey={activeTab}
            ariaLabel={`${String(title)} 功能`}
            items={tabs}
            onChange={onTabChange}
          />
        )}
      </div>
      {actions && <div className="finance-page-actions">{actions}</div>}
    </header>
  );
}

export function FinanceRecordDrawer({
  children,
  extra,
  footer,
  loading = false,
  onClose,
  open,
  rootClassName,
  status,
  title,
}: {
  children: ReactNode;
  extra?: ReactNode;
  footer?: ReactNode;
  loading?: boolean;
  onClose: () => void;
  open: boolean;
  rootClassName?: string;
  status?: ReactNode;
  title: ReactNode;
}) {
  return (
    <Drawer
      destroyOnHidden
      extra={extra}
      focusable={{ trap: true, focusTriggerAfterClose: true }}
      footer={footer}
      getContainer={false}
      keyboard
      loading={loading}
      mask={false}
      open={open}
      placement="right"
      push={false}
      rootClassName={`finance-record-drawer${rootClassName ? ` ${rootClassName}` : ""}`}
      rootStyle={{ position: "absolute" }}
      size={440}
      styles={{ body: { padding: 0 }, footer: { padding: 0 } }}
      title={
        <div className="finance-drawer-title">
          <strong>{title}</strong>
          {status}
        </div>
      }
      onClose={onClose}
    >
      {children}
    </Drawer>
  );
}
