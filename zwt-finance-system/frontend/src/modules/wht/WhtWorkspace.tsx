import { useEffect, useMemo, useState } from "react";
import {
  CheckCircleFilled,
  CloseOutlined,
  DownloadOutlined,
  EditOutlined,
  FileDoneOutlined,
  FilterOutlined,
  HistoryOutlined,
  PlusOutlined,
  ReloadOutlined,
  UndoOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App as AntApp,
  Button,
  Checkbox,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
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
  downloadWhtDocument,
  generateWhtDocuments,
  listSignatures,
  listWhtDocuments,
} from "./api";
import { BatchIssuanceWizard } from "./BatchIssuanceWizard";
import { roundHalfUp, statutoryRateFor } from "./batchRowState";
import { IssuanceConsole } from "./IssuanceConsole";
import { PayeeDirectory } from "./PayeeDirectory";
import type {
  SignatureAsset,
  WhtDocument,
  WhtStatus,
  WhtTask,
  WhtTaskCreateInput,
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

/**
 * 台账、开票操作、收款方主数据是模块内的三个平行视图。
 *
 * 「开票操作」下面有两条路径：compose（单张录入）与 batch（导入核对向导）。
 * 页签仍是三个 —— 走哪条路径是进入开票时的一次选择，不是一个长期停留的位置。
 */
type WorkspaceView = "tasks" | "compose" | "batch" | "payees";

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

/** 四个平行视图共用一组页签，单张和批量都有明确、稳定的页面入口。 */
function ViewSwitch({
  active,
  t,
  onChange,
}: {
  active: WorkspaceView;
  t: Translate;
  onChange: (view: WorkspaceView) => void;
}) {
  const tabs: Array<{ key: WorkspaceView; label: string }> = [
    { key: "tasks", label: t("wht.taskLedger") },
    { key: "compose", label: t("wht.modeSingle") },
    { key: "batch", label: t("wht.batchWizardTitle") },
    { key: "payees", label: t("wht.payeeMaster") },
  ];
  return (
    <div className="workspace-view-switch" role="tablist">
      {tabs.map((tab) => (
        <button
          aria-selected={tab.key === active}
          className={tab.key === active ? "is-active" : ""}
          key={tab.key}
          role="tab"
          type="button"
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
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
  onEdit,
  onRevise,
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
  onEdit: () => void;
  onRevise: () => void;
}) {
  const value = (content: string | number | null) => content ?? "—";
  const isFormal = task.status === "approved" || task.status === "issued";
  const revisions = task.events.filter((event) => event.eventType === "revised").length;
  const workflow =
    task.events.length > 0
      ? task.events.map((event) => ({
          // 修订也把票据打回草稿，只按 toStatus 显示会写成「草稿」，
          // 看不出这一步是一次对正式凭证的更正 —— 流水的意义就没了。
          title:
            event.eventType === "revised"
              ? t("wht.revise")
              : statusLabel(event.toStatus, t),
          content: `${event.actorName} · ${formatDateTime(event.createdAt)}`,
          description: event.note ?? undefined,
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
          {revisions > 0 && (
            <Tag className="status-tag">{t("wht.revisionCount", { count: revisions })}</Tag>
          )}
        </div>
        <div className="inspector-header-actions">
          <Button
            disabled={task.status !== "draft" || pending}
            icon={<EditOutlined />}
            size="small"
            onClick={onEdit}
          >
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

      {/* 明细面板只有 412px 宽，一条带底色的告警会把上半屏吃掉。
          用一行左边框的小字说明，信息量一样、密度和面板其余部分一致。 */}
      {task.payeePending && (
        <p className="inspector-note">{t("wht.payeePendingNotice")}</p>
      )}

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
            {
              key: "companyEn",
              label: t("wht.payeeNameEn"),
              children: value(task.companyNameEn),
            },
            { key: "tax", label: t("wht.taxId"), children: value(task.taxId) },
            // 这三项会原样印到正式凭证上，之前一项都没显示，出票前无从核对。
            {
              key: "address",
              label: t("wht.address"),
              children: task.payeeAddress ? (
                <ThaiText>{task.payeeAddress}</ThaiText>
              ) : (
                "—"
              ),
            },
            {
              key: "issuance",
              label: t("wht.issuanceType"),
              children:
                task.issuanceType === "supplement"
                  ? `${t("wht.supplement")} · ${task.supplementRun}`
                  : t("wht.normal"),
            },
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
            {/* 已开具的票要改内容，必须先退回草稿；票号不变，文件版本 +1。 */}
            <Button block disabled={pending} icon={<UndoOutlined />} onClick={onRevise}>
              {t("wht.revise")}
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
    editTask,
    reviseTask,
    transitionTask,
    persistPayee,
    removePayee,
    recoverPayee,
    uploadPayees,
    uploadHistoricalTasks,
    previewBatch,
    commitBatch,
    runBatchTransition,
  } = useWhtData();
  // 「开票操作」是模块内的平行视图，不是弹窗：正式凭证上要打印的每一项
  // （泰文名、税号、泰文地址、收入类型）都得摊开在一页里核对完再提交。
  const [view, setView] = useState<WorkspaceView>("tasks");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [documentPending, setDocumentPending] = useState(false);
  const [documents, setDocuments] = useState<WhtDocument[]>([]);
  const [signatures, setSignatures] = useState<SignatureAsset[]>([]);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  // 默认停在「待处理」：进页面最常见的诉求是"我还有什么没做完"。
  const [phase, setPhase] = useState<FinanceLifecyclePhase>("pending");
  const [editOpen, setEditOpen] = useState(false);
  const [reviseOpen, setReviseOpen] = useState(false);
  const [generateForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [reviseForm] = Form.useForm();
  const includeSignature = Form.useWatch("includeSignature", generateForm);
  const editIncomeType = Form.useWatch("incomeType", editForm);
  const editWhtRate = Form.useWatch("whtRate", editForm);
  const [filters, setFilters] = useState<Filters>({
    period: "all",
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
      [...new Set(tasks.map((task) => task.period))]
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

  /**
   * 改草稿时税率是否偏离了目录法定值。判定基准是**字段当前的值**：把收入类型换成
   * 一个法定税率不同的类型，同样会让原本合规的税率变成偏离，而人不一定意识到。
   * 与服务端 `_rate_override_note` 用同一份目录，两边不会分叉。
   */
  const editStatutoryRate = statutoryRateFor(
    incomeTypes,
    editIncomeType ?? "",
    selectedTask?.whtType ?? null,
  );
  const editDeviates =
    editStatutoryRate !== null &&
    editWhtRate != null &&
    roundHalfUp(Number(editWhtRate) / 100) !== roundHalfUp(editStatutoryRate);
  const checkedTasks = useMemo(
    () => tasks.filter((task) => checkedIds.includes(task.id)),
    [checkedIds, tasks],
  );
  const draftChecked = checkedTasks.filter((task) => task.status === "draft");
  const reviewChecked = checkedTasks.filter((task) => task.status === "pending_review");

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

  /**
   * 建完直接回台账并选中新草稿：操作页是「录一条」的入口，不是停留的地方，
   * 留在原地反而让人以为还要再点一次保存。
   */
  const createFromConsole = async (input: WhtTaskCreateInput) => {
    const task = await createTask(input);
    setSelectedId(task.id);
    setInspectorOpen(true);
    setView("tasks");
    return task;
  };

  const changeView = (next: WorkspaceView) => {
    setView(next);
  };

  const openEditor = () => {
    if (!selectedTask) return;
    editForm.setFieldsValue({
      incomeType: selectedTask.incomeType ?? "",
      paymentDate: selectedTask.paymentDate ?? "",
      // 税率对外一律按百分数编辑，与单张开具的税率框口径一致。
      whtRate:
        selectedTask.whtRate === null
          ? undefined
          : Number((Number(selectedTask.whtRate) * 100).toFixed(2)),
      totalAmount: Number(selectedTask.totalAmount),
    });
    setEditOpen(true);
  };

  const saveEdits = async () => {
    if (!selectedTask) return;
    try {
      const values = await editForm.validateFields();
      await editTask(selectedTask, {
        incomeType: values.incomeType.trim(),
        paymentDate: values.paymentDate,
        whtRate: values.whtRate / 100,
        totalAmount: values.totalAmount,
        // 字段只在偏离时渲染，没偏离时 values 里根本没有这一项。
        rateOverrideNote: values.rateOverrideNote?.trim() || null,
      });
      setEditOpen(false);
      message.success(t("common.saved"));
    } catch (editError) {
      if (editError instanceof Error) message.error(editError.message);
    }
  };

  const submitRevision = async () => {
    if (!selectedTask) return;
    try {
      const values = await reviseForm.validateFields();
      const revised = await reviseTask(selectedTask, values.reason.trim());
      setReviseOpen(false);
      reviseForm.resetFields();
      message.success(t("wht.revised", { taskNo: revised.taskNo ?? "" }));
    } catch (reviseError) {
      if (reviseError instanceof Error) message.error(reviseError.message);
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
    setImportOpen(false);
    setImportFile(null);
  };

  /**
   * 历史台账迁移。批量开具已经改走分步向导（上传 → 核对 → 建草稿），不再从这里进——
   * 两个入口一个先核对一个不核对，摆在同一个菜单里必然有人点错。
   */
  const runImport = async () => {
    if (!importFile) return;
    try {
      const result = await uploadHistoricalTasks(importFile);
      message.success(
        t("wht.historyImportCompleted", {
          created: result.created,
          skipped: result.skipped,
        }),
      );
      closeImport();
    } catch (importError) {
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

  const taskView = (
    <section className="workspace-main">
      <div className="page-heading">
        <div>
          <h1>
            <span>WHT</span>
            <small>{t("wht.title")}</small>
          </h1>
          <ViewSwitch active="tasks" t={t} onChange={changeView} />
        </div>
        <div className="page-actions">
          <Button
            icon={<HistoryOutlined />}
            loading={mutationPending}
            onClick={() => {
              setImportFile(null);
              setImportOpen(true);
            }}
          >
            {t("wht.importHistory")}
          </Button>
          <Button icon={<PlusOutlined />} type="primary" onClick={() => setView("compose")}>
            {t("wht.modeSingle")}
          </Button>
        </div>
      </div>

      {error && (
        <Alert
          className="workspace-alert"
          showIcon
          type="error"
          title={t("common.loadFailed")}
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
              options={[{ value: "all", label: t("wht.all") }, ...periodOptions]}
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
          <ViewSwitch active="payees" t={t} onChange={changeView} />
        </div>
      </div>
      <PayeeDirectory
        error={error}
        loading={loading}
        payees={payees}
        pending={mutationPending}
        t={t}
        onDelete={removePayee}
        onImport={uploadPayees}
        onRestore={recoverPayee}
        onSave={persistPayee}
      />
    </section>
  );

  const composeView = (
    <IssuanceConsole
      defaultPeriod={filters.period === "all" ? periodOptions[0]?.value : filters.period}
      incomeTypes={incomeTypes}
      locale={locale}
      payees={payees}
      pending={mutationPending}
      periodOptions={periodOptions}
      t={t}
      viewSwitch={<ViewSwitch active="compose" t={t} onChange={changeView} />}
      onCancel={() => setView("tasks")}
      onCreate={createFromConsole}
    />
  );

  const batchView = (
    <BatchIssuanceWizard
      incomeTypes={incomeTypes}
      payees={payees}
      pending={mutationPending}
      t={t}
      viewSwitch={<ViewSwitch active="batch" t={t} onChange={changeView} />}
      onBackToLedger={() => setView("tasks")}
      onCommit={commitBatch}
      onPreview={previewBatch}
    />
  );

  // 只有明细面板真的会渲染时才让出那一列。以前 inspectorOpen 默认 true，
  // 台账为空时右边留着 412px 的空档，表格被挤到左边并出现横向滚动条。
  const showInspector = view === "tasks" && inspectorOpen && Boolean(selectedTask);

  return (
    <div className="workspace">
      {/* 四个工作区始终保持挂载，只切换可见性：跨页查看台账或主数据后，
          单张表单与批量核对结果都不会被卸载。 */}
      <div className="workspace-view-host" hidden={view !== "tasks"}>
        {taskView}
      </div>
      <div className="workspace-view-host" hidden={view !== "compose"}>
        {composeView}
      </div>
      <div className="workspace-view-host" hidden={view !== "batch"}>
        {batchView}
      </div>
      <div className="workspace-view-host" hidden={view !== "payees"}>
        {payeeView}
      </div>

      <Drawer
        destroyOnClose={false}
        open={showInspector}
        placement="right"
        styles={{ body: { padding: 0 } }}
        title={null}
        width={560}
        zIndex={1000}
        onClose={() => setInspectorOpen(false)}
      >
        {selectedTask && (
          <DetailPanel
            documents={documents}
            pending={mutationPending || documentPending}
            task={selectedTask}
            t={t}
            onAction={handleAction}
            onClose={() => setInspectorOpen(false)}
            onDownload={downloadDocument}
            onEdit={openEditor}
            onGenerate={() => void openDocumentGenerator()}
            onRevise={() => setReviseOpen(true)}
          />
        )}
      </Drawer>

      <Modal
        destroyOnHidden
        open={importOpen}
        title={t("wht.historyImportTitle")}
        zIndex={1100}
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
          type="warning"
          title={t("wht.historyImportIntro")}
        />
        <h4 className="import-steps-title">{t("common.steps")}</h4>
        <ol className="import-steps">
          <li>{t("wht.historyImportStep1")}</li>
          <li>{t("wht.historyImportStep2")}</li>
          <li>{t("wht.historyImportStep3")}</li>
          <li>{t("wht.historyImportStep4")}</li>
        </ol>
        <div className="import-actions">
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
              {t("wht.historyImportPick")}
            </Button>
          </Upload>
        </div>
      </Modal>

      <Modal
        destroyOnHidden
        forceRender
        open={generateOpen}
        title={t("wht.generateDocuments")}
        zIndex={1100}
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

      {/* 改草稿。收款方与期数不在这里改：换收款方等于换一张票，重建比改更清楚。 */}
      <Modal
        destroyOnHidden
        open={editOpen}
        title={t("wht.editTaskTitle", {
          label: selectedTask?.taskNo ?? t("wht.pendingNumber"),
        })}
        zIndex={1100}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        confirmLoading={mutationPending}
        onCancel={() => setEditOpen(false)}
        onOk={() => void saveEdits()}
      >
        <Form form={editForm} layout="vertical">
          <Form.Item
            name="incomeType"
            label={t("wht.incomeType")}
            rules={[{ required: true, whitespace: true }]}
          >
            <Input className="thai-input" maxLength={160} />
          </Form.Item>
          <Form.Item
            name="paymentDate"
            label={t("wht.paymentDate")}
            rules={[{ required: true }]}
          >
            <Input type="date" />
          </Form.Item>
          <Form.Item
            name="totalAmount"
            label={t("wht.totalAmount")}
            rules={[{ required: true }]}
          >
            <InputNumber min={0.01} precision={2} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            name="whtRate"
            label={t("wht.ratePercent")}
            extra={
              editStatutoryRate === null ? undefined : (
                <span className={`rate-note is-${editDeviates ? "warning" : "muted"}`}>
                  {editDeviates
                    ? t("wht.rateOverridden", {
                        label: selectedTask?.incomeType ?? "",
                        rate: `${Number(editWhtRate ?? 0).toFixed(2)}%`,
                        statutory: `${(editStatutoryRate * 100).toFixed(2)}%`,
                      })
                    : t("wht.rateStatutory", {
                        label: selectedTask?.incomeType ?? "",
                        statutory: `${(editStatutoryRate * 100).toFixed(2)}%`,
                      })}
                </span>
              )
            }
            rules={[{ required: true }]}
          >
            <InputNumber
              max={100}
              min={0.01}
              precision={2}
              style={{ width: "100%" }}
              suffix="%"
            />
          </Form.Item>
          {/* 只在真的偏离时才出现：法定税率下多问一句理由是纯噪音。 */}
          {editDeviates && (
            <Form.Item
              name="rateOverrideNote"
              label={t("wht.rateOverrideNote")}
              extra={t("wht.rateOverrideNoteHint")}
              rules={[
                {
                  required: true,
                  whitespace: true,
                  message: t("wht.rateOverrideNoteRequired"),
                },
              ]}
            >
              <Input.TextArea
                autoSize={{ minRows: 2, maxRows: 4 }}
                maxLength={1000}
                placeholder={t("wht.rateOverrideNotePlaceholder")}
                showCount
              />
            </Form.Item>
          )}
        </Form>
      </Modal>

      {/* 修订：把已批准/已开具的票退回草稿，票号不变，理由必填。 */}
      <Modal
        destroyOnHidden
        open={reviseOpen}
        title={t("wht.reviseTitle", { taskNo: selectedTask?.taskNo ?? "" })}
        zIndex={1100}
        okText={t("wht.revise")}
        cancelText={t("common.cancel")}
        confirmLoading={mutationPending}
        width={620}
        onCancel={() => setReviseOpen(false)}
        onOk={() => void submitRevision()}
      >
        <p className="wht-wizard-note is-emphasis">{t("wht.reviseIntro")}</p>
        <Form className="wht-modal-form" form={reviseForm} layout="vertical">
          <Form.Item
            name="reason"
            label={t("wht.reviseReason")}
            extra={t("wht.reviseReasonHint")}
            rules={[
              {
                required: true,
                whitespace: true,
                message: t("wht.reviseReasonRequired"),
              },
            ]}
          >
            <Input.TextArea
              autoSize={{ minRows: 3, maxRows: 5 }}
              maxLength={1000}
              placeholder={t("wht.reviseReasonPlaceholder")}
              showCount
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
