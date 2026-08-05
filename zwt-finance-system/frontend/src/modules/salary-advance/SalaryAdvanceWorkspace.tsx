import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeftOutlined,
  DownOutlined,
  FilterOutlined,
  RightOutlined,
  UpOutlined,
  CheckCircleOutlined,
  CloudDownloadOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  FileExcelOutlined,
  FilePdfOutlined,
  FileProtectOutlined,
  LockOutlined,
  PlusOutlined,
  ReloadOutlined,
  RetweetOutlined,
  SafetyCertificateOutlined,
  UploadOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App as AntApp,
  Button,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Select,
  Space,
  Table,
  Tooltip,
  Upload,
} from "antd";
import type { UploadFile } from "antd";
import type { ColumnsType } from "antd/es/table";

import type { Translate, TranslationKey } from "../../i18n";
import {
  FinanceLifecycleTabs,
  type FinanceLifecyclePhase,
  FinanceRecordDrawer,
  FinanceStatusBadge,
  type FinanceStatusTone,
  formatFinanceAmount,
  formatFinanceDateTime,
} from "../../ui";
import {
  createSalaryAdvanceJob,
  deleteSalaryAdvanceBatch,
  downloadImportTemplate,
  downloadJobArtifact,
  downloadSalaryAdvanceDocument,
  downloadValidationReport,
  getSalaryAdvanceBatch,
  getSalaryAdvanceJob,
  importSalaryAdvanceBatch,
  listSalaryAdvanceBatches,
  listSalaryAdvanceJobs,
  lockSalaryAdvanceBatch,
  previewSalaryAdvanceRecord,
  retrySalaryAdvanceJob,
  revalidateSalaryAdvanceBatch,
  updateSalaryAdvanceRecord,
} from "./api";
import { EmployeeDirectory } from "./EmployeeDirectory";
import { SingleIssuanceConsole } from "./SingleIssuanceConsole";
import { listSignatures } from "../wht/api";
import type { SignatureAsset } from "../wht/types";
import type {
  BatchStatus,
  SalaryAdvanceBatch,
  SalaryAdvanceBatchDetail,
  SalaryAdvanceDocument,
  SalaryAdvanceJobDetail,
  SalaryAdvanceRecord,
  ValidationStatus,
} from "./types";

// 状态文案一律走 i18n 键；语义色只表达状态，不用来区分业务类别
// （见 frontend-design-system.md）。
const batchTones: Record<BatchStatus, FinanceStatusTone> = {
  validating: "neutral",
  validation_failed: "danger",
  ready: "info",
  locked: "info",
  generating: "info",
  completed: "success",
  partially_completed: "warning",
  failed: "danger",
};

const BATCH_STATUSES = Object.keys(batchTones) as BatchStatus[];

const validationTones: Record<ValidationStatus, FinanceStatusTone> = {
  valid: "success",
  warning: "warning",
  invalid: "danger",
};

const generationTones: Record<string, FinanceStatusTone> = {
  pending: "neutral",
  generating: "info",
  success: "success",
  failed: "danger",
};

/**
 * 批次状态到业务阶段的映射，与 WHT / TAX INV 的台账分层同构：
 * 还要人动手的归「待处理」，锁定待生成的归「待出具」，已跑完生成的归「历史记录」。
 */
const LIFECYCLE_BY_STATUS: Record<BatchStatus, FinanceLifecyclePhase> = {
  validating: "pending",
  validation_failed: "pending",
  ready: "pending",
  locked: "issuing",
  generating: "issuing",
  completed: "history",
  partially_completed: "history",
  failed: "history",
};

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function BatchStatusTag({ status, t }: { status: BatchStatus; t: Translate }) {
  return (
    <FinanceStatusBadge
      label={t(`salary.batchStatus.${status}` as TranslationKey)}
      tone={batchTones[status]}
    />
  );
}

function ValidationTag({
  status,
  t,
}: {
  status: ValidationStatus;
  t: Translate;
}) {
  return (
    <FinanceStatusBadge
      label={t(`salary.validationStatus.${status}` as TranslationKey)}
      tone={validationTones[status]}
    />
  );
}

function GenerationTag({ status, t }: { status: string; t: Translate }) {
  return (
    <FinanceStatusBadge
      label={t(`salary.generationStatus.${status}` as TranslationKey)}
      tone={generationTones[status] ?? "neutral"}
    />
  );
}

interface RecordDrawerProps {
  record: SalaryAdvanceRecord;
  documents: SalaryAdvanceDocument[];
  busy: boolean;
  t: Translate;
  onClose: () => void;
  onEdit: () => void;
  onPreview: () => void;
  onDownload: (document: SalaryAdvanceDocument, format: "xlsx" | "pdf") => void;
}

