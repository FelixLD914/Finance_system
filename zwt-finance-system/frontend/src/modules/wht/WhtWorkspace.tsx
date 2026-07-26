import { useEffect, useMemo, useState } from "react";
import {
  CheckCircleFilled,
  CloseOutlined,
  DownloadOutlined,
  EditOutlined,
  FileDoneOutlined,
  FilterOutlined,
  PlusOutlined,
  ReloadOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App as AntApp,
  Button,
  Checkbox,
  DatePicker,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Steps,
  Table,
  Tag,
  Upload,
} from "antd";
import type { UploadProps } from "antd";
import type { ColumnsType } from "antd/es/table";

import type { Translate } from "../../i18n";
import { ThaiText } from "../../shared/ThaiText";
import {
  downloadWhtDocument,
  generateWhtDocuments,
  listSignatures,
  listWhtDocuments,
} from "./api";
import { PayeeDirectory } from "./PayeeDirectory";
import { SignatureLibrary } from "./SignatureLibrary";
import type { SignatureAsset, WhtDocument, WhtStatus, WhtTask } from "./types";
import { useWhtData } from "./useWhtData";

interface WhtWorkspaceProps {
  t: Translate;
}

interface Filters {
  period: string;
  status: WhtStatus | "all";
  bookNo: string;
  query: string;
}

const statusClass: Record<WhtStatus, string> = {
  approved: "status-approved",
  draft: "status-draft",
  issued: "status-issued",
  pending_review: "status-pending",
  voided: "status-voided",
};

function statusLabel(status: WhtStatus, t: Translate): string {
  const key = {
    approved: "status.approved",
    draft: "status.draft",
    issued: "status.issued",
    pending_review: "status.pendingReview",
    voided: "status.voided",
  }[status] as Parameters<Translate>[0];
  return t(key);
}

function StatusTag({ status, t }: { status: WhtStatus; t: Translate }) {
  return (
    <Tag className={`status-tag ${statusClass[status]}`}>
      {statusLabel(status, t)}
    </Tag>
  );
}

