import { useState } from "react";
import {
  BellOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  InfoCircleOutlined,
  RightOutlined,
} from "@ant-design/icons";
import { Badge, Button, Drawer, Empty, Segmented, Space } from "antd";

import type { Locale, Translate } from "../i18n";
import type { ModuleKey } from "../modules/registry";

export interface SystemNotification {
  id: string;
  read: boolean;
  type: "action" | "info" | "success";
  moduleKey: ModuleKey;
  createdAt?: string;
  title?: string;
  description?: string;
  titleEn?: string;
  descriptionEn?: string;
}

interface NotificationsDrawerProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (module: ModuleKey) => void;
  locale: Locale;
  t: Translate;
}

const NOW = Date.now();

const NOTIFICATION_DICTIONARY: Record<
  string,
  {
    titleZh: string;
    titleEn: string;
    descZh: string;
    descEn: string;
    createdAt: string;
  }
> = {
  "notif-1": {
    titleZh: "WHT 待复核单据提醒",
    titleEn: "WHT Draft Pending Review",
    descZh: "有 2 张 WHT 凭证草稿已提交，等待财务主管复核并生成正式编号",
    descEn:
      "2 WHT certificate drafts submitted, awaiting supervisor review & formal number allocation",
    createdAt: new Date(NOW - 10 * 60 * 1000).toISOString(), // 10 mins ago
  },
  "notif-2": {
    titleZh: "TAX INV BOT 汇率更新成功",
    titleEn: "TAX INV BOT Rate Sync Succeeded",
    descZh: "泰国央行 BOT API 最新 USD buying transfer 汇率已同步入库",
    descEn:
      "Latest BOT USD buying transfer exchange rate synced from API successfully",
    createdAt: new Date(NOW - 60 * 60 * 1000).toISOString(), // 1 hour ago
  },
  "notif-3": {
    titleZh: "工资预支单数据待校验",
    titleEn: "Salary Advance Data Validation Pending",
    descZh: "新导入 202608 期工资预支表，有 1 条员工记录需要补齐中英文姓名",
    descEn:
      "Newly imported Salary Advance batch 202608 has 1 employee record needing name check",
    createdAt: new Date(NOW - 120 * 60 * 1000).toISOString(), // 2 hours ago
  },
  "notif-4": {
    titleZh: "签名图库默认版本提示",
    titleEn: "Default Signature Version Updated",
    descZh: "系统管理中已更新财务负责人与总经理印鉴签名图片",
    descEn:
      "Default signature image assets for supervisor and MD updated in System Admin",
    createdAt: new Date(NOW - (24 * 60 + 5 * 60) * 60 * 1000).toISOString(), // Yesterday 16:30
  },
};

const INITIAL_NOTIFICATIONS: SystemNotification[] = [
  {
    id: "notif-1",
    createdAt: NOTIFICATION_DICTIONARY["notif-1"].createdAt,
    read: false,
    type: "action",
    moduleKey: "wht",
  },
  {
    id: "notif-2",
    createdAt: NOTIFICATION_DICTIONARY["notif-2"].createdAt,
    read: false,
    type: "success",
    moduleKey: "tax-invoice",
  },
  {
    id: "notif-3",
    createdAt: NOTIFICATION_DICTIONARY["notif-3"].createdAt,
    read: false,
    type: "action",
    moduleKey: "salary-advance",
  },
  {
    id: "notif-4",
    createdAt: NOTIFICATION_DICTIONARY["notif-4"].createdAt,
    read: true,
    type: "info",
    moduleKey: "administration",
  },
];

/**
 * 根据 ISO 时间戳与当前语言动态计算相对时间文本（例如：10 分钟前 / 10 mins ago）
 */
function formatRelativeTime(isoString: string, isEn: boolean): string {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) {
    return isEn ? "Recently" : "近期";
  }

  const now = new Date();
  const diffMs = Math.max(0, now.getTime() - date.getTime());
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) {
    return isEn ? "Just now" : "刚刚";
  }
  if (diffMins < 60) {
    return isEn
      ? `${diffMins} min${diffMins > 1 ? "s" : ""} ago`
      : `${diffMins} 分钟前`;
  }
  if (diffHours < 24) {
    return isEn
      ? `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`
      : `${diffHours} 小时前`;
  }

  const hours = String(date.getHours()).padStart(2, "0");
  const mins = String(date.getMinutes()).padStart(2, "0");
  if (diffDays === 1) {
    return isEn ? `Yesterday ${hours}:${mins}` : `昨天 ${hours}:${mins}`;
  }

  const month = date.getMonth() + 1;
  const day = date.getDate();
  return isEn
    ? `${month}/${day} ${hours}:${mins}`
    : `${month}月${day}日 ${hours}:${mins}`;
}