function RecordDrawer({
  record,
  documents,
  busy,
  t,
  onClose,
  onEdit,
  onPreview,
  onDownload,
}: RecordDrawerProps) {
  const data = record.normalizedData;
  const issues = [...record.validationErrors, ...record.validationWarnings];
  return (
    <FinanceRecordDrawer
      open
      status={<ValidationTag status={record.validationStatus} t={t} />}
      title={record.empId}
      footer={
        <div className="inspector-actions">
          <Button
            block
            disabled={busy || record.validationStatus === "invalid"}
            icon={<EyeOutlined />}
            onClick={onPreview}
          >
            {t("salary.preview")}
          </Button>
          <Button
            block
            disabled={busy}
            icon={<EditOutlined />}
            onClick={onEdit}
          >
            {t("salary.editRecord")}
          </Button>
        </div>
      }
      onClose={onClose}
    >
      <section className="inspector-section">
        <div className="section-title-row">
          <h3>{t("salary.status")}</h3>
          <span>
            {t("salary.recordMeta", {
              row: record.sourceRowNo,
              version: record.version,
            })}
          </span>
        </div>
        <Space size={6} wrap>
          <ValidationTag status={record.validationStatus} t={t} />
          <GenerationTag status={record.generationStatus} t={t} />
        </Space>
      </section>

      {issues.length > 0 && (
        <section className="inspector-section">
          <Alert
            className="salary-issue-alert"
            showIcon
            type={record.validationErrors.length ? "error" : "warning"}
            title={t("salary.issueSummary", {
              errors: record.validationErrors.length,
              warnings: record.validationWarnings.length,
            })}
            description={
              <ul>
                {issues.map((issue) => (
                  <li key={`${issue.field}-${issue.code}`}>
                    <strong>{issue.field}</strong>：{issue.message}
                  </li>
                ))}
              </ul>
            }
          />
        </section>
      )}

      <section className="inspector-section">
        <h3>{t("salary.sectionApplicant")}</h3>
        <Descriptions className="task-descriptions" column={1} colon={false}>
          <Descriptions.Item label={t("salary.period")}>
            {record.period}
          </Descriptions.Item>
          <Descriptions.Item label={t("salary.name")}>
            {displayValue(data.applicant_display_name)}
          </Descriptions.Item>
          <Descriptions.Item label={t("salary.enName")}>
            {displayValue(data.en_name)}
          </Descriptions.Item>
          <Descriptions.Item label={t("salary.deptPosition")}>
            {displayValue(data.department)} / {displayValue(data.position)}
          </Descriptions.Item>
          <Descriptions.Item label={t("salary.startDate")}>
            {displayValue(data.start_date)}
          </Descriptions.Item>
          <Descriptions.Item label={t("salary.reason")}>
            {displayValue(data.reason)}
          </Descriptions.Item>
          <Descriptions.Item label={t("salary.advanceAmount")}>
            <span className="money-value">
              {formatFinanceAmount(data.advance_amount as string, "THB")}
            </span>
          </Descriptions.Item>
          <Descriptions.Item label={t("salary.monthlyDeduction")}>
            <span className="money-value">
              {formatFinanceAmount(data.monthly_deduction as string, "THB")}
            </span>
          </Descriptions.Item>
        </Descriptions>
      </section>

      <section className="inspector-section">
        <h3>{t("salary.sectionApproval")}</h3>
        <Descriptions className="task-descriptions" column={1} colon={false}>
          <Descriptions.Item label={t("salary.approvalStatus")}>
            {displayValue(data.approval_status)}
          </Descriptions.Item>
          <Descriptions.Item label={t("salary.financeCode")}>
            {displayValue(data.finance_signature_code)}
          </Descriptions.Item>
          <Descriptions.Item label={t("salary.mdCode")}>
            {displayValue(data.md_signature_code)}
          </Descriptions.Item>
          <Descriptions.Item label={t("salary.applicantSignature")}>
            {t("salary.applicantSignatureHint", {
              mode: displayValue(data.applicant_signature_mode),
            })}
          </Descriptions.Item>
          <Descriptions.Item label={t("salary.fingerprint")}>
            <span className="hash-value">{record.dataFingerprint}</span>
          </Descriptions.Item>
        </Descriptions>
      </section>

      <section className="inspector-section">
        <div className="section-title-row">
          <h3>{t("salary.sectionDocuments")}</h3>
          <span>
            {t("salary.documentVersions", { count: documents.length })}
          </span>
        </div>
        {documents.length ? (
          <div className="document-stack">
            {documents.map((document) => (
              <div className="salary-document-row" key={document.id}>
                <div>
                  {document.status === "success" ? (
                    <CheckCircleOutlined />
                  ) : (
                    <WarningOutlined />
                  )}
                  <span>
                    v{document.generationVersion}
                    <small>
                      {document.status === "success"
                        ? formatFinanceDateTime(document.createdAt)
                        : document.errorMessage}
                    </small>
                  </span>
                </div>
                {document.status === "success" && (
                  <Space size={4}>
                    {document.xlsxFileName && (
                      <Button
                        aria-label={t("salary.downloadXlsx")}
                        icon={<FileExcelOutlined />}
                        size="small"
                        type="text"
                        onClick={() => onDownload(document, "xlsx")}
                      />
                    )}
                    {document.pdfFileName && (
                      <Button
                        aria-label={t("salary.downloadPdf")}
                        icon={<FilePdfOutlined />}
                        size="small"
                        type="text"
                        onClick={() => onDownload(document, "pdf")}
                      />
                    )}
                  </Space>
                )}
              </div>
            ))}
          </div>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t("salary.noDocuments")}
          />
        )}
      </section>
    </FinanceRecordDrawer>
  );
}