function formatMoney(value: string): string {
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat("zh-CN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(number)
    : "—";
}

function formatRate(value: string | null): string {
  if (value === null) return "—";
  const number = Number(value);
  return Number.isFinite(number)
    ? `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(number * 100)}%`
    : "—";
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function DetailPanel({
  task,
  documents,
  t,
  pending,
  onClose,
  onAction,
  onDownload,
  onGenerate,
}: {
  task: WhtTask;
  documents: WhtDocument[];
  t: Translate;
  pending: boolean;
  onClose: () => void;
  onAction: (
    action: "submit-review" | "approve" | "return-to-draft",
  ) => Promise<void>;
  onDownload: (document: WhtDocument) => Promise<void>;
  onGenerate: () => void;
}) {
  const value = (content: string | number | null) => content ?? "—";
  const isFormal = task.status === "approved" || task.status === "issued";
  const workflow =
    task.events.length > 0
      ? task.events.map((event) => ({
          title: statusLabel(event.toStatus, t),
          content: `${event.actorName} · ${formatDateTime(event.createdAt)}`,
        }))
      : [
          {
            title: t("status.draft"),
            content: `${task.createdByName} · ${formatDateTime(task.createdAt)}`,
          },
          ...(task.status !== "draft" ? [{ title: t("status.pendingReview") }] : []),
          ...(isFormal ? [{ title: t("status.approved") }] : []),
        ];

  return (
    <aside className="task-inspector" aria-label={t("wht.basicInfo")}>
      <div className="inspector-header">
        <div>
          <h2>{task.taskNo ?? t("wht.pendingNumber")}</h2>
          <StatusTag status={task.status} t={t} />
        </div>
        <div className="inspector-header-actions">
          <Button disabled={task.status !== "draft"} icon={<EditOutlined />} size="small">
            {t("common.edit")}
          </Button>
          <Button
            aria-label={t("common.close")}
            icon={<CloseOutlined />}
            size="small"
            type="text"
            onClick={onClose}
          />
        </div>
      </div>

      <section className="inspector-section">
        <h3>{t("wht.basicInfo")}</h3>
        <Descriptions
          className="task-descriptions"
          column={1}
          colon={false}
          size="small"
          items={[
            { key: "task", label: t("wht.taskNo"), children: value(task.taskNo) },
            { key: "book", label: t("wht.bookNo"), children: value(task.bookNo) },
            { key: "period", label: t("wht.period"), children: task.period },
            {
              key: "company",
              label: t("wht.company"),
              children: <ThaiText>{task.companyName}</ThaiText>,
            },
            { key: "tax", label: t("wht.taxId"), children: value(task.taxId) },
            { key: "type", label: t("wht.type"), children: value(task.whtType) },
            {
              key: "income",
              label: t("wht.incomeType"),
              children: task.incomeType ? <ThaiText>{task.incomeType}</ThaiText> : "—",
            },
            { key: "payment", label: t("wht.paymentDate"), children: value(task.paymentDate) },
            { key: "rate", label: t("wht.rate"), children: formatRate(task.whtRate) },
            {
              key: "documents",
              label: t("wht.documentCount"),
              children: task.documentCount,
            },
            {
              key: "amount",
              label: t("wht.totalAmount"),
              children: formatMoney(task.totalAmount),
            },
            {
              key: "wht",
              label: t("wht.whtAmount"),
              children: formatMoney(task.whtAmount),
            },
            { key: "due", label: t("wht.dueDate"), children: value(task.dueDate) },
            {
              key: "createdBy",
              label: t("wht.createdBy"),
              children: task.createdByName,
            },
            {
              key: "createdAt",
              label: t("wht.createdAt"),
              children: formatDateTime(task.createdAt),
            },
            {
              key: "updatedBy",
              label: t("wht.updatedBy"),
              children: task.updatedByName,
            },
            {
              key: "updatedAt",
              label: t("wht.updatedAt"),
              children: formatDateTime(task.updatedAt),
            },
          ]}
        />
      </section>

      <section className="inspector-section workflow-section">
        <h3>{t("wht.workflow")}</h3>
        <Steps orientation="vertical" size="small" items={workflow} />
      </section>

      {isFormal && (
        <section className="inspector-section generated-documents">
          <h3>{t("wht.generatedDocuments")}</h3>
          {documents.length === 0 ? (
            <p className="empty-document-copy">{t("wht.noDocuments")}</p>
          ) : (
            <div className="document-list">
              {documents.map((document) => (
                <div className="document-item" key={document.id}>
                  <div>
                    <strong>{document.fileFormat.toUpperCase()}</strong>
                    <span>
                      v{document.version} · {formatDateTime(document.createdAt)}
                    </span>
                  </div>
                  <Button
                    aria-label={`${t("wht.downloadFile")} ${document.fileFormat}`}
                    icon={<DownloadOutlined />}
                    size="small"
                    type="text"
                    onClick={() => void onDownload(document)}
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="inspector-actions">
        {task.status === "draft" && (
          <Button
            block
            loading={pending}
            type="primary"
            onClick={() => void onAction("submit-review")}
          >
            {t("wht.submitReview")}
          </Button>
        )}
        {task.status === "pending_review" && (
          <>
            <Button
              block
              loading={pending}
              type="primary"
              onClick={() => void onAction("approve")}
            >
              {t("wht.approveAndNumber")}
            </Button>
            <Button
              block
              disabled={pending}
              onClick={() => void onAction("return-to-draft")}
            >
              {t("wht.returnDraft")}
            </Button>
          </>
        )}
        {isFormal && (
          <>
            <Button
              block
              icon={<FileDoneOutlined />}
              loading={pending}
              type="primary"
              onClick={onGenerate}
            >
              {t("wht.generateDocuments")}
            </Button>
            <Button block disabled icon={<CheckCircleFilled />}>
              {t("wht.formalNumberReady")}
            </Button>
          </>
        )}
      </div>
    </aside>
  );
}

export function WhtWorkspace({ t }: WhtWorkspaceProps) {
  const { message } = AntApp.useApp();
  const {
    tasks,
    payees,
    loading,
    mutationPending,
    error,
    reload,
    loadTaskDetail,
    createTask,
    transitionTask,
    persistPayee,
    uploadPayees,
    uploadHistoricalTasks,
  } = useWhtData();
  const [view, setView] = useState<"tasks" | "payees" | "signatures">("tasks");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [documentPending, setDocumentPending] = useState(false);
  const [documents, setDocuments] = useState<WhtDocument[]>([]);
  const [signatures, setSignatures] = useState<SignatureAsset[]>([]);
  const [form] = Form.useForm();
  const [generateForm] = Form.useForm();
  const issuanceType = Form.useWatch("issuanceType", form);
  const includeSignature = Form.useWatch("includeSignature", generateForm);
  const [filters, setFilters] = useState<Filters>({
    period: "2026-06",
    status: "all",
    bookNo: "all",
    query: "",
  });

  useEffect(() => {
    if (!selectedId && tasks[0]) setSelectedId(tasks[0].id);
    if (selectedId && !tasks.some((task) => task.id === selectedId)) {
      setSelectedId(tasks[0]?.id ?? null);
    }
  }, [selectedId, tasks]);

  const periodOptions = useMemo(
    () =>
      [...new Set(["2026-06", ...tasks.map((task) => task.period)])]
        .sort()
        .reverse()
        .map((period) => ({ value: period, label: period })),
    [tasks],
  );
  const bookOptions = useMemo(
    () =>
      [...new Set(tasks.map((task) => task.bookNo).filter(Boolean))]
        .sort()
        .map((bookNo) => ({ value: bookNo as string, label: bookNo as string })),
    [tasks],
  );

  const filteredTasks = useMemo(() => {
    const query = filters.query.trim().toLocaleLowerCase();
    return tasks.filter((task) => {
      const matchesPeriod = filters.period === "all" || task.period === filters.period;
      const matchesStatus = filters.status === "all" || task.status === filters.status;
      const matchesBook = filters.bookNo === "all" || task.bookNo === filters.bookNo;
      const matchesQuery =
        !query ||
        task.companyName.toLocaleLowerCase().includes(query) ||
        task.companyNameEn?.toLocaleLowerCase().includes(query) ||
        task.taxId?.includes(query) ||
        task.taskNo?.toLocaleLowerCase().includes(query);
      return matchesPeriod && matchesStatus && matchesBook && matchesQuery;
    });
  }, [filters, tasks]);

  const selectedTask = tasks.find((task) => task.id === selectedId);

  useEffect(() => {
    if (!selectedTask || !["approved", "issued"].includes(selectedTask.status)) {
      setDocuments([]);
      return;
    }
    let active = true;
    void listWhtDocuments(selectedTask.id)
      .then((items) => {
        if (active) setDocuments(items);
      })
      .catch((loadError) => {
        if (active && loadError instanceof Error) message.error(loadError.message);
      });
    return () => {
      active = false;
    };
  }, [message, selectedTask]);

  const columns: ColumnsType<WhtTask> = [
    {
      title: t("wht.taskNo"),
      dataIndex: "taskNo",
      width: 140,
      render: (taskNo: string | null) => (
        <strong className="task-number">{taskNo ?? t("wht.pendingNumber")}</strong>
      ),
    },
    { title: t("wht.bookNo"), dataIndex: "bookNo", width: 84, render: value => value ?? "—" },
    { title: t("wht.period"), dataIndex: "period", width: 82 },
    {
      title: t("wht.companyName"),
      dataIndex: "companyName",
      width: 180,
      ellipsis: true,
      render: (company: string) => <ThaiText>{company}</ThaiText>,
    },
    { title: t("wht.type"), dataIndex: "whtType", width: 74, render: value => value ?? "—" },
    {
      title: t("wht.status"),
      dataIndex: "status",
      width: 98,
      render: (status: WhtStatus) => <StatusTag status={status} t={t} />,
    },
    {
      title: t("wht.paymentDate"),
      dataIndex: "paymentDate",
      width: 102,
      render: (value: string | null) => <span className="date-value">{value ?? "—"}</span>,
    },
    {
      title: t("wht.updatedAt"),
      dataIndex: "updatedAt",
      width: 142,
      render: (value: string) => <span className="date-value">{formatDateTime(value)}</span>,
    },
  ];

  const createDraft = async () => {
    try {
      const values = await form.validateFields();
      const task = await createTask({
        period: values.period,
        issuanceType: values.issuanceType,
        supplementRun: values.issuanceType === "supplement" ? values.supplementRun : 0,
        payeeId: values.payeeId,
        incomeType: values.incomeType,
        paymentDate: values.paymentDate.format("YYYY-MM-DD"),
        whtRate: values.whtRate / 100,
        totalAmount: values.totalAmount,
        documentCount: values.documentCount,
      });
      setSelectedId(task.id);
      setInspectorOpen(true);
      setCreateOpen(false);
      form.resetFields();
      message.success(t("common.createDraft"));
    } catch (createError) {
      if (createError instanceof Error) message.error(createError.message);
    }
  };

  const handleAction = async (
    action: "submit-review" | "approve" | "return-to-draft",
  ) => {
    if (!selectedTask) return;
    try {
      const updated = await transitionTask(selectedTask, action);
      message.success(
        action === "approve"
          ? t("wht.numberAssigned", { number: updated.taskNo ?? "" })
          : t("common.saved"),
      );
    } catch (transitionError) {
      if (transitionError instanceof Error) message.error(transitionError.message);
    }
  };

  const openDocumentGenerator = async () => {
    try {
      setDocumentPending(true);
      const items = await listSignatures(false);
      setSignatures(items);
      const defaultSignature = items.find((signature) => signature.isDefault) ?? items[0];
      generateForm.setFieldsValue({
        includeSignature: Boolean(defaultSignature),
        signatureId: defaultSignature?.id,
        formats: ["xlsx", "pdf"],
      });
      setGenerateOpen(true);
    } catch (loadError) {
      if (loadError instanceof Error) message.error(loadError.message);
    } finally {
      setDocumentPending(false);
    }
  };

  const generateDocuments = async () => {
    if (!selectedTask) return;
    try {
      const values = await generateForm.validateFields();
      setDocumentPending(true);
      const created = await generateWhtDocuments(selectedTask.id, {
        includeSignature: Boolean(values.includeSignature),
        signatureId: values.includeSignature ? values.signatureId : null,
        formats: values.formats,
      });
      setDocuments((current) => [...created, ...current]);
      setGenerateOpen(false);
      message.success(t("wht.generateCompleted"));
      await reload();
    } catch (generationError) {
      if (generationError instanceof Error) message.error(generationError.message);
    } finally {
      setDocumentPending(false);
    }
  };

  const downloadDocument = async (document: WhtDocument) => {
    try {
      await downloadWhtDocument(document);
    } catch (downloadError) {
      if (downloadError instanceof Error) message.error(downloadError.message);
    }
  };

  const historyImport: UploadProps["customRequest"] = async ({
    file,
    onSuccess,
    onError,
  }) => {
    try {
      const result = await uploadHistoricalTasks(file as File);
      message.success(
        t("wht.historyImportCompleted", {
          created: result.created,
          skipped: result.skipped,
        }),
      );
      onSuccess?.(result);
    } catch (importError) {
      const resolved =
        importError instanceof Error ? importError : new Error(String(importError));
      message.error(resolved.message);
      onError?.(resolved);
    }
  };

  const taskView = (
    <section className="workspace-main">
      <div className="page-heading">
        <div>
          <h1>
            <span>WHT</span>
            <small>{t("wht.title")}</small>
          </h1>
          <div className="workspace-view-switch" role="tablist">
            <button
              className={view === "tasks" ? "is-active" : ""}
              type="button"
              onClick={() => setView("tasks")}
            >
              {t("wht.taskLedger")}
            </button>
            <button
              className={view === "payees" ? "is-active" : ""}
              type="button"
              onClick={() => setView("payees")}
            >
              {t("wht.payeeMaster")}
            </button>
            <button
              className={view === "signatures" ? "is-active" : ""}
              type="button"
              onClick={() => setView("signatures")}
            >
              {t("wht.signatureLibrary")}
            </button>
          </div>
        </div>
        <div className="page-actions">
          <Upload
            accept=".xlsx"
            customRequest={historyImport}
            disabled={mutationPending}
            maxCount={1}
            showUploadList={false}
          >
            <Button icon={<UploadOutlined />} loading={mutationPending}>
              {t("wht.importHistory")}
            </Button>
          </Upload>
          <Button icon={<PlusOutlined />} type="primary" onClick={() => setCreateOpen(true)}>
            {t("wht.newTask")}
          </Button>
        </div>
      </div>

      {error && (
        <Alert
          className="workspace-alert"
          showIcon
          type="error"
          message={t("common.loadFailed")}
          description={error}
          action={
            <Button size="small" onClick={() => void reload()}>
              {t("common.retry")}
            </Button>
          }
        />
      )}

      <section className="work-surface">
        <div className="filter-bar">
          <label>
            <span>{t("wht.period")}</span>
            <Select
              value={filters.period}
              options={[...periodOptions, { value: "all", label: t("wht.all") }]}
              onChange={(period) => setFilters((current) => ({ ...current, period }))}
            />
          </label>
          <label>
            <span>{t("wht.status")}</span>
            <Select
              value={filters.status}
              options={[
                { value: "all", label: t("wht.all") },
                { value: "draft", label: t("status.draft") },
                { value: "pending_review", label: t("status.pendingReview") },
                { value: "approved", label: t("status.approved") },
                { value: "issued", label: t("status.issued") },
                { value: "voided", label: t("status.voided") },
              ]}
              onChange={(status) => setFilters((current) => ({ ...current, status }))}
            />
          </label>
          <label>
            <span>{t("wht.bookNo")}</span>
            <Select
              value={filters.bookNo}
              options={[
                { value: "all", label: t("wht.selectBook") },
                ...bookOptions,
              ]}
              onChange={(bookNo) => setFilters((current) => ({ ...current, bookNo }))}
            />
          </label>
          <label className="company-search">
            <span>{t("wht.company")}</span>
            <Input
              allowClear
              placeholder={t("wht.searchPlaceholder")}
              value={filters.query}
              onChange={(event) =>
                setFilters((current) => ({ ...current, query: event.target.value }))
              }
            />
          </label>
          <Button className="more-filter-button" icon={<FilterOutlined />}>
            {t("wht.moreFilters")}
          </Button>
        </div>

        <div className="table-toolbar">
          <strong>{t("wht.taskCount", { count: filteredTasks.length })}</strong>
          <Button
            aria-label={t("common.reload")}
            icon={<ReloadOutlined />}
            loading={loading}
            type="text"
            onClick={() => void reload()}
          />
        </div>

        <Table<WhtTask>
          columns={columns}
          dataSource={filteredTasks}
          loading={loading}
          pagination={{ pageSize: 8, hideOnSinglePage: true }}
          rowKey="id"
          scroll={{ x: 900 }}
          tableLayout="fixed"
          rowClassName={(record) => (record.id === selectedId ? "selected-row" : "")}
          onRow={(record) => ({
            onClick: () => {
              setSelectedId(record.id);
              setInspectorOpen(true);
              void loadTaskDetail(record.id);
            },
          })}
        />
      </section>
    </section>
  );

  const payeeView = (
    <section className="workspace-main">
      <div className="page-heading">
        <div>
          <h1>
            <span>WHT</span>
            <small>{t("wht.payeeMaster")}</small>
          </h1>
          <div className="workspace-view-switch" role="tablist">
            <button type="button" onClick={() => setView("tasks")}>
              {t("wht.taskLedger")}
            </button>
            <button className="is-active" type="button" onClick={() => setView("payees")}>
              {t("wht.payeeMaster")}
            </button>
            <button type="button" onClick={() => setView("signatures")}>
              {t("wht.signatureLibrary")}
            </button>
          </div>
        </div>
      </div>
      <PayeeDirectory
        error={error}
        loading={loading}
        payees={payees}
        pending={mutationPending}
        t={t}
        onImport={uploadPayees}
        onSave={persistPayee}
      />
    </section>
  );

  const signatureView = (
    <section className="workspace-main">
      <div className="page-heading">
        <div>
          <h1>
            <span>WHT</span>
            <small>{t("wht.signatureLibrary")}</small>
          </h1>
          <div className="workspace-view-switch" role="tablist">
            <button type="button" onClick={() => setView("tasks")}>
              {t("wht.taskLedger")}
            </button>
            <button type="button" onClick={() => setView("payees")}>
              {t("wht.payeeMaster")}
            </button>
            <button
              className="is-active"
              type="button"
              onClick={() => setView("signatures")}
            >
              {t("wht.signatureLibrary")}
            </button>
          </div>
        </div>
      </div>
      <SignatureLibrary t={t} />
    </section>
  );

  return (
    <div className={`workspace ${view === "tasks" && inspectorOpen ? "with-inspector" : ""}`}>
      {view === "tasks" ? taskView : view === "payees" ? payeeView : signatureView}

      {view === "tasks" && inspectorOpen && selectedTask && (
        <DetailPanel
          documents={documents}
          pending={mutationPending || documentPending}
          task={selectedTask}
          t={t}
          onAction={handleAction}
          onClose={() => setInspectorOpen(false)}
          onDownload={downloadDocument}
          onGenerate={() => void openDocumentGenerator()}
        />
      )}

      <Modal
        destroyOnHidden
        open={createOpen}
        title={t("wht.newTask")}
        okText={t("common.createDraft")}
        cancelText={t("common.cancel")}
        confirmLoading={mutationPending}
        onCancel={() => setCreateOpen(false)}
        onOk={createDraft}
      >
        <p className="modal-intro">{t("wht.numberHint")}</p>
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            period: "2026-06",
            issuanceType: "normal",
            supplementRun: 1,
            whtRate: 3,
            documentCount: 1,
          }}
        >
          <div className="task-form-grid">
            <Form.Item name="period" label={t("wht.period")} rules={[{ required: true }]}>
              <Select options={periodOptions} />
            </Form.Item>
            <Form.Item
              name="issuanceType"
              label={t("wht.issuanceType")}
              rules={[{ required: true }]}
            >
              <Radio.Group
                options={[
                  { value: "normal", label: t("wht.normal") },
                  { value: "supplement", label: t("wht.supplement") },
                ]}
              />
            </Form.Item>
          </div>
          {issuanceType === "supplement" && (
            <Form.Item
              name="supplementRun"
              label={t("wht.supplementRun")}
              rules={[{ required: true }]}
            >
              <InputNumber min={1} max={9} precision={0} />
            </Form.Item>
          )}
          <Form.Item name="payeeId" label={t("wht.payee")} rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder={t("wht.selectPayee")}
              options={payees
                .filter((payee) => payee.isActive)
                .map((payee) => ({
                  value: payee.id,
                  label: `${payee.nameTh} · ${payee.taxId}`,
                }))}
            />
          </Form.Item>
          <div className="task-form-grid">
            <Form.Item
              name="paymentDate"
              label={t("wht.paymentDate")}
              rules={[{ required: true }]}
            >
              <DatePicker format="YYYY-MM-DD" />
            </Form.Item>
            <Form.Item
              name="incomeType"
              label={t("wht.incomeType")}
              rules={[{ required: true }]}
            >
              <Input className="thai-input" placeholder="ค่าบริการ" />
            </Form.Item>
          </div>
          <div className="task-form-grid task-form-grid-three">
            <Form.Item
              name="totalAmount"
              label={t("wht.totalAmount")}
              rules={[{ required: true }]}
            >
              <InputNumber min={0.01} precision={2} />
            </Form.Item>
            <Form.Item
              name="whtRate"
              label={t("wht.ratePercent")}
              rules={[{ required: true }]}
            >
              <InputNumber min={0.01} max={100} precision={2} suffix="%" />
            </Form.Item>
            <Form.Item
              name="documentCount"
              label={t("wht.documentCount")}
              rules={[{ required: true }]}
            >
              <InputNumber min={0} precision={0} />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      <Modal
        destroyOnHidden
        forceRender
        open={generateOpen}
        title={t("wht.generateDocuments")}
        okText={t("wht.generateDocuments")}
        cancelText={t("common.cancel")}
        confirmLoading={documentPending}
        onCancel={() => setGenerateOpen(false)}
        onOk={() => void generateDocuments()}
      >
        <Form form={generateForm} layout="vertical">
          <Form.Item
            name="formats"
            label={t("wht.outputFormats")}
            rules={[{ required: true, message: t("wht.outputFormats") }]}
          >
            <Checkbox.Group
              options={[
                { value: "xlsx", label: "Excel (.xlsx)" },
                { value: "pdf", label: "PDF (.pdf)" },
              ]}
            />
          </Form.Item>
          <Form.Item name="includeSignature" valuePropName="checked">
            <Checkbox>{t("wht.includeSignature")}</Checkbox>
          </Form.Item>
          {includeSignature && (
            <Form.Item
              name="signatureId"
              label={t("wht.selectSignature")}
              rules={[{ required: true }]}
            >
              <Select
                options={signatures.map((signature) => ({
                  value: signature.id,
                  label: `${signature.name} · v${signature.version}${
                    signature.isDefault ? ` · ${t("wht.defaultSignature")}` : ""
                  }`,
                }))}
              />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}