export function NotificationsDrawer({
  open,
  onClose,
  onNavigate,
  locale,
  t,
}: NotificationsDrawerProps) {
  const [notifications, setNotifications] = useState<SystemNotification[]>(
    INITIAL_NOTIFICATIONS,
  );
  const [filterType, setFilterType] = useState<"all" | "unread" | "action">("all");
  const isEn = locale === "en-US";

  const unreadCount = notifications.filter((n) => !n.read).length;

  const filteredNotifications = notifications.filter((n) => {
    if (filterType === "unread") return !n.read;
    if (filterType === "action") return n.type === "action";
    return true;
  });

  const markAllAsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const clearAll = () => {
    setNotifications([]);
  };

  const handleItemClick = (item: SystemNotification) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === item.id ? { ...n, read: true } : n)),
    );
    onNavigate(item.moduleKey);
    onClose();
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <BellOutlined style={{ color: "#8c6b3f", fontSize: 20 }} />
          <span style={{ fontSize: 16, fontWeight: 600 }}>
            {isEn ? "Notification Center" : "系统通知中心"}
          </span>
          {unreadCount > 0 && (
            <Badge count={unreadCount} style={{ backgroundColor: "#b85d19" }} />
          )}
        </div>
      }
      extra={
        <Space size={4}>
          <Button size="small" type="text" onClick={markAllAsRead}>
            {isEn ? "Mark all as read" : "全部已读"}
          </Button>
          <Button size="small" type="text" danger onClick={clearAll}>
            {isEn ? "Clear" : "清空"}
          </Button>
        </Space>
      }
      width={420}
      className="notifications-drawer"
    >
      <div style={{ marginBottom: 16 }}>
        <Segmented
          block
          value={filterType}
          onChange={(val) => setFilterType(val as "all" | "unread" | "action")}
          options={[
            {
              label: isEn
                ? `All (${notifications.length})`
                : `全部 (${notifications.length})`,
              value: "all",
            },
            {
              label: isEn ? `Unread (${unreadCount})` : `未读 (${unreadCount})`,
              value: "unread",
            },
            {
              label: isEn
                ? `Action (${notifications.filter((n) => n.type === "action").length})`
                : `待办事项 (${notifications.filter((n) => n.type === "action").length})`,
              value: "action",
            },
          ]}
        />
      </div>

      {filteredNotifications.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={isEn ? "No notifications found" : "暂无符合条件的通知"}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filteredNotifications.map((n) => {
            const dict = NOTIFICATION_DICTIONARY[n.id];
            const title = isEn
              ? dict?.titleEn || n.titleEn || n.title
              : dict?.titleZh || n.title;
            const description = isEn
              ? dict?.descEn || n.descriptionEn || n.description
              : dict?.descZh || n.description;

            const rawIso = n.createdAt || dict?.createdAt;
            const formattedTime = formatRelativeTime(
              rawIso || new Date(NOW - 10 * 60 * 1000).toISOString(),
              isEn,
            );

            return (
              <div
                key={n.id}
                onClick={() => handleItemClick(n)}
                style={{
                  padding: "12px 14px",
                  borderRadius: 8,
                  border: "1px solid",
                  borderColor: n.read ? "#eae2d8" : "#d8c2a8",
                  background: n.read ? "#faf7f4" : "#fffcf7",
                  cursor: "pointer",
                  position: "relative",
                  transition: "all 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "#c6a982";
                  e.currentTarget.style.boxShadow =
                    "0 2px 8px rgba(0,0,0,0.05)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = n.read
                    ? "#eae2d8"
                    : "#d8c2a8";
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                {!n.read && (
                  <div
                    style={{
                      position: "absolute",
                      top: 12,
                      right: 12,
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      backgroundColor: "#b85d19",
                    }}
                  />
                )}

                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      marginTop: 2,
                      fontSize: 16,
                      flexShrink: 0,
                      color:
                        n.type === "action"
                          ? "#b85d19"
                          : n.type === "success"
                            ? "#389e0d"
                            : "#1890ff",
                    }}
                  >
                    {n.type === "action" ? (
                      <ClockCircleOutlined />
                    ) : n.type === "success" ? (
                      <CheckCircleOutlined />
                    ) : (
                      <InfoCircleOutlined />
                    )}
                  </div>

                  <div style={{ flex: 1, minWidth: 0, paddingRight: 12 }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: n.read ? 500 : 700,
                        color: "#2a2622",
                      }}
                    >
                      {title}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "#736b62",
                        marginTop: 4,
                        lineHeight: 1.4,
                      }}
                    >
                      {description}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginTop: 8,
                        fontSize: 11,
                        color: "#9e9488",
                      }}
                    >
                      <span>{formattedTime}</span>
                      <span style={{ color: "#8c6b3f", fontWeight: 600 }}>
                        {isEn ? "View details" : "去查看"}{" "}
                        <RightOutlined style={{ fontSize: 10 }} />
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Drawer>
  );
}
