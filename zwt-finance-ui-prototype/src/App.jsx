import { useEffect, useMemo, useState } from "react";
import {
  App as AntApp,
  Avatar,
  Badge,
  Button,
  ConfigProvider,
  Descriptions,
  Dropdown,
  Form,
  Input,
  Menu,
  Modal,
  Radio,
  Select,
  Space,
  Steps,
  Table,
  Tag,
  Tooltip,
} from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import {
  BellOutlined,
  CheckCircleFilled,
  CloseOutlined,
  DatabaseOutlined,
  DownOutlined,
  EditOutlined,
  ExportOutlined,
  FileTextOutlined,
  FilterOutlined,
  HomeOutlined,
  GlobalOutlined,
  LeftOutlined,
  LinkOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MoreOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  RightOutlined,
  SearchOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { createTranslator } from "./i18n";

const initialTasks = [
  {
    key: "bk101",
    taskNo: "ZWT202606BK101",
    bookNo: "2606BK1",
    period: "2026-06",
    company: "บริษัท อรุณทรัพย์ จำกัด",
    taxId: "0105559101234",
    whtType: "PND 3",
    incomeType: "ค่าบริการ",
    rate: "3%",
    documents: 2,
    amount: "125,000.00",
    taxAmount: "3,750.00",
    paymentDate: "2026-07-05",
    dueDate: "2026-07-25",
    status: "pending",
    createdBy: "Thanawat K.",
    createdAt: "2026-07-20 10:15",
    updatedBy: "Supaporn P.",
    updatedAt: "2026-07-22 14:30",
  },
  {
    key: "060",
    taskNo: "ZWT202606060",
    bookNo: "202606",
    period: "2026-06",
    company: "บริษัท แสงไทย อินดัสทรี จำกัด",
    taxId: "0105558004821",
    whtType: "PND 53",
    incomeType: "ค่าขนส่ง",
    rate: "1%",
    documents: 3,
    amount: "242,800.00",
    taxAmount: "2,428.00",
    paymentDate: "2026-07-03",
    dueDate: "2026-07-20",
    status: "approved",
    createdBy: "Nattaya S.",
    createdAt: "2026-07-19 09:42",
    updatedBy: "Supaporn P.",
    updatedAt: "2026-07-22 11:15",
  },
  {
    key: "059",
    taskNo: "ZWT202606059",
    bookNo: "202606",
    period: "2026-06",
    company: "บริษัท เมืองทอง ดีเวลลอปเม้นท์ จำกัด",
    taxId: "0105556043371",
    whtType: "PND 3",
    incomeType: "ค่าเช่า",
    rate: "5%",
    documents: 1,
    amount: "86,000.00",
    taxAmount: "4,300.00",
    paymentDate: "2026-07-02",
    dueDate: "2026-07-20",
    status: "approved",
    createdBy: "Thanawat K.",
    createdAt: "2026-07-18 16:10",
    updatedBy: "Supaporn P.",
    updatedAt: "2026-07-21 16:40",
  },
  {
    key: "058",
    taskNo: "ZWT202606058",
    bookNo: "202606",
    period: "2026-06",
    company: "บริษัท กรุงเทพวิศวกรรม จำกัด",
    taxId: "0105549118870",
    whtType: "PND 53",
    incomeType: "ค่าบริการ",
    rate: "3%",
    documents: 2,
    amount: "58,600.00",
    taxAmount: "1,758.00",
    paymentDate: "2026-07-08",
    dueDate: "2026-07-28",
    status: "draft",
    createdBy: "Nattaya S.",
    createdAt: "2026-07-18 11:45",
    updatedBy: "Nattaya S.",
    updatedAt: "2026-07-21 09:22",
  },
  {
    key: "057",
    taskNo: "ZWT202606057",
    bookNo: "202606",
    period: "2026-06",
    company: "บริษัท โกลด์สตาร์ โลจิสติกส์ จำกัด",
    taxId: "0105551129764",
    whtType: "PND 3",
    incomeType: "ค่าบริการ",
    rate: "3%",
    documents: 4,
    amount: "192,000.00",
    taxAmount: "5,760.00",
    paymentDate: "2026-07-06",
    dueDate: "2026-07-25",
    status: "pending",
    createdBy: "Thanawat K.",
    createdAt: "2026-07-18 08:30",
    updatedBy: "Supaporn P.",
    updatedAt: "2026-07-20 17:05",
  },
  {
    key: "056",
    taskNo: "ZWT202606056",
    bookNo: "202606",
    period: "2026-06",
    company: "บริษัท พี.เจ. อีเลคทริค จำกัด",
    taxId: "0105550183057",
    whtType: "PND 53",
    incomeType: "ค่าจ้างทำของ",
    rate: "3%",
    documents: 2,
    amount: "73,400.00",
    taxAmount: "2,202.00",
    paymentDate: "2026-07-04",
    dueDate: "2026-07-20",
    status: "approved",
    createdBy: "Nattaya S.",
    createdAt: "2026-07-17 14:55",
    updatedBy: "Supaporn P.",
    updatedAt: "2026-07-20 15:10",
  },
  {
    key: "055",
    taskNo: "ZWT202606055",
    bookNo: "202606",
    period: "2026-06",
    company: "บริษัท ยูเนี่ยน ฟู้ดส์ จำกัด",
    taxId: "0105547015198",
    whtType: "PND 3",
    incomeType: "ค่าเช่า",
    rate: "5%",
    documents: 1,
    amount: "44,000.00",
    taxAmount: "2,200.00",
    paymentDate: "2026-07-09",
    dueDate: "2026-07-27",
    status: "draft",
    createdBy: "Thanawat K.",
    createdAt: "2026-07-17 09:18",
    updatedBy: "Thanawat K.",
    updatedAt: "2026-07-20 10:42",
  },
  {
    key: "054",
    taskNo: "ZWT202606054",
    bookNo: "202606",
    period: "2026-06",
    company: "บริษัท ไทยพัฒนา แมนูแฟคเจอริ่ง จำกัด",
    taxId: "0105553084150",
    whtType: "PND 53",
    incomeType: "ค่าบริการ",
    rate: "3%",
    documents: 2,
    amount: "310,500.00",
    taxAmount: "9,315.00",
    paymentDate: "2026-07-05",
    dueDate: "2026-07-24",
    status: "pending",
    createdBy: "Nattaya S.",
    createdAt: "2026-07-16 13:38",
    updatedBy: "Supaporn P.",
    updatedAt: "2026-07-19 18:03",
  },
  {
    key: "053",
    taskNo: "ZWT202606053",
    bookNo: "202606",
    period: "2026-06",
    company: "บริษัท เจริญทรัพย์ คอนสตรัคชั่น จำกัด",
    taxId: "0105554032988",
    whtType: "PND 3",
    incomeType: "ค่าจ้างทำของ",
    rate: "3%",
    documents: 3,
    amount: "168,000.00",
    taxAmount: "5,040.00",
    paymentDate: "2026-07-03",
    dueDate: "2026-07-20",
    status: "approved",
    createdBy: "Thanawat K.",
    createdAt: "2026-07-15 10:25",
    updatedBy: "Supaporn P.",
    updatedAt: "2026-07-19 14:55",
  },
  {
    key: "052",
    taskNo: "ZWT202606052",
    bookNo: "202606",
    period: "2026-06",
    company: "บริษัท พิทักษ์ โซลูชั่นส์ จำกัด",
    taxId: "0105552087042",
    whtType: "PND 53",
    incomeType: "ค่าบริการ",
    rate: "3%",
    documents: 2,
    amount: "96,200.00",
    taxAmount: "2,886.00",
    paymentDate: "2026-07-10",
    dueDate: "2026-07-27",
    status: "draft",
    createdBy: "Nattaya S.",
    createdAt: "2026-07-15 08:15",
    updatedBy: "Nattaya S.",
    updatedAt: "2026-07-19 11:30",
  },
  {
    key: "051",
    taskNo: "ZWT202606051",
    bookNo: "202606",
    period: "2026-06",
    company: "บริษัท เอส.พี. ซัพพลาย จำกัด",
    taxId: "0105551095232",
    whtType: "PND 3",
    incomeType: "ค่าบริการ",
    rate: "3%",
    documents: 2,
    amount: "51,000.00",
    taxAmount: "1,530.00",
    paymentDate: "2026-07-07",
    dueDate: "2026-07-25",
    status: "approved",
    createdBy: "Thanawat K.",
    createdAt: "2026-07-14 15:40",
    updatedBy: "Supaporn P.",
    updatedAt: "2026-07-18 16:28",
  },
  {
    key: "050",
    taskNo: "ZWT202606050",
    bookNo: "202606",
    period: "2026-06",
    company: "บริษัท เอเชีย แปซิฟิค เทรดดิ้ง จำกัด",
    taxId: "0105550214672",
    whtType: "PND 53",
    incomeType: "ค่าโฆษณา",
    rate: "2%",
    documents: 2,
    amount: "114,000.00",
    taxAmount: "2,280.00",
    paymentDate: "2026-07-03",
    dueDate: "2026-07-23",
    status: "pending",
    createdBy: "Nattaya S.",
    createdAt: "2026-07-14 09:05",
    updatedBy: "Supaporn P.",
    updatedAt: "2026-07-18 09:12",
  },
];

const statusClassNames = {
  approved: "status-approved",
  pending: "status-pending",
  draft: "status-draft",
};

function StatusTag({ status, t }) {
  const safeStatus = statusClassNames[status] ? status : "draft";
  return (
    <Tag className={`status-tag ${statusClassNames[safeStatus]}`}>
      {t(`status.${safeStatus}`)}
    </Tag>
  );
}

function DetailPanel({ task, onClose, onApprove, onReturn, t }) {
  if (!task) return null;

  const workflowItems = [
    {
      title: t("workflow.draft"),
      content: `${task.createdBy} · ${task.createdAt}`,
      status: "finish",
      icon: <CheckCircleFilled />,
    },
    {
      title:
        task.status === "approved" ? t("workflow.reviewed") : t("workflow.pendingReview"),
      content:
        task.status === "approved"
          ? `${task.updatedBy} · ${task.updatedAt}`
          : `${task.updatedBy} · ${task.updatedAt}`,
      status: task.status === "draft" ? "wait" : task.status === "approved" ? "finish" : "process",
    },
    {
      title: t("workflow.approved"),
      content: task.status === "approved" ? t("workflow.formalNumberLocked") : "—",
      status: task.status === "approved" ? "finish" : "wait",
    },
    {
      title: t("workflow.issued"),
      content: task.status === "approved" ? t("workflow.readyForDownload") : "—",
      status: task.status === "approved" ? "finish" : "wait",
    },
  ];

  const moreActions = {
    items: [
      { key: "download", label: t("action.downloadWorkingFiles") },
      { key: "history", label: t("action.viewVersionHistory") },
      { key: "audit", label: t("action.openAuditTrail") },
    ],
  };

  return (
    <aside className="detail-panel" aria-label={t("detail.region")}>
      <div className="detail-heading">
        <h2>{t("detail.title")}</h2>
        <Button
          type="text"
          icon={<CloseOutlined />}
          aria-label={t("detail.close")}
          onClick={onClose}
        />
      </div>

      <div className="detail-id-row">
        <div>
          <strong>{task.taskNo}</strong>
          <StatusTag status={task.status} t={t} />
        </div>
        <Button icon={<EditOutlined />} size="small">
          {t("common.edit")}
        </Button>
      </div>

      <section className="detail-section">
        <h3>{t("detail.basicInformation")}</h3>
        <Descriptions
          className="task-descriptions"
          column={1}
          colon={false}
          size="small"
          items={[
            {
              key: "task",
              label: t("field.taskNo"),
              children:
                task.taskNo === "Assigned after approval"
                  ? t("value.assignedAfterApproval")
                  : task.taskNo,
            },
            { key: "book", label: t("field.bookNo"), children: task.bookNo },
            { key: "period", label: t("field.period"), children: task.period },
            {
              key: "company",
              label: t("field.company"),
              children: (
                <span className="thai-copy" lang="th">
                  {task.company}
                </span>
              ),
            },
            { key: "tax", label: t("field.taxId"), children: task.taxId },
            { key: "type", label: t("field.whtType"), children: task.whtType },
            {
              key: "income",
              label: t("field.incomeType"),
              children:
                task.incomeType === "Pending entry" ? (
                  t("value.pendingEntry")
                ) : (
                  <span className="thai-copy" lang="th">
                    {task.incomeType}
                  </span>
                ),
            },
            { key: "rate", label: t("field.whtRate"), children: task.rate },
            { key: "files", label: t("field.documentCount"), children: task.documents },
            { key: "amount", label: t("field.totalAmount"), children: task.amount },
            { key: "taxAmount", label: t("field.whtAmount"), children: task.taxAmount },
            { key: "due", label: t("field.dueDate"), children: task.dueDate },
            { key: "creator", label: t("field.createdBy"), children: task.createdBy },
            { key: "created", label: t("field.createdAt"), children: task.createdAt },
            { key: "updatedBy", label: t("field.updatedBy"), children: task.updatedBy },
            { key: "updated", label: t("field.updatedAt"), children: task.updatedAt },
          ]}
        />
      </section>

      <section className="detail-section workflow-section">
        <h3>{t("detail.workflow")}</h3>
        <Steps orientation="vertical" size="small" items={workflowItems} />
      </section>

      <div className="detail-actions">
        {task.status !== "approved" && (
          <Button type="primary" block onClick={onApprove}>
            {t("action.review")}
          </Button>
        )}
        {task.status === "approved" && (
          <Button type="primary" block icon={<CheckCircleFilled />}>
            {t("action.downloadFormalFile")}
          </Button>
        )}
        <Button block onClick={onReturn}>
          {t("action.sendBackToDraft")}
        </Button>
        <Dropdown menu={moreActions} trigger={["click"]}>
          <Button block>
            {t("action.moreActions")} <DownOutlined />
          </Button>
        </Dropdown>
      </div>
    </aside>
  );
}

function FinanceWorkspace({ locale, onLocaleChange, t }) {
  const { message } = AntApp.useApp();
  const [tasks, setTasks] = useState(initialTasks);
  const [selectedKey, setSelectedKey] = useState("bk101");
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [advancedFilters, setAdvancedFilters] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [filters, setFilters] = useState({
    period: "2026-06",
    status: "all",
    bookNo: "all",
    company: "",
  });
  const [form] = Form.useForm();
  const navItems = [
    { key: "home", icon: <HomeOutlined />, label: t("nav.home") },
    { key: "wht", icon: <FileTextOutlined />, label: t("nav.wht") },
    { key: "tax-inv", icon: <FileTextOutlined />, label: t("nav.taxInvoice") },
    { key: "shared", icon: <DatabaseOutlined />, label: t("nav.sharedData") },
    { key: "links", icon: <LinkOutlined />, label: t("nav.relatedLinks") },
    { key: "admin", icon: <SettingOutlined />, label: t("nav.administration") },
  ];

  const selectedTask = tasks.find((task) => task.key === selectedKey) ?? tasks[0];

  const filteredTasks = useMemo(() => {
    const query = filters.company.trim().toLocaleLowerCase();
    return tasks.filter((task) => {
      const matchesPeriod = filters.period === "all" || task.period === filters.period;
      const matchesStatus = filters.status === "all" || task.status === filters.status;
      const matchesBook = filters.bookNo === "all" || task.bookNo === filters.bookNo;
      const matchesCompany =
        !query ||
        task.company.toLocaleLowerCase().includes(query) ||
        task.taskNo.toLocaleLowerCase().includes(query);
      return matchesPeriod && matchesStatus && matchesBook && matchesCompany;
    });
  }, [filters, tasks]);

  const selectTask = (record) => {
    setSelectedKey(record.key);
    setInspectorOpen(true);
  };

  const columns = [
    {
      title: t("field.taskNo"),
      dataIndex: "taskNo",
      width: 130,
      render: (value) => (
        <span className="task-number">
          {value === "Assigned after approval" ? t("value.assignedAfterApproval") : value}
        </span>
      ),
    },
    { title: t("field.bookNo"), dataIndex: "bookNo", width: 74 },
    { title: t("field.period"), dataIndex: "period", width: 68 },
    {
      title: t("field.companyName"),
      dataIndex: "company",
      width: 165,
      ellipsis: true,
      render: (value) => (
        <span className="thai-copy" lang="th">
          {value}
        </span>
      ),
    },
    { title: t("field.whtType"), dataIndex: "whtType", width: 65 },
    {
      title: t("filter.status"),
      dataIndex: "status",
      width: 102,
      render: (status) => <StatusTag status={status} t={t} />,
    },
    { title: t("field.dueDate"), dataIndex: "dueDate", width: 84 },
    { title: t("field.updatedAt"), dataIndex: "updatedAt", width: 112 },
  ];

  const resetFilters = () =>
    setFilters({ period: "2026-06", status: "all", bookNo: "all", company: "" });

  const createTask = async () => {
    const values = await form.validateFields();
    const newTask = {
      key: `draft-${Date.now()}`,
      taskNo: "Assigned after approval",
      bookNo: values.mode === "supplement" ? "2606BK2" : "202606",
      period: values.period,
      company: values.company,
      taxId: "—",
      whtType: values.whtType,
      incomeType: "Pending entry",
      rate: "—",
      documents: values.source === "excel" ? 1 : 0,
      amount: "0.00",
      taxAmount: "0.00",
      paymentDate: "—",
      dueDate: "2026-07-31",
      status: "draft",
      createdBy: "Supaporn P.",
      createdAt: "2026-07-23 14:45",
      updatedBy: "Supaporn P.",
      updatedAt: "2026-07-23 14:45",
    };
    setTasks((current) => [newTask, ...current]);
    setSelectedKey(newTask.key);
    setInspectorOpen(true);
    setCreateOpen(false);
    form.resetFields();
    message.success(t("message.draftCreated"));
  };

  const approveTask = () => {
    setTasks((current) =>
      current.map((task) =>
        task.key === selectedKey
          ? {
              ...task,
              status: "approved",
              updatedBy: "Supaporn P.",
              updatedAt: "2026-07-23 14:52",
            }
          : task,
      ),
    );
    setApproveOpen(false);
    message.success(t("message.taskApproved"));
  };

  const returnTask = () => {
    setTasks((current) =>
      current.map((task) =>
        task.key === selectedKey
          ? {
              ...task,
              status: "draft",
              updatedBy: "Supaporn P.",
              updatedAt: "2026-07-23 14:55",
            }
          : task,
      ),
    );
    setReturnOpen(false);
    message.success(t("message.taskReturned"));
  };

  return (
    <div className={`finance-app ${collapsed ? "is-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="wordmark" aria-label="ZWT Finance">
          <span>ZWT</span>
          {!collapsed && <em>Finance</em>}
        </div>

        <Menu
          mode="inline"
          selectedKeys={["wht"]}
          inlineCollapsed={collapsed}
          items={navItems}
          onClick={({ key }) => {
            if (key !== "wht") {
              message.info(t("message.prototypeFocus"));
            }
          }}
        />

        <Button
          className="collapse-button"
          type="text"
          icon={collapsed ? <MenuUnfoldOutlined /> : <LeftOutlined />}
          onClick={() => setCollapsed((value) => !value)}
        >
          {!collapsed && t("common.collapse")}
        </Button>
      </aside>

      <section className="app-frame">
        <header className="topbar">
          <Button
            className="menu-button"
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed((value) => !value)}
            aria-label={t("common.toggleNavigation")}
          />
          <div className="topbar-actions">
            <Tooltip title={t("common.search")}>
              <Button type="text" shape="circle" icon={<SearchOutlined />} />
            </Tooltip>
            <Badge count={3} size="small" color="#a9774d">
              <Button type="text" shape="circle" icon={<BellOutlined />} />
            </Badge>
            <Tooltip title={t("common.help")}>
              <Button type="text" shape="circle" icon={<QuestionCircleOutlined />} />
            </Tooltip>
            <Tooltip title={t("common.languageSwitch")}>
              <Button
                className="language-switch"
                type="text"
                icon={<GlobalOutlined />}
                onClick={() => onLocaleChange(locale === "zh-CN" ? "en-US" : "zh-CN")}
              >
                {t("common.languageButton")}
              </Button>
            </Tooltip>
            <span className="topbar-divider" />
            <Avatar className="user-avatar">SP</Avatar>
            <div className="user-copy">
              <strong>Supaporn P.</strong>
              <span lang={locale}>{t("role.supervisor")}</span>
            </div>
            <DownOutlined className="user-chevron" />
          </div>
        </header>

        <div className={`content-grid ${inspectorOpen ? "has-inspector" : ""}`}>
          <main className="workspace">
            <div className="page-heading">
              <div>
                <h1>
                  WHT{" "}
                  <span className={locale === "zh-CN" ? "cjk-display" : ""} lang={locale}>
                    {t("page.title")}
                  </span>
                </h1>
              </div>
              <Space size={12}>
                <Button
                  icon={<ExportOutlined />}
                  onClick={() => message.success(t("message.exportPrepared"))}
                >
                  {t("action.export")}
                </Button>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
                  {t("action.newWhtTask")}
                </Button>
              </Space>
            </div>

            <section className="filter-bar" aria-label={t("filter.region")}>
              <div className="filter-field">
                <label>{t("filter.period")}</label>
                <Select
                  value={filters.period}
                  onChange={(period) => setFilters((current) => ({ ...current, period }))}
                  options={[
                    { value: "2026-06", label: "2026-06" },
                    { value: "2026-05", label: "2026-05" },
                    { value: "all", label: t("filter.allPeriods") },
                  ]}
                />
              </div>
              <div className="filter-field">
                <label>{t("filter.status")}</label>
                <Select
                  value={filters.status}
                  onChange={(status) => setFilters((current) => ({ ...current, status }))}
                  options={[
                    { value: "all", label: t("common.all") },
                    { value: "pending", label: t("status.pending") },
                    { value: "approved", label: t("status.approved") },
                    { value: "draft", label: t("status.draft") },
                  ]}
                />
              </div>
              <div className="filter-field">
                <label>{t("filter.bookNo")}</label>
                <Select
                  value={filters.bookNo}
                  onChange={(bookNo) => setFilters((current) => ({ ...current, bookNo }))}
                  options={[
                    { value: "all", label: t("filter.selectBook") },
                    { value: "202606", label: "202606" },
                    { value: "2606BK1", label: "2606BK1" },
                  ]}
                />
              </div>
              <div className="filter-field company-filter">
                <label>{t("filter.company")}</label>
                <Input
                  value={filters.company}
                  prefix={<SearchOutlined />}
                  placeholder={t("filter.companyPlaceholder")}
                  allowClear
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, company: event.target.value }))
                  }
                />
              </div>
              <Button
                className={`more-filters ${advancedFilters ? "is-active" : ""}`}
                icon={<FilterOutlined />}
                onClick={() => setAdvancedFilters((value) => !value)}
              >
                {t("action.moreFilters")}
              </Button>
            </section>

            {advancedFilters && (
              <div className="advanced-filter-row">
                <span>{t("filter.whtTypeAll")}</span>
                <span>{t("filter.paymentDateAny")}</span>
                <span>{t("filter.createdByAnyone")}</span>
                <Button type="link" onClick={resetFilters}>
                  {t("action.resetFilters")}
                </Button>
              </div>
            )}

            <div className="list-toolbar">
              <span>
                {filteredTasks.length === tasks.length ? (
                  <>
                    <strong>78</strong> {t("list.tasksSuffix")}
                  </>
                ) : (
                  <>
                    <strong>{filteredTasks.length}</strong> {t("list.matchingTasksSuffix")}
                  </>
                )}
              </span>
              <Tooltip title={t("action.refresh")}>
                <Button
                  type="text"
                  icon={<ReloadOutlined />}
                  onClick={() => message.success(t("message.taskListRefreshed"))}
                />
              </Tooltip>
            </div>

            <div className="task-table">
              <Table
                rowKey="key"
                columns={columns}
                dataSource={filteredTasks}
                pagination={false}
                size="middle"
                scroll={{ x: 840 }}
                rowSelection={{
                  type: "checkbox",
                  selectedRowKeys: [selectedKey],
                  onChange: (keys) => {
                    const nextKey = keys.find((key) => key !== selectedKey) ?? keys.at(-1);
                    const next = tasks.find((task) => task.key === nextKey);
                    if (next) selectTask(next);
                  },
                  columnWidth: 40,
                }}
                rowClassName={(record) => (record.key === selectedKey ? "selected-task-row" : "")}
                onRow={(record) => ({
                  onClick: () => selectTask(record),
                })}
              />
            </div>

            <footer className="table-footer">
              <div className="page-size">
                <span>{t("list.show")}</span>
                <Select
                  defaultValue="25"
                  options={[
                    { value: "10", label: "10" },
                    { value: "25", label: "25" },
                    { value: "50", label: "50" },
                  ]}
                />
                <span>{t("list.perPage")}</span>
              </div>
              <div className="pagination">
                <Button icon={<LeftOutlined />} aria-label={t("common.previousPage")} />
                <Button className="current-page">1</Button>
                <Button>2</Button>
                <Button>3</Button>
                <Button>4</Button>
                <Button icon={<RightOutlined />} aria-label={t("common.nextPage")} />
              </div>
            </footer>
          </main>

          {inspectorOpen && (
            <DetailPanel
              task={selectedTask}
              onClose={() => setInspectorOpen(false)}
              onApprove={() => setApproveOpen(true)}
              onReturn={() => setReturnOpen(true)}
              t={t}
            />
          )}
        </div>
      </section>

      <Modal
        title={t("modal.newTaskTitle")}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={createTask}
        okText={t("modal.createDraft")}
        cancelText={t("common.cancel")}
        width={560}
      >
        <p className="modal-intro">{t("modal.newTaskIntro")}</p>
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            period: "2026-06",
            mode: "normal",
            whtType: "PND 3",
            source: "web",
          }}
        >
          <div className="modal-field-grid">
            <Form.Item name="period" label={t("filter.period")} rules={[{ required: true }]}>
              <Select
                options={[
                  { value: "2026-06", label: "2026-06" },
                  { value: "2026-05", label: "2026-05" },
                ]}
              />
            </Form.Item>
            <Form.Item name="whtType" label={t("field.whtType")} rules={[{ required: true }]}>
              <Select
                options={[
                  { value: "PND 3", label: "PND 3" },
                  { value: "PND 53", label: "PND 53" },
                ]}
              />
            </Form.Item>
          </div>
          <Form.Item name="mode" label={t("modal.issuanceType")} rules={[{ required: true }]}>
            <Radio.Group
              options={[
                { value: "normal", label: t("modal.normalPeriod") },
                { value: "supplement", label: t("modal.supplement") },
              ]}
            />
          </Form.Item>
          <Form.Item name="company" label={t("modal.payeeCompany")} rules={[{ required: true }]}>
            <Input placeholder={t("modal.companyPlaceholder")} />
          </Form.Item>
          <Form.Item name="source" label={t("modal.entryMethod")} rules={[{ required: true }]}>
            <Radio.Group
              options={[
                { value: "web", label: t("modal.webEntry") },
                { value: "excel", label: t("modal.importExcel") },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("modal.approveTitle")}
        open={approveOpen}
        onCancel={() => setApproveOpen(false)}
        onOk={approveTask}
        okText={t("modal.approveLock")}
        cancelText={t("common.cancel")}
      >
        <p className="confirmation-copy">{t("modal.approveCopy")}</p>
      </Modal>

      <Modal
        title={t("modal.returnTitle")}
        open={returnOpen}
        onCancel={() => setReturnOpen(false)}
        onOk={returnTask}
        okText={t("modal.returnToDraft")}
        cancelText={t("common.cancel")}
      >
        <Input.TextArea
          key={`return-reason-${locale}`}
          rows={4}
          defaultValue={t("modal.returnReason")}
          aria-label={t("modal.returnReasonLabel")}
        />
        <p className="confirmation-copy">{t("modal.returnAuditCopy")}</p>
      </Modal>
    </div>
  );
}

export function App() {
  const [locale, setLocale] = useState("zh-CN");
  const t = useMemo(() => createTranslator(locale), [locale]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <ConfigProvider
      locale={locale === "zh-CN" ? zhCN : enUS}
      theme={{
        token: {
          colorPrimary: "#a9774d",
          colorInfo: "#a9774d",
          colorSuccess: "#5f7756",
          colorWarning: "#d58a29",
          colorError: "#b75048",
          colorText: "#24211e",
          colorTextSecondary: "#6d675f",
          colorBorder: "#ded8d0",
          colorBgContainer: "#fffdf9",
          colorBgElevated: "#fffdf9",
          borderRadius: 8,
          borderRadiusLG: 10,
          fontFamily: "var(--font-ui)",
          fontSize: 14,
          controlHeight: 38,
          boxShadowSecondary: "0 14px 38px rgba(58, 48, 39, 0.12)",
        },
        components: {
          Button: {
            primaryShadow: "none",
            fontWeight: 600,
          },
          Menu: {
            itemBg: "transparent",
            itemColor: "#3f3a35",
            itemSelectedBg: "#f1ece6",
            itemSelectedColor: "#24211e",
            itemHoverBg: "#f7f3ee",
            itemBorderRadius: 7,
          },
          Table: {
            headerBg: "#f9f6f1",
            headerColor: "#655f58",
            rowHoverBg: "#faf6f0",
            borderColor: "#ebe6df",
            cellPaddingBlockMD: 13,
            cellPaddingInlineMD: 12,
          },
          Input: {
            activeBorderColor: "#a9774d",
            hoverBorderColor: "#b98a62",
          },
          Select: {
            activeBorderColor: "#a9774d",
            hoverBorderColor: "#b98a62",
            optionSelectedBg: "#f1ece6",
          },
          Modal: {
            titleFontSize: 21,
          },
        },
      }}
    >
      <AntApp>
        <FinanceWorkspace locale={locale} onLocaleChange={setLocale} t={t} />
      </AntApp>
    </ConfigProvider>
  );
}
