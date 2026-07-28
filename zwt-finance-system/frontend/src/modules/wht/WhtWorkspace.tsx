import { useEffect, useMemo, useState } from "react";
import {
  CheckCircleFilled,
  CloseOutlined,
  DownloadOutlined,
  DownOutlined,
  EditOutlined,
  FileDoneOutlined,
  FileExcelOutlined,
  FilterOutlined,
  HistoryOutlined,
  PlusOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App as AntApp,
  AutoComplete,
  Button,
  Checkbox,
  DatePicker,
  Descriptions,
  Dropdown,
  Empty,
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
import type { ColumnsType } from "antd/es/table";

import type { Locale, Translate } from "../../i18n";
import { FinanceLifecycleTabs, type FinanceLifecyclePhase } from "../../ui";
import { ApiError } from "../../shared/http";
import { ThaiText } from "../../shared/ThaiText";
import {
  downloadBatchTemplate,
  downloadWhtDocument,
  generateWhtDocuments,
  listSignatures,
  listWhtDocuments,
} from "./api";
import { PayeeDirectory } from "./PayeeDirectory";
import type {
  IncomeTypeOption,
  SignatureAsset,
  WhtDocument,
  WhtStatus,
  WhtTask,
  WhtType,
} from "./types";
import { useWhtData } from "./useWhtData";

interface WhtWorkspaceProps {
  t: Translate;
  locale: Locale;
}

interface Filters {
  period: string;
  status: WhtStatus | "all";
  bookNo: string;
  query: string;
}

/** 两种导入长得像但语义相反，用不同的入口和不同的引导文案分开。 */
type ImportKind = "history" | "batch";

/** 业务阶段 → 内部状态。财务同事按"手上要做什么"找单，不是按状态机找。 */
const whtPhaseStatuses: Record<
  Exclude<FinanceLifecyclePhase, "all">,
  readonly WhtStatus[]
> = {
  pending: ["draft", "pending_review"],
  issuing: ["approved"],
  history: ["issued", "voided"],
};

function isTaskInPhase(task: WhtTask, phase: FinanceLifecyclePhase): boolean {
  return phase === "all" || whtPhaseStatuses[phase].includes(task.status);
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

export function WhtWorkspace({ t, locale }: WhtWorkspaceProps) {
  const { message, modal } = AntApp.useApp();
  const {
    tasks,
    payees,
    incomeTypes,
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
    uploadBatchTasks,
    runBatchTransition,
  } = useWhtData();
  const [view, setView] = useState<"tasks" | "payees">("tasks");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [importKind, setImportKind] = useState<ImportKind | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [documentPending, setDocumentPending] = useState(false);
  const [documents, setDocuments] = useState<WhtDocument[]>([]);
  const [signatures, setSignatures] = useState<SignatureAsset[]>([]);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  // 默认停在「待处理」：进页面最常见的诉求是"我还有什么没做完"。
  const [phase, setPhase] = useState<FinanceLifecyclePhase>("pending");
  const [rateHint, setRateHint] = useState<string | null>(null);
  const [form] = Form.useForm();
  const [generateForm] = Form.useForm();
  const issuanceType = Form.useWatch("issuanceType", form);
  const payeeId = Form.useWatch("payeeId", form);
  const includeSignature = Form.useWatch("includeSignature", generateForm);
  const [filters, setFilters] = useState<Filters>({
    period: "2026-06",
    status: "all",
    bookNo: "all",
    query: "",
  });

  useEffect(() => {
    if (selectedId && !tasks.some((task) => task.id === selectedId)) {
      setSelectedId(null);
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
      const matchesPhase = isTaskInPhase(task, phase);
      const matchesPeriod = filters.period === "all" || task.period === filters.period;
      const matchesStatus = filters.status === "all" || task.status === filters.status;
      const matchesBook = filters.bookNo === "all" || task.bookNo === filters.bookNo;
      const matchesQuery =
        !query ||
        task.companyName.toLocaleLowerCase().includes(query) ||
        task.companyNameEn?.toLocaleLowerCase().includes(query) ||
        task.taxId?.includes(query) ||
        task.taskNo?.toLocaleLowerCase().includes(query);
      return matchesPhase && matchesPeriod && matchesStatus && matchesBook && matchesQuery;
    });
  }, [filters, phase, tasks]);

  const lifecycleCounts = useMemo(
    () => ({
      pending: tasks.filter((task) => isTaskInPhase(task, "pending")).length,
      issuing: tasks.filter((task) => isTaskInPhase(task, "issuing")).length,
      history: tasks.filter((task) => isTaskInPhase(task, "history")).length,
      all: tasks.length,
    }),
    [tasks],
  );

  const selectedTask = tasks.find((task) => task.id === selectedId);
  const selectedPayee = payees.find((payee) => payee.id === payeeId);
  const checkedTasks = useMemo(
    () => tasks.filter((task) => checkedIds.includes(task.id)),
    [checkedIds, tasks],
  );
  const draftChecked = checkedTasks.filter((task) => task.status === "draft");
  const reviewChecked = checkedTasks.filter((task) => task.status === "pending_review");

  /** 目录按收款方的 PND 类型过滤：同一收入类型在两张表下税率可能不同。 */
  const incomeTypeOptions = useMemo(() => {
    const label = (option: IncomeTypeOption) =>
      locale === "en-US" ? option.labelEn : option.labelZh;
    const rateOf = (option: IncomeTypeOption, whtType: WhtType | undefined) =>
      option.rates.find((entry) => entry.whtType === whtType)?.rate;
    const applicable = incomeTypes.filter(
      (option) =>
        !selectedPayee || option.rates.some((r) => r.whtType === selectedPayee.whtType),
    );
    const toOption = (option: IncomeTypeOption) => {
      const rate = rateOf(option, selectedPayee?.whtType);
      return {
        value: option.labelTh,
        label: (
          <span className="income-type-option">
            <ThaiText>{option.labelTh}</ThaiText>
            <small>{label(option)}</small>
            {rate && <Tag>{`${Number(rate) * 100}%`}</Tag>}
          </span>
        ),
      };
    };
    return [
      {
        label: t("wht.incomeTypeInUse"),
        options: applicable.filter((option) => option.inUse).map(toOption),
      },
      {
        label: t("wht.incomeTypeCatalogue"),
        options: applicable.filter((option) => !option.inUse).map(toOption),
      },
    ].filter((group) => group.options.length > 0);
  }, [incomeTypes, locale, selectedPayee, t]);

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

  const applyIncomeType = (value: string) => {
    const option = incomeTypes.find((entry) => entry.labelTh === value);
    const rate = option?.rates.find(
      (entry) => entry.whtType === selectedPayee?.whtType,
    )?.rate;
    if (!option || !rate) {
      setRateHint(null);
      return;
    }
    const percent = Number(rate) * 100;
    form.setFieldValue("whtRate", percent);
    setRateHint(
      t("wht.rateFromCatalogue", {
        label: locale === "en-US" ? option.labelEn : option.labelZh,
        rate: `${percent}%`,
      }),
    );
  };

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
      });
      setSelectedId(task.id);
      setInspectorOpen(true);
      setCreateOpen(false);
      setRateHint(null);
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

  const runBatch = async (
    action: "submit-review" | "approve" | "return-to-draft",
    selection: WhtTask[],
  ) => {
    try {
      const result = await runBatchTransition(action, selection);
      setCheckedIds([]);
      message.success(
        t("wht.batchResult", { succeeded: result.succeeded, failed: result.failed }),
      );
      if (result.failed > 0) {
        modal.warning({
          title: t("wht.batchResult", {
            succeeded: result.succeeded,
            failed: result.failed,
          }),
          content: (
            <ul className="import-error-list">
              {result.items
                .filter((item) => !item.succeeded)
                .map((item) => (
                  <li key={item.taskId}>{item.error}</li>
                ))}
            </ul>
          ),
        });
      }
    } catch (batchError) {
      if (batchError instanceof Error) message.error(batchError.message);
    }
  };

  const confirmBatchApprove = () => {
    modal.confirm({
      title: t("wht.batchConfirmApprove", { count: reviewChecked.length }),
      content: t("wht.batchConfirmApproveBody"),
      okText: t("wht.batchApprove"),
      cancelText: t("common.cancel"),
      onOk: () => runBatch("approve", reviewChecked),
    });
  };

  const openDocumentGenerator = async () => {
    try {
      setDocumentPending(true);
      // 只列适用于 WHT 的（含 both）：TAX INV 专用的签名不能出现在这里。
      const items = await listSignatures(false, "wht");
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

  const closeImport = () => {
    setImportKind(null);
    setImportFile(null);
  };

  const runImport = async () => {
    if (!importFile || !importKind) return;
    try {
      if (importKind === "history") {
        const result = await uploadHistoricalTasks(importFile);
        message.success(
          t("wht.historyImportCompleted", {
            created: result.created,
            skipped: result.skipped,
          }),
        );
      } else {
        const result = await uploadBatchTasks(importFile);
        message.success(t("wht.batchImportCompleted", { created: result.created }));
      }
      closeImport();
    } catch (importError) {
      // 批量导入是全表退回：把每一行的问题都列出来，用户改一轮就能过。
      if (importError instanceof ApiError && importError.details.length > 0) {
        modal.error({
          title: t("wht.batchImportRejected"),
          width: 620,
          content: (
            <ul className="import-error-list">
              {importError.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          ),
        });
        return;
      }
      if (importError instanceof Error) message.error(importError.message);
    }
  };

  const importSteps =
    importKind === "history"
      ? ([
          "wht.historyImportStep1",
          "wht.historyImportStep2",
          "wht.historyImportStep3",
          "wht.historyImportStep4",
        ] as const)
      : ([
          "wht.batchImportStep1",
          "wht.batchImportStep2",
          "wht.batchImportStep3",
          "wht.batchImportStep4",
          "wht.batchImportStep5",
        ] as const);

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
          </div>
        </div>
        <div className="page-actions">
          <Dropdown
            disabled={mutationPending}
            menu={{
              items: [
                {
                  key: "batch",
                  icon: <ThunderboltOutlined />,
                  label: (
                    <div className="import-menu-item">
                      <strong>
                        {t("wht.importBatch")}
                        <Tag color="gold">{t("wht.importBatchTag")}</Tag>
                      </strong>
                      <small>{t("wht.importBatchDesc")}</small>
                    </div>
                  ),
                },
                {
                  key: "history",
                  icon: <HistoryOutlined />,
                  label: (
                    <div className="import-menu-item">
                      <strong>
                        {t("wht.importHistory")}
                        <Tag>{t("wht.importHistoryTag")}</Tag>
                      </strong>
                      <small>{t("wht.importHistoryDesc")}</small>
                    </div>
                  ),
                },
              ],
              onClick: ({ key }) => {
                setImportFile(null);
                setImportKind(key as ImportKind);
              },
            }}
          >
            <Button icon={<UploadOutlined />} loading={mutationPending}>
              {t("wht.importMenu")} <DownOutlined />
            </Button>
          </Dropdown>
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

      <FinanceLifecycleTabs
        activeKey={phase}
        ariaLabel={t("lifecycle.aria", { module: "WHT" })}
        counts={lifecycleCounts}
        labels={{
          pending: t("lifecycle.pending"),
          issuing: t("lifecycle.issuing"),
          history: t("lifecycle.history"),
          all: t("lifecycle.all"),
        }}
        onChange={(nextPhase) => {
          setPhase(nextPhase);
          // 换阶段时清掉状态细筛和勾选：留着上一阶段的状态会筛出空列表，
          // 留着勾选则可能对不在当前视图里的单据执行批量操作。
          setFilters((current) => ({ ...current, status: "all" }));
          setCheckedIds([]);
        }}
      />

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

        {checkedTasks.length > 0 ? (
          <div className="table-toolbar batch-toolbar">
            <strong>{t("common.selected", { count: checkedTasks.length })}</strong>
            <div className="batch-actions">
              <Button
                disabled={draftChecked.length === 0}
                loading={mutationPending}
                size="small"
                type="primary"
                onClick={() => void runBatch("submit-review", draftChecked)}
              >
                {t("wht.batchSubmitReview")}
                {draftChecked.length > 0 && ` (${draftChecked.length})`}
              </Button>
              <Button
                disabled={reviewChecked.length === 0}
                loading={mutationPending}
                size="small"
                onClick={confirmBatchApprove}
              >
                {t("wht.batchApprove")}
                {reviewChecked.length > 0 && ` (${reviewChecked.length})`}
              </Button>
              <Button
                disabled={reviewChecked.length === 0}
                loading={mutationPending}
                size="small"
                onClick={() => void runBatch("return-to-draft", reviewChecked)}
              >
                {t("wht.batchReturnDraft")}
              </Button>
              <Button size="small" type="text" onClick={() => setCheckedIds([])}>
                {t("common.clearSelection")}
              </Button>
            </div>
          </div>
        ) : (
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
        )}

        <Table<WhtTask>
          columns={columns}
          dataSource={filteredTasks}
          loading={loading}
          locale={{
            emptyText: (
              <Empty
                description={
                  <div className="table-empty">
                    <strong>
                      {tasks.length === 0 ? t("wht.emptyTasks") : t("wht.emptyFiltered")}
                    </strong>
                    <span>
                      {tasks.length === 0
                        ? t("wht.emptyTasksHint")
                        : t("wht.emptyFilteredHint")}
                    </span>
                  </div>
                }
              />
            ),
          }}
          pagination={{ pageSize: 8, hideOnSinglePage: true }}
          rowKey="id"
          rowSelection={{
            selectedRowKeys: checkedIds,
            onChange: (keys) => setCheckedIds(keys as string[]),
          }}
          scroll={{ x: 900 }}
          tableLayout="fixed"
          rowClassName={(record) => (record.id === selectedId ? "selected-row" : "")}
          onRow={(record) => ({
            onClick: (event) => {
              // 勾选框也在行内：点它只应改变选择，不该顺带打开右侧明细。
              if ((event.target as HTMLElement).closest(".ant-table-selection-column")) {
                return;
              }
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


  // 只有明细面板真的会渲染时才让出那一列。以前 inspectorOpen 默认 true，
  // 台账为空时右边留着 412px 的空档，表格被挤到左边并出现横向滚动条。
  const showInspector = view === "tasks" && inspectorOpen && Boolean(selectedTask);

  return (
    <div className={`workspace ${showInspector ? "with-inspector" : ""}`}>
      {view === "tasks" ? taskView : payeeView}

      {showInspector && selectedTask && (
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
        width={620}
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
              onChange={() => {
                // 换收款方就可能换 PND 表，原来选的收入类型未必还适用。
                form.setFieldValue("incomeType", undefined);
                setRateHint(null);
              }}
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
              label={
                selectedPayee
                  ? `${t("wht.incomeType")} · ${selectedPayee.whtType}`
                  : t("wht.incomeType")
              }
              extra={!selectedPayee ? t("wht.selectPayeeFirst") : undefined}
              rules={[{ required: true }]}
            >
              <AutoComplete
                className="thai-input"
                options={incomeTypeOptions}
                placeholder={t("wht.incomeTypeSelect")}
                filterOption={(input, option) => {
                  // 选项是分组结构，回调拿到的是组内条目；label 是 JSX，
                  // 只能按 value（泰文原文）过滤。
                  const value = (option as { value?: string } | undefined)?.value ?? "";
                  return value.toLowerCase().includes(input.toLowerCase());
                }}
                onSelect={applyIncomeType}
              />
            </Form.Item>
          </div>
          <div className="task-form-grid">
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
              extra={rateHint}
              rules={[{ required: true }]}
            >
              <InputNumber min={0.01} max={100} precision={2} suffix="%" />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      <Modal
        destroyOnHidden
        open={importKind !== null}
        title={
          importKind === "history"
            ? t("wht.historyImportTitle")
            : t("wht.batchImportTitle")
        }
        okText={t("common.import")}
        cancelText={t("common.cancel")}
        okButtonProps={{ disabled: !importFile }}
        confirmLoading={mutationPending}
        width={680}
        onCancel={closeImport}
        onOk={() => void runImport()}
      >
        <Alert
          className="import-intro"
          showIcon
          type={importKind === "history" ? "warning" : "info"}
          message={
            importKind === "history"
              ? t("wht.historyImportIntro")
              : t("wht.batchImportIntro")
          }
        />
        <h4 className="import-steps-title">{t("common.steps")}</h4>
        <ol className="import-steps">
          {importSteps.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ol>
        <div className="import-actions">
          {importKind === "batch" && (
            <Button
              icon={<FileExcelOutlined />}
              onClick={() => void downloadBatchTemplate()}
            >
              {t("wht.batchTemplate")}
            </Button>
          )}
          <Upload
            accept=".xlsx"
            beforeUpload={(file) => {
              setImportFile(file);
              return false;
            }}
            fileList={
              importFile
                ? [{ uid: importFile.name, name: importFile.name, status: "done" }]
                : []
            }
            maxCount={1}
            onRemove={() => setImportFile(null)}
          >
            <Button icon={<UploadOutlined />} type="primary" ghost>
              {importKind === "history"
                ? t("wht.historyImportPick")
                : t("wht.batchImportPick")}
            </Button>
          </Upload>
        </div>
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