export function SalaryAdvanceWorkspace({ t }: { t: Translate }) {
  const { message, modal } = AntApp.useApp();
  const [workspaceView, setWorkspaceView] = useState<
    "batches" | "employees" | "single"
  >("batches");
  const [batches, setBatches] = useState<SalaryAdvanceBatch[]>([]);
  const [selected, setSelected] = useState<SalaryAdvanceBatchDetail | null>(
    null,
  );
  const [selectedRecord, setSelectedRecord] =
    useState<SalaryAdvanceRecord | null>(null);
  const [jobDetail, setJobDetail] = useState<SalaryAdvanceJobDetail | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<FinanceLifecyclePhase>("pending");
  const [filters, setFilters] = useState({ period: "all", status: "all" });
  const [filtersCollapsed, setFiltersCollapsed] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [signatures, setSignatures] = useState<SignatureAsset[]>([]);
  const [selectedFinanceSigId, setSelectedFinanceSigId] = useState<
    string | undefined
  >(undefined);
  const [selectedMdSigId, setSelectedMdSigId] = useState<string | undefined>(
    undefined,
  );
  const [importFiles, setImportFiles] = useState<UploadFile[]>([]);
  const [importForm] = Form.useForm();
  const [editForm] = Form.useForm();

  const loadActiveSignatures = useCallback(async () => {
    try {
      const sigs = await listSignatures(false, "salary_advance");
      setSignatures(sigs);
      const finSigs = sigs.filter(
        (s) =>
          s.usage.includes("salary_advance_finance") ||
          s.usage.includes("salary_advance"),
      );
      const mdSigs = sigs.filter(
        (s) =>
          s.usage.includes("salary_advance_md") ||
          s.usage.includes("salary_advance"),
      );
      const finDefault = finSigs.find((s) => s.isDefault) ?? finSigs[0];
      const mdDefault = mdSigs.find((s) => s.isDefault) ?? mdSigs[0];
      if (finDefault) setSelectedFinanceSigId(finDefault.id);
      if (mdDefault) setSelectedMdSigId(mdDefault.id);
    } catch {
      // Ignore fallback
    }
  }, []);

  useEffect(() => {
    void loadActiveSignatures();
  }, [loadActiveSignatures]);

  const financeSignatures = useMemo(
    () =>
      signatures.filter(
        (s) =>
          s.usage.includes("salary_advance_finance") ||
          s.usage.includes("salary_advance"),
      ),
    [signatures],
  );

  const mdSignatures = useMemo(
    () =>
      signatures.filter(
        (s) =>
          s.usage.includes("salary_advance_md") ||
          s.usage.includes("salary_advance"),
      ),
    [signatures],
  );

  const loadBatch = useCallback(async (batchId: string) => {
    const [detail, jobs] = await Promise.all([
      getSalaryAdvanceBatch(batchId),
      listSalaryAdvanceJobs(batchId),
    ]);
    setSelected(detail);
    const latest = jobs[0];
    setJobDetail(latest ? await getSalaryAdvanceJob(latest.id) : null);
    setSelectedRecord((current) =>
      current
        ? (detail.records.find((record) => record.id === current.id) ?? null)
        : null,
    );
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const next = await listSalaryAdvanceBatches(undefined, undefined);
      setBatches(next);
      const currentId = selected?.batch.id;
      if (currentId && next.some((batch) => batch.id === currentId)) {
        await loadBatch(currentId);
      } else if (next[0]) {
        await loadBatch(next[0].id);
      } else {
        setSelected(null);
        setJobDetail(null);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [loadBatch, message, selected?.batch.id]);

  useEffect(() => {
    void reload();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const job = jobDetail?.job;
    if (!job || !["queued", "generating"].includes(job.status)) return;
    const timer = window.setInterval(() => {
      void getSalaryAdvanceJob(job.id)
        .then((next) => {
          setJobDetail(next);
          if (!["queued", "generating"].includes(next.job.status)) {
            void reload();
          }
        })
        .catch(() => undefined);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [jobDetail?.job, reload]);

  const selectedDocuments = useMemo(
    () =>
      selectedRecord
        ? (jobDetail?.documents.filter(
            (document) => document.recordId === selectedRecord.id,
          ) ?? [])
        : [],
    [jobDetail?.documents, selectedRecord],
  );

  // 台账按业务阶段分层，和 WHT / TAX INV 一致：计数永远来自全量批次，
  // 切换阶段只改可见范围，不改计数。
  const lifecycleCounts = useMemo(() => {
    const counts: Record<FinanceLifecyclePhase, number> = {
      pending: 0,
      issuing: 0,
      history: 0,
      all: batches.length,
    };
    for (const batch of batches) counts[LIFECYCLE_BY_STATUS[batch.status]] += 1;
    return counts;
  }, [batches]);

  const visibleBatches = useMemo(() => {
    let result =
      phase === "all"
        ? batches
        : batches.filter(
            (batch) => LIFECYCLE_BY_STATUS[batch.status] === phase,
          );
    if (filters.status !== "all") {
      result = result.filter((b) => b.status === filters.status);
    }
    return result;
  }, [batches, phase, filters.status]);

  const periodSummaryRows = useMemo(() => {
    const map = new Map<
      string,
      {
        period: string;
        batchCount: number;
        totalRows: number;
        validRows: number;
        invalidRows: number;
      }
    >();
    for (const batch of visibleBatches) {
      let entry = map.get(batch.period);
      if (!entry) {
        entry = {
          period: batch.period,
          batchCount: 0,
          totalRows: 0,
          validRows: 0,
          invalidRows: 0,
        };
        map.set(batch.period, entry);
      }
      entry.batchCount += 1;
      entry.totalRows += batch.totalRows;
      entry.validRows += batch.validRows;
      entry.invalidRows += batch.invalidRows;
    }
    return Array.from(map.values()).sort((a, b) =>
      b.period.localeCompare(a.period),
    );
  }, [visibleBatches]);

  const periodColumns = useMemo<ColumnsType<any>>(
    () => [
      {
        title: t("salary.period"),
        dataIndex: "period",
        width: 140,
        render: (period: string) => <strong>{period}</strong>,
      },
      { title: t("salary.importBatches"), dataIndex: "batchCount", width: 120 },
      { title: t("salary.totalRows"), dataIndex: "totalRows", width: 120 },
      { title: t("salary.validRows"), dataIndex: "validRows", width: 120 },
      {
        title: t("salary.invalidRows"),
        dataIndex: "invalidRows",
        width: 120,
        render: (val: number) => (
          <span className={val ? "error-copy" : ""}>{val}</span>
        ),
      },
      {
        title: t("common.actions"),
        key: "actions",
        width: 120,
        render: (_, record) => (
          <Button
            type="link"
            icon={<RightOutlined />}
            onClick={() => setFilters((f) => ({ ...f, period: record.period }))}
          >
            {t("wht.viewDetails")}
          </Button>
        ),
      },
    ],
    [t],
  );

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      message.success(success);
      await reload();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  // 模板下载要把失败说出来：直接 `void downloadImportTemplate()` 会把 rejection
  // 丢掉，端点 403 或断网时点了没反应，用户无从判断。参见 shared/download 的注释。
  const downloadTemplate = async () => {
    try {
      await downloadImportTemplate();
    } catch (error) {
      if (error instanceof Error) message.error(error.message);
    }
  };

  const submitImport = async () => {
    try {
      const values = await importForm.validateFields();
      const file = importFiles[0]?.originFileObj;
      if (!file) {
        message.error(t("salary.fileRequired"));
        return;
      }
      setBusy(true);
      const detail = await importSalaryAdvanceBatch(values.period, file);
      message.success(
        t("salary.importDone", {
          total: detail.batch.totalRows,
          invalid: detail.batch.invalidRows,
        }),
      );
      setImportOpen(false);
      setImportFiles([]);
      importForm.resetFields();
      setFilters((f) => ({ ...f, period: values.period }));
      await reload();
      await loadBatch(detail.batch.id);
    } catch (error) {
      if (error instanceof Error) message.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const openEdit = () => {
    if (!selectedRecord) return;
    const data = selectedRecord.normalizedData;
    editForm.setFieldsValue({
      first_name: data.first_name,
      surname: data.surname,
      chinese_name: data.chinese_name,
      department: data.department,
      position: data.position,
      start_date: data.start_date,
      reason: data.reason,
      advance_amount: Number(data.advance_amount),
      monthly_deduction: Number(data.monthly_deduction),
      request_date: data.request_date,
      finance_comment: data.finance_comment,
      approval_status: data.approval_status,
      finance_signature_code: data.finance_signature_code,
      md_signature_code: data.md_signature_code,
    });
    setEditOpen(true);
  };

  const submitEdit = async () => {
    if (!selectedRecord) return;
    try {
      const values = await editForm.validateFields();
      setBusy(true);
      const next = await updateSalaryAdvanceRecord(
        selectedRecord.id,
        selectedRecord.version,
        values,
      );
      setSelectedRecord(next);
      setEditOpen(false);
      message.success(t("salary.recordSaved"));
      if (selected) await loadBatch(selected.batch.id);
    } catch (error) {
      if (error instanceof Error) message.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const startGeneration = async () => {
    if (!selected) return;
    try {
      setBusy(true);
      await loadActiveSignatures();
      setGenerateOpen(true);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const submitGeneration = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      if (selected.batch.status === "ready") {
        await lockSalaryAdvanceBatch(selected.batch.id);
      }
      // 后端 ApiSchema 用 to_camel 生成别名且 populate_by_name=True，camelCase 即可，
      // 不需要再同时发一份 snake_case。
      const job = await createSalaryAdvanceJob(selected.batch.id, {
        financeSignatureId: selectedFinanceSigId,
        mdSignatureId: selectedMdSigId,
      });
      setJobDetail(await getSalaryAdvanceJob(job.id));
      message.success(t("salary.generateQueued"));
      setGenerateOpen(false);
      await loadBatch(selected.batch.id);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const retryGeneration = async () => {
    if (!jobDetail) return;
    setBusy(true);
    try {
      const job = await retrySalaryAdvanceJob(jobDetail.job.id);
      setJobDetail(await getSalaryAdvanceJob(job.id));
      message.success(t("salary.retryQueued"));
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const removeBatch = () => {
    if (!selected) return;
    modal.confirm({
      title: t("salary.deleteBatchTitle"),
      content: t("salary.deleteBatchBody"),
      okText: t("salary.deleteBatchOk"),
      cancelText: t("common.cancel"),
      okButtonProps: { danger: true },
      onOk: async () => {
        setBusy(true);
        try {
          await deleteSalaryAdvanceBatch(selected.batch.id);
          message.success(t("salary.batchDeleted"));
          setSelected(null);
          setSelectedRecord(null);
          setJobDetail(null);
          await reload();
        } catch (error) {
          message.error(error instanceof Error ? error.message : String(error));
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const recordColumns: ColumnsType<SalaryAdvanceRecord> = [
    {
      title: t("salary.sourceRow"),
      dataIndex: "sourceRowNo",
      width: 56,
    },
    {
      title: t("salary.empId"),
      dataIndex: "empId",
      width: 118,
      render: (value: string) => <strong>{value}</strong>,
    },
    {
      title: t("salary.applicant"),
      key: "name",
      width: 180,
      ellipsis: true,
      render: (_, record) =>
        displayValue(
          record.normalizedData.applicant_display_name ??
            record.normalizedData.en_name,
        ),
    },
    {
      title: t("salary.department"),
      key: "department",
      width: 150,
      ellipsis: true,
      render: (_, record) => displayValue(record.normalizedData.department),
    },
    {
      title: t("salary.advanceAmount"),
      key: "advance",
      align: "right",
      width: 125,
      render: (_, record) => (
        <span className="money-value">
          {formatFinanceAmount(record.normalizedData.advance_amount as string)}
        </span>
      ),
    },
    {
      title: t("salary.validation"),
      dataIndex: "validationStatus",
      width: 96,
      render: (value: ValidationStatus) => (
        <ValidationTag status={value} t={t} />
      ),
    },
    {
      title: t("salary.document"),
      dataIndex: "generationStatus",
      width: 106,
      render: (value: string) => <GenerationTag status={value} t={t} />,
    },
  ];

  const batchColumns: ColumnsType<SalaryAdvanceBatch> = [
    {
      title: t("salary.batchNo"),
      dataIndex: "batchNo",
      width: 250,
      render: (value: string, batch) => (
        <div className="salary-batch-name">
          <strong>{value}</strong>
          <span>{batch.sourceFileName}</span>
        </div>
      ),
    },
    { title: t("salary.period"), dataIndex: "period", width: 86 },
    {
      title: t("salary.status"),
      dataIndex: "status",
      width: 118,
      render: (value: BatchStatus) => <BatchStatusTag status={value} t={t} />,
    },
    {
      title: t("salary.validCount"),
      key: "counts",
      width: 116,
      render: (_, batch) => (
        <span>
          {batch.validRows + batch.warningRows} /{" "}
          <strong className={batch.invalidRows ? "error-copy" : ""}>
            {batch.invalidRows}
          </strong>
        </span>
      ),
    },
    {
      title: t("salary.importedAt"),
      dataIndex: "createdAt",
      width: 168,
      render: formatFinanceDateTime,
    },
  ];

  const renderLedger = () => (
    <div className="salary-ledger">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <FinanceLifecycleTabs
          activeKey={phase}
          ariaLabel={t("lifecycle.aria", { module: t("nav.salaryAdvance") })}
          counts={lifecycleCounts}
          labels={{
            pending: t("lifecycle.pending"),
            issuing: t("lifecycle.issuing"),
            history: t("lifecycle.history"),
            all: t("lifecycle.all"),
          }}
          onChange={(nextPhase) => {
            setPhase(nextPhase);
            setSelected(null);
            setSelectedRecord(null);
            setFilters((f) => ({ ...f, status: "all", period: "all" }));
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Button
            icon={<UploadOutlined />}
            type="primary"
            onClick={() => setImportOpen(true)}
          >
            {t("salary.import")}
          </Button>
          {filters.period !== "all" && (
            <Button
              size="small"
              type="link"
              onClick={() => {
                setFilters((f) => ({ ...f, period: "all" }));
                setSelected(null);
              }}
            >
              {t("wht.resetFilters")}
            </Button>
          )}
          <Button
            icon={<FilterOutlined />}
            onClick={() => setFiltersCollapsed((prev) => !prev)}
          >
            {t("wht.moreFilters")}{" "}
            {filtersCollapsed ? <DownOutlined /> : <UpOutlined />}
          </Button>
        </div>
      </div>

      {!filtersCollapsed && (
        <div
          className="salary-filter-bar"
          style={{
            display: "flex",
            gap: 16,
            padding: "12px 16px",
            background: "#fff",
            borderRadius: 8,
            marginBottom: 16,
            alignItems: "center",
          }}
        >
          <Input
            maxLength={6}
            placeholder={t("salary.periodPlaceholder")}
            prefix={<FileProtectOutlined />}
            value={filters.period === "all" ? "" : filters.period}
            onChange={(event) =>
              setFilters((f) => ({
                ...f,
                period: event.target.value.replace(/\D/g, "") || "all",
              }))
            }
          />
          <Select
            allowClear
            placeholder={t("salary.allBatchStatuses")}
            value={filters.status === "all" ? undefined : filters.status}
            options={BATCH_STATUSES.map((value) => ({
              value,
              label: t(`salary.batchStatus.${value}` as TranslationKey),
            }))}
            onChange={(val) =>
              setFilters((f) => ({ ...f, status: val || "all" }))
            }
          />
          <Button
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={() => void reload()}
          >
            {t("salary.query")}
          </Button>
        </div>
      )}

      {filters.period === "all" ? (
        <section className="salary-table-card">
          <div className="salary-section-heading">
            <div>
              <span>SUMMARY</span>
              <strong>{t("wht.period")}</strong>
            </div>
          </div>
          <Table
            columns={periodColumns}
            dataSource={periodSummaryRows}
            loading={loading}
            pagination={{ pageSize: 10 }}
            rowKey="period"
            size="small"
            onRow={(record) => ({
              onClick: () =>
                setFilters((f) => ({ ...f, period: record.period })),
            })}
          />
        </section>
      ) : !selected ? (
        <section className="salary-table-card">
          <div className="salary-section-heading">
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <Button
                icon={<ArrowLeftOutlined />}
                onClick={() => setFilters((f) => ({ ...f, period: "all" }))}
              >
                {t("wht.backToAllPeriods")}
              </Button>
              <div>
                <span>IMPORT BATCHES</span>
                <strong>{filters.period}</strong>
              </div>
            </div>
            <small>
              {t("salary.batchCount", {
                count: visibleBatches.filter((b) => b.period === filters.period)
                  .length,
              })}
            </small>
          </div>
          <Table<SalaryAdvanceBatch>
            columns={batchColumns}
            dataSource={visibleBatches.filter(
              (b) => b.period === filters.period,
            )}
            loading={loading}
            pagination={{ pageSize: 5, hideOnSinglePage: true }}
            rowKey="id"
            size="small"
            onRow={(item) => ({
              onClick: () => void loadBatch(item.id),
            })}
          />
        </section>
      ) : (
        <section className="salary-table-card">
          <div style={{ marginBottom: 16 }}>
            <Button
              icon={<ArrowLeftOutlined />}
              onClick={() => setSelected(null)}
            >
              {t("wht.backToLedger")}
            </Button>
          </div>
          <div className="salary-batch-toolbar">
            <div>
              <span>{selected.batch.batchNo}</span>
              <strong>
                {selected.batch.period} · {selected.batch.sourceFileName}
              </strong>
            </div>
            <Space wrap>
              <Button
                icon={<DownloadOutlined />}
                onClick={() => void downloadValidationReport(selected.batch.id)}
              >
                {t("salary.validationReport")}
              </Button>
              <Button
                danger
                disabled={
                  !["validating", "validation_failed", "ready"].includes(
                    selected.batch.status,
                  )
                }
                icon={<DeleteOutlined />}
                loading={busy}
                onClick={removeBatch}
              >
                {t("salary.deleteBatch")}
              </Button>
              <Button
                disabled={
                  !["ready", "validation_failed"].includes(
                    selected.batch.status,
                  )
                }
                icon={<RetweetOutlined />}
                loading={busy}
                onClick={() =>
                  void run(
                    () => revalidateSalaryAdvanceBatch(selected.batch.id),
                    t("salary.revalidated"),
                  )
                }
              >
                {t("salary.revalidate")}
              </Button>
              <Button
                disabled={selected.batch.status !== "ready"}
                icon={<LockOutlined />}
                loading={busy}
                onClick={() =>
                  modal.confirm({
                    title: t("salary.lockTitle"),
                    content: t("salary.lockBody"),
                    okText: t("salary.lockOk"),
                    cancelText: t("common.cancel"),
                    onOk: () =>
                      run(
                        () => lockSalaryAdvanceBatch(selected.batch.id),
                        t("salary.locked"),
                      ),
                  })
                }
              >
                {t("salary.lock")}
              </Button>
              <Button
                disabled={!["ready", "locked"].includes(selected.batch.status)}
                icon={<SafetyCertificateOutlined />}
                loading={busy}
                type="primary"
                onClick={() => {
                  startGeneration().catch((err) => {
                    message.error(
                      err instanceof Error ? err.message : String(err),
                    );
                  });
                }}
              >
                {selected.batch.status === "ready"
                  ? t("salary.batchApproveAndGenerate")
                  : t("salary.generate")}
              </Button>
            </Space>
          </div>

          <div className="salary-metrics">
            <div>
              <span>{t("salary.totalRows")}</span>
              <strong>{selected.batch.totalRows}</strong>
            </div>
            <div>
              <span>{t("salary.validRows")}</span>
              <strong>{selected.batch.validRows}</strong>
            </div>
            <div>
              <span>{t("salary.warningRows")}</span>
              <strong>{selected.batch.warningRows}</strong>
            </div>
            <div className={selected.batch.invalidRows ? "has-error" : ""}>
              <span>{t("salary.invalidRows")}</span>
              <strong>{selected.batch.invalidRows}</strong>
            </div>
          </div>

          {jobDetail && (
            <div className="salary-job-strip">
              <div>
                <span>
                  {t("salary.job", { id: jobDetail.job.id.slice(0, 8) })}
                </span>
                <strong>
                  {t(
                    `salary.batchStatus.${jobDetail.job.status}` as TranslationKey,
                  )}
                </strong>
              </div>
              <Progress
                percent={
                  jobDetail.job.totalCount
                    ? Math.round(
                        ((jobDetail.job.successCount +
                          jobDetail.job.failedCount) /
                          jobDetail.job.totalCount) *
                          100,
                      )
                    : 0
                }
                status={jobDetail.job.failedCount ? "exception" : "active"}
              />
              <Space>
                {jobDetail.job.failedCount > 0 && (
                  <Button
                    icon={<RetweetOutlined />}
                    loading={busy}
                    size="small"
                    onClick={() => void retryGeneration()}
                  >
                    {t("salary.retryFailed")}
                  </Button>
                )}
                {jobDetail.job.successCount > 0 && (
                  <>
                    <Button
                      icon={<CloudDownloadOutlined />}
                      size="small"
                      onClick={() =>
                        void downloadJobArtifact(jobDetail.job.id, "zip")
                      }
                    >
                      ZIP
                    </Button>
                    <Button
                      icon={<FilePdfOutlined />}
                      size="small"
                      onClick={() =>
                        void downloadJobArtifact(jobDetail.job.id, "merged-pdf")
                      }
                    >
                      {t("salary.mergedPdf")}
                    </Button>
                    <Button
                      size="small"
                      onClick={() =>
                        void downloadJobArtifact(jobDetail.job.id, "manifest")
                      }
                    >
                      manifest
                    </Button>
                  </>
                )}
              </Space>
            </div>
          )}

          <Table<SalaryAdvanceRecord>
            columns={recordColumns}
            dataSource={selected.records}
            pagination={{ pageSize: 12, hideOnSinglePage: true }}
            rowClassName={(record) =>
              record.id === selectedRecord?.id ? "selected-table-row" : ""
            }
            rowKey="id"
            scroll={{ x: 900 }}
            size="small"
            onRow={(record) => ({
              onClick: () => setSelectedRecord(record),
            })}
          />
        </section>
      )}
    </div>
  );

  return (
    <section className="salary-workspace" aria-label={t("nav.salaryAdvance")}>
      {/* 页头格式与 WHT / TAX INV 一致：英文模块码 + <small> 里的中文功能名，
          功能名走 i18n 才能跟着语言切换走。 */}
      <header className="workspace-header">
        <div>
          <h1>
            <span>SALARY ADVANCE</span>
            <small>
              {workspaceView === "batches"
                ? t("salary.title")
                : t("salary.employeeMaster")}
            </small>
          </h1>
          <p>{t("salary.subtitle")}</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="workspace-view-switch" role="tablist">
            <button
              aria-selected={workspaceView === "batches"}
              className={workspaceView === "batches" ? "is-active" : ""}
              role="tab"
              type="button"
              onClick={() => {
                setWorkspaceView("batches");
                setSelected(null);
                setFilters((f) => ({ ...f, period: "all" }));
              }}
            >
              {t("salary.batchLedger")}
            </button>
            <button
              aria-selected={workspaceView === "single"}
              className={workspaceView === "single" ? "is-active" : ""}
              role="tab"
              type="button"
              onClick={() => setWorkspaceView("single")}
            >
              {t("salary.singleIssuanceButton")}
            </button>
            <button
              aria-selected={workspaceView === "employees"}
              className={workspaceView === "employees" ? "is-active" : ""}
              role="tab"
              type="button"
              onClick={() => setWorkspaceView("employees")}
            >
              {t("salary.employeeMaster")}
            </button>
          </div>
          <Tooltip title={t("salary.noOfficeHint")}>
            <span className="workspace-health-pill">
              <span className="health-dot" />
              {t("salary.noOfficePill")}
            </span>
          </Tooltip>
        </div>
      </header>

      <div className="workspace-view-host" hidden={workspaceView !== "batches"}>
        {renderLedger()}
      </div>
      <div className="workspace-view-host" hidden={workspaceView !== "single"}>
        <SingleIssuanceConsole
          open={workspaceView === "single"}
          onClose={() => setWorkspaceView("batches")}
          onSuccess={(detail) => {
            setWorkspaceView("batches");
            setFilters((f) => ({
              ...f,
              period: detail.batch.period,
              status: "all",
            }));
            loadBatch(detail.batch.id);
          }}
        />
      </div>
      <div
        className="workspace-view-host"
        hidden={workspaceView !== "employees"}
      >
        <EmployeeDirectory t={t} />
      </div>

      {selectedRecord && (
        <RecordDrawer
          busy={busy}
          documents={selectedDocuments}
          record={selectedRecord}
          t={t}
          onClose={() => setSelectedRecord(null)}
          onDownload={(document, format) =>
            void downloadSalaryAdvanceDocument(
              document.id,
              format,
              format === "xlsx"
                ? (document.xlsxFileName ?? "salary-advance.xlsx")
                : (document.pdfFileName ?? "salary-advance.pdf"),
            )
          }
          onEdit={openEdit}
          onPreview={() =>
            void run(
              () => previewSalaryAdvanceRecord(selectedRecord.id),
              t("salary.previewOpened"),
            )
          }
        />
      )}

      <Modal
        destroyOnHidden
        forceRender
        open={importOpen}
        title={t("salary.importTitle")}
        okText={t("salary.importOk")}
        cancelText={t("common.cancel")}
        confirmLoading={busy}
        onCancel={() => setImportOpen(false)}
        onOk={() => void submitImport()}
      >
        <Alert
          className="salary-modal-alert"
          showIcon
          type="info"
          title={t("salary.importSafety")}
        />
        <div className="salary-template-download">
          <Button
            icon={<DownloadOutlined />}
            size="small"
            onClick={() => void downloadTemplate()}
          >
            {t("salary.downloadImportTemplate")}
          </Button>
          <small>{t("salary.importTemplateHint")}</small>
        </div>
        <Form form={importForm} layout="vertical">
          <Form.Item
            label={t("salary.importPeriod")}
            name="period"
            rules={[
              { required: true, message: t("salary.importPeriodRequired") },
              { pattern: /^\d{6}$/, message: t("salary.importPeriodFormat") },
            ]}
          >
            <Input maxLength={6} placeholder="202607" />
          </Form.Item>
          <Form.Item label={t("salary.importFile")} required>
            <Upload
              accept=".xlsx"
              beforeUpload={() => false}
              fileList={importFiles}
              maxCount={1}
              onChange={({ fileList }) => setImportFiles(fileList)}
            >
              <Button icon={<UploadOutlined />}>
                {t("salary.selectXlsx")}
              </Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        className="salary-edit-modal"
        destroyOnHidden
        forceRender
        open={editOpen}
        title={t("salary.editTitle", { empId: selectedRecord?.empId ?? "" })}
        okText={t("salary.editOk")}
        cancelText={t("common.cancel")}
        confirmLoading={busy}
        width={760}
        onCancel={() => setEditOpen(false)}
        onOk={() => void submitEdit()}
      >
        <Form className="salary-edit-grid" form={editForm} layout="vertical">
          <Form.Item
            label={t("salary.firstName")}
            name="first_name"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            label={t("salary.surname")}
            name="surname"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item label={t("salary.chineseName")} name="chinese_name">
            <Input />
          </Form.Item>
          <Form.Item
            label={t("salary.department")}
            name="department"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            label={t("salary.position")}
            name="position"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            label={t("salary.startDate")}
            name="start_date"
            rules={[{ required: true }]}
          >
            <Input placeholder={t("salary.datePlaceholder")} />
          </Form.Item>
          <Form.Item
            className="salary-edit-wide"
            label={t("salary.reason")}
            name="reason"
          >
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item
            label={t("salary.advanceAmount")}
            name="advance_amount"
            rules={[{ required: true }]}
          >
            <InputNumber min={0.01} precision={2} />
          </Form.Item>
          <Form.Item
            label={t("salary.monthlyDeduction")}
            name="monthly_deduction"
            rules={[{ required: true }]}
          >
            <InputNumber min={0.01} precision={2} />
          </Form.Item>
          <Form.Item
            label={t("salary.requestDate")}
            name="request_date"
            rules={[{ required: true }]}
          >
            <Input placeholder={t("salary.datePlaceholder")} />
          </Form.Item>
          <Form.Item
            label={t("salary.approvalStatus")}
            name="approval_status"
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { value: "Pending", label: t("salary.approvalPending") },
                { value: "Approve", label: t("salary.approvalApprove") },
                {
                  value: "Not approved",
                  label: t("salary.approvalNotApproved"),
                },
              ]}
            />
          </Form.Item>
          {/* 签名两列刻意不必填（2026-08-05 口径，参照 WHT）：章在开具时选，
              这里填的只是"盖哪张章"的可选提示。设成必填会把开具时才定的事
              挡在编辑这一步，正是当初从 validation.py 删掉整套签名校验的原因。 */}
          <Form.Item
            label={t("salary.financeCode")}
            name="finance_signature_code"
          >
            <Select
              allowClear
              showSearch
              placeholder={t("salary.financeSignature")}
              options={financeSignatures.map((s) => ({
                value: s.name,
                label: `${s.name}${s.isDefault ? ` [${t("salary.defaultSignatureTag")}]` : ""}`,
              }))}
            />
          </Form.Item>
          <Form.Item label={t("salary.mdCode")} name="md_signature_code">
            <Select
              allowClear
              showSearch
              placeholder={t("salary.mdSignature")}
              options={mdSignatures.map((s) => ({
                value: s.name,
                label: `${s.name}${s.isDefault ? ` [${t("salary.defaultSignatureTag")}]` : ""}`,
              }))}
            />
          </Form.Item>
          <Form.Item
            className="salary-edit-wide"
            label={t("salary.financeComment")}
            name="finance_comment"
          >
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        destroyOnHidden
        open={generateOpen}
        title={t("salary.batchApproveGenerateTitle")}
        okText={t("common.confirm")}
        cancelText={t("common.cancel")}
        confirmLoading={busy}
        onCancel={() => setGenerateOpen(false)}
        onOk={() => {
          submitGeneration().catch((err) => {
            message.error(err instanceof Error ? err.message : String(err));
          });
        }}
      >
        <Space
          direction="vertical"
          style={{ width: "100%", marginTop: 8 }}
          size="large"
        >
          <div>
            <div style={{ marginBottom: 6, fontWeight: 500 }}>
              {t("salary.financeSignature")}
            </div>
            <Select
              aria-label={t("salary.financeSignature")}
              style={{ width: "100%" }}
              value={selectedFinanceSigId}
              onChange={(val) => setSelectedFinanceSigId(val)}
              options={financeSignatures.map((s) => ({
                value: s.id,
                label: `${s.name}${s.signerName ? ` (${s.signerName})` : ""}${s.isDefault ? ` [${t("salary.defaultSignatureTag")}]` : ""}`,
              }))}
            />
          </div>

          <div>
            <div style={{ marginBottom: 6, fontWeight: 500 }}>
              {t("salary.mdSignature")}
            </div>
            <Select
              aria-label={t("salary.mdSignature")}
              style={{ width: "100%" }}
              value={selectedMdSigId}
              onChange={(val) => setSelectedMdSigId(val)}
              options={mdSignatures.map((s) => ({
                value: s.id,
                label: `${s.name}${s.signerName ? ` (${s.signerName})` : ""}${s.isDefault ? ` [${t("salary.defaultSignatureTag")}]` : ""}`,
              }))}
            />
          </div>
        </Space>
      </Modal>
    </section>
  );
}
