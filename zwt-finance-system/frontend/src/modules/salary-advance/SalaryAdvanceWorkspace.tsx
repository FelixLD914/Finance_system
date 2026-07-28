import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircleOutlined,
  CloseOutlined,
  CloudDownloadOutlined,
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
  SettingOutlined,
  UploadOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App as AntApp,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Select,
  Space,
  Table,
  Tag,
  Upload,
} from "antd";
import type { UploadFile } from "antd";
import type { ColumnsType } from "antd/es/table";

import type { Translate } from "../../i18n";
import { listSignatures } from "../wht/api";
import type { SignatureAsset } from "../wht/types";
import {
  createSalaryAdvanceJob,
  createSignatureBinding,
  downloadJobArtifact,
  downloadSalaryAdvanceDocument,
  downloadValidationReport,
  getSalaryAdvanceBatch,
  getSalaryAdvanceJob,
  importSalaryAdvanceBatch,
  listSalaryAdvanceBatches,
  listSalaryAdvanceJobs,
  listSalaryAdvanceTemplates,
  listSignatureBindings,
  lockSalaryAdvanceBatch,
  previewSalaryAdvanceRecord,
  retrySalaryAdvanceJob,
  revalidateSalaryAdvanceBatch,
  updateSalaryAdvanceRecord,
} from "./api";
import type {
  BatchStatus,
  SalaryAdvanceBatch,
  SalaryAdvanceBatchDetail,
  SalaryAdvanceDocument,
  SalaryAdvanceJobDetail,
  SalaryAdvanceRecord,
  SalaryAdvanceTemplate,
  SignatureBinding,
  SignatureBindingInput,
  ValidationStatus,
} from "./types";

type WorkspaceView = "ledger" | "maintenance";

const batchLabels: Record<BatchStatus, string> = {
  validating: "校验中",
  validation_failed: "校验未通过",
  ready: "待锁定",
  locked: "已锁定",
  generating: "生成中",
  completed: "已完成",
  partially_completed: "部分完成",
  failed: "生成失败",
};

const validationLabels: Record<ValidationStatus, string> = {
  valid: "通过",
  warning: "有警告",
  invalid: "错误",
};

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function dateTime(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("zh-CN", { hour12: false });
}

function BatchStatusTag({ status }: { status: BatchStatus }) {
  const color =
    status === "completed"
      ? "green"
      : status === "validation_failed" || status === "failed"
        ? "red"
        : status === "partially_completed"
          ? "orange"
          : status === "generating"
            ? "processing"
            : status === "locked"
              ? "blue"
              : "default";
  return <Tag color={color}>{batchLabels[status]}</Tag>;
}

function ValidationTag({ status }: { status: ValidationStatus }) {
  const color = status === "valid" ? "green" : status === "warning" ? "orange" : "red";
  return <Tag color={color}>{validationLabels[status]}</Tag>;
}

interface RecordDrawerProps {
  record: SalaryAdvanceRecord;
  documents: SalaryAdvanceDocument[];
  busy: boolean;
  onClose: () => void;
  onEdit: () => void;
  onPreview: () => void;
  onDownload: (
    document: SalaryAdvanceDocument,
    format: "xlsx" | "pdf",
  ) => void;
}

function RecordDrawer({
  record,
  documents,
  busy,
  onClose,
  onEdit,
  onPreview,
  onDownload,
}: RecordDrawerProps) {
  const data = record.normalizedData;
  const issues = [...record.validationErrors, ...record.validationWarnings];
  return (
    <Drawer
      className="salary-record-drawer"
      destroyOnHidden
      open
      placement="right"
      title={
        <div className="salary-drawer-title">
          <span>工资预支记录</span>
          <strong>{record.empId}</strong>
        </div>
      }
      width={560}
      closeIcon={false}
      extra={
        <Button
          aria-label="关闭明细"
          icon={<CloseOutlined />}
          type="text"
          onClick={onClose}
        />
      }
      onClose={onClose}
    >
      <div className="salary-drawer-status">
        <ValidationTag status={record.validationStatus} />
        <Tag>{record.generationStatus}</Tag>
        <span>源表第 {record.sourceRowNo} 行 · v{record.version}</span>
      </div>

      {issues.length > 0 && (
        <Alert
          className="salary-issue-alert"
          showIcon
          type={record.validationErrors.length ? "error" : "warning"}
          message={`${record.validationErrors.length} 个错误，${record.validationWarnings.length} 个警告`}
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
      )}

      <section className="inspector-section">
        <h3>员工与申请</h3>
        <Descriptions className="task-descriptions" column={1} colon={false}>
          <Descriptions.Item label="期间">{record.period}</Descriptions.Item>
          <Descriptions.Item label="姓名">
            {displayValue(data.applicant_display_name)}
          </Descriptions.Item>
          <Descriptions.Item label="英文名">
            {displayValue(data.en_name)}
          </Descriptions.Item>
          <Descriptions.Item label="部门 / 职位">
            {displayValue(data.department)} / {displayValue(data.position)}
          </Descriptions.Item>
          <Descriptions.Item label="入职日期">
            {displayValue(data.start_date)}
          </Descriptions.Item>
          <Descriptions.Item label="预支原因">
            {displayValue(data.reason)}
          </Descriptions.Item>
          <Descriptions.Item label="预支金额">
            THB {displayValue(data.advance_amount)}
          </Descriptions.Item>
          <Descriptions.Item label="月扣金额">
            THB {displayValue(data.monthly_deduction)}
          </Descriptions.Item>
        </Descriptions>
      </section>

      <section className="inspector-section">
        <h3>审批与签名快照</h3>
        <Descriptions className="task-descriptions" column={1} colon={false}>
          <Descriptions.Item label="审批内容">
            {displayValue(data.approval_status)}
          </Descriptions.Item>
          <Descriptions.Item label="财务签名代码">
            {displayValue(data.finance_signature_code)}
          </Descriptions.Item>
          <Descriptions.Item label="总经理签名代码">
            {displayValue(data.md_signature_code)}
          </Descriptions.Item>
          <Descriptions.Item label="申请人签名">
            {displayValue(data.applicant_signature_mode)}（输出区保持空白）
          </Descriptions.Item>
          <Descriptions.Item label="数据指纹">
            <span className="hash-value">{record.dataFingerprint}</span>
          </Descriptions.Item>
        </Descriptions>
      </section>

      <section className="inspector-section">
        <div className="section-title-row">
          <h3>生成文件</h3>
          <span>{documents.length} 个版本</span>
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
                        ? dateTime(document.createdAt)
                        : document.errorMessage}
                    </small>
                  </span>
                </div>
                {document.status === "success" && (
                  <Space size={4}>
                    {document.xlsxFileName && (
                      <Button
                        aria-label="下载 XLSX"
                        icon={<FileExcelOutlined />}
                        size="small"
                        type="text"
                        onClick={() => onDownload(document, "xlsx")}
                      />
                    )}
                    {document.pdfFileName && (
                      <Button
                        aria-label="下载 PDF"
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
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未生成" />
        )}
      </section>

      <div className="salary-drawer-actions">
        <Button
          disabled={busy || record.validationStatus === "invalid"}
          icon={<EyeOutlined />}
          onClick={onPreview}
        >
          PDF 预览
        </Button>
        <Button disabled={busy} icon={<EditOutlined />} onClick={onEdit}>
          修正记录
        </Button>
      </div>
    </Drawer>
  );
}

export function SalaryAdvanceWorkspace({ t }: { t: Translate }) {
  const { message, modal } = AntApp.useApp();
  const [view, setView] = useState<WorkspaceView>("ledger");
  const [batches, setBatches] = useState<SalaryAdvanceBatch[]>([]);
  const [selected, setSelected] = useState<SalaryAdvanceBatchDetail | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<SalaryAdvanceRecord | null>(
    null,
  );
  const [jobDetail, setJobDetail] = useState<SalaryAdvanceJobDetail | null>(null);
  const [templates, setTemplates] = useState<SalaryAdvanceTemplate[]>([]);
  const [bindings, setBindings] = useState<SignatureBinding[]>([]);
  const [signatures, setSignatures] = useState<SignatureAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [period, setPeriod] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>();
  const [importOpen, setImportOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [bindingOpen, setBindingOpen] = useState(false);
  const [importFiles, setImportFiles] = useState<UploadFile[]>([]);
  const [importForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [bindingForm] = Form.useForm();

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
        ? detail.records.find((record) => record.id === current.id) ?? null
        : null,
    );
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const next = await listSalaryAdvanceBatches(period || undefined, statusFilter);
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
  }, [loadBatch, message, period, selected?.batch.id, statusFilter]);

  const loadMaintenance = useCallback(async () => {
    setLoading(true);
    try {
      const [nextTemplates, nextBindings, nextSignatures] = await Promise.all([
        listSalaryAdvanceTemplates(),
        listSignatureBindings(),
        listSignatures(false),
      ]);
      setTemplates(nextTemplates);
      setBindings(nextBindings);
      setSignatures(nextSignatures);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void reload();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (view === "maintenance") void loadMaintenance();
  }, [loadMaintenance, view]);

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

  const submitImport = async () => {
    try {
      const values = await importForm.validateFields();
      const file = importFiles[0]?.originFileObj;
      if (!file) {
        message.error("请选择工资预支 XLSX 文件");
        return;
      }
      setBusy(true);
      const detail = await importSalaryAdvanceBatch(values.period, file);
      message.success(
        `导入完成：${detail.batch.totalRows} 行，${detail.batch.invalidRows} 行错误`,
      );
      setImportOpen(false);
      setImportFiles([]);
      importForm.resetFields();
      setPeriod(values.period);
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
      message.success("记录已保存并重新校验");
      if (selected) await loadBatch(selected.batch.id);
    } catch (error) {
      if (error instanceof Error) message.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const startGeneration = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const job = await createSalaryAdvanceJob(selected.batch.id);
      setJobDetail(await getSalaryAdvanceJob(job.id));
      message.success("生成任务已进入后台队列");
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
      message.success("失败记录已重新进入生成队列");
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const submitBinding = async () => {
    try {
      const values = await bindingForm.validateFields();
      setBusy(true);
      await createSignatureBinding(values as SignatureBindingInput);
      message.success("签名业务绑定已创建，新版本立即生效");
      setBindingOpen(false);
      bindingForm.resetFields();
      await loadMaintenance();
    } catch (error) {
      if (error instanceof Error) message.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const recordColumns: ColumnsType<SalaryAdvanceRecord> = [
    {
      title: "行",
      dataIndex: "sourceRowNo",
      width: 56,
    },
    {
      title: "工号",
      dataIndex: "empId",
      width: 118,
      render: (value: string) => <strong>{value}</strong>,
    },
    {
      title: "申请人",
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
      title: "部门",
      key: "department",
      width: 150,
      ellipsis: true,
      render: (_, record) => displayValue(record.normalizedData.department),
    },
    {
      title: "预支金额",
      key: "advance",
      align: "right",
      width: 125,
      render: (_, record) =>
        Number(record.normalizedData.advance_amount ?? 0).toLocaleString("zh-CN", {
          minimumFractionDigits: 2,
        }),
    },
    {
      title: "校验",
      dataIndex: "validationStatus",
      width: 96,
      render: (value: ValidationStatus) => <ValidationTag status={value} />,
    },
    {
      title: "文件",
      dataIndex: "generationStatus",
      width: 96,
      render: (value: string) => <Tag>{value}</Tag>,
    },
  ];

  const batchColumns: ColumnsType<SalaryAdvanceBatch> = [
    {
      title: "批次",
      dataIndex: "batchNo",
      width: 250,
      render: (value: string, batch) => (
        <div className="salary-batch-name">
          <strong>{value}</strong>
          <span>{batch.sourceFileName}</span>
        </div>
      ),
    },
    { title: "期间", dataIndex: "period", width: 86 },
    {
      title: "状态",
      dataIndex: "status",
      width: 118,
      render: (value: BatchStatus) => <BatchStatusTag status={value} />,
    },
    {
      title: "有效 / 错误",
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
      title: "导入时间",
      dataIndex: "createdAt",
      width: 168,
      render: dateTime,
    },
  ];

  const bindingColumns: ColumnsType<SignatureBinding> = [
    {
      title: "业务代码",
      dataIndex: "signatureCode",
      width: 210,
      render: (value: string, binding) => (
        <div className="salary-batch-name">
          <strong>{value}</strong>
          <span>绑定 v{binding.version}</span>
        </div>
      ),
    },
    {
      title: "角色",
      dataIndex: "role",
      width: 100,
      render: (value: SignatureBinding["role"]) =>
        value === "finance" ? "财务" : "总经理",
    },
    {
      title: "签名资产",
      key: "asset",
      render: (_, binding) => `${binding.assetName} · v${binding.assetVersion}`,
    },
    {
      title: "范围",
      key: "scope",
      width: 180,
      render: (_, binding) =>
        `${binding.scopeType}${binding.scopeValue ? ` · ${binding.scopeValue}` : ""}`,
    },
    {
      title: "状态",
      dataIndex: "active",
      width: 90,
      render: (value: boolean) => (
        <Tag color={value ? "green" : "default"}>{value ? "生效" : "历史"}</Tag>
      ),
    },
  ];

  const renderLedger = () => (
    <div className="salary-ledger">
      <div className="salary-filter-bar">
        <Input
          maxLength={6}
          placeholder="期间 YYYYMM"
          prefix={<FileProtectOutlined />}
          value={period}
          onChange={(event) => setPeriod(event.target.value.replace(/\D/g, ""))}
          onPressEnter={() => void reload()}
        />
        <Select
          allowClear
          placeholder="全部批次状态"
          value={statusFilter}
          options={Object.entries(batchLabels).map(([value, label]) => ({
            value,
            label,
          }))}
          onChange={setStatusFilter}
        />
        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void reload()}>
          查询
        </Button>
        <span className="salary-filter-spacer" />
        <Button icon={<UploadOutlined />} type="primary" onClick={() => setImportOpen(true)}>
          导入工资预支表
        </Button>
      </div>

      <section className="salary-table-card">
        <div className="salary-section-heading">
          <div>
            <span>IMPORT BATCHES</span>
            <strong>导入批次</strong>
          </div>
          <small>{batches.length} 个批次</small>
        </div>
        <Table<SalaryAdvanceBatch>
          columns={batchColumns}
          dataSource={batches}
          loading={loading}
          pagination={{ pageSize: 5, hideOnSinglePage: true }}
          rowClassName={(batch) =>
            batch.id === selected?.batch.id ? "selected-table-row" : ""
          }
          rowKey="id"
          size="small"
          onRow={(batch) => ({
            onClick: () => void loadBatch(batch.id),
          })}
        />
      </section>

      {selected ? (
        <section className="salary-table-card salary-record-card">
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
                校验报告
              </Button>
              <Button
                disabled={!["ready", "validation_failed"].includes(selected.batch.status)}
                icon={<RetweetOutlined />}
                loading={busy}
                onClick={() =>
                  void run(
                    () => revalidateSalaryAdvanceBatch(selected.batch.id),
                    "批次已重新校验",
                  )
                }
              >
                重新校验
              </Button>
              <Button
                disabled={selected.batch.status !== "ready"}
                icon={<LockOutlined />}
                loading={busy}
                onClick={() =>
                  modal.confirm({
                    title: "锁定工资预支批次？",
                    content:
                      "锁定后记录不可再编辑；正式文件会使用当前模板与签名绑定快照。",
                    okText: "确认锁定",
                    onOk: () =>
                      run(
                        () => lockSalaryAdvanceBatch(selected.batch.id),
                        "批次已锁定",
                      ),
                  })
                }
              >
                锁定
              </Button>
              <Button
                disabled={selected.batch.status !== "locked"}
                icon={<SafetyCertificateOutlined />}
                loading={busy}
                type="primary"
                onClick={() => void startGeneration()}
              >
                生成正式文件
              </Button>
            </Space>
          </div>

          <div className="salary-metrics">
            <div>
              <span>总行数</span>
              <strong>{selected.batch.totalRows}</strong>
            </div>
            <div>
              <span>校验通过</span>
              <strong>{selected.batch.validRows}</strong>
            </div>
            <div>
              <span>警告</span>
              <strong>{selected.batch.warningRows}</strong>
            </div>
            <div className={selected.batch.invalidRows ? "has-error" : ""}>
              <span>错误</span>
              <strong>{selected.batch.invalidRows}</strong>
            </div>
          </div>

          {jobDetail && (
            <div className="salary-job-strip">
              <div>
                <span>生成任务 {jobDetail.job.id.slice(0, 8)}</span>
                <strong>{jobDetail.job.status}</strong>
              </div>
              <Progress
                percent={
                  jobDetail.job.totalCount
                    ? Math.round(
                        ((jobDetail.job.successCount + jobDetail.job.failedCount) /
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
                    重试失败项
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
                      合并 PDF
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
      ) : (
        <section className="salary-empty-card">
          <Empty description="导入或选择一个批次开始处理" />
        </section>
      )}
    </div>
  );

  const renderMaintenance = () => (
    <div className="salary-maintenance">
      <Alert
        showIcon
        type="info"
        message="服务器运行时不依赖 Office"
        description="正式 PDF 使用已批准的一页静态底版和坐标版本生成；XLSX、PDF、坐标三者哈希必须匹配。模板升级通过受控发布流程制版，页面不接受任意模板覆盖。"
      />
      <section className="salary-table-card">
        <div className="salary-section-heading">
          <div>
            <span>TEMPLATE TRIPLE</span>
            <strong>模板版本与制版资产</strong>
          </div>
          <Button
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={() => void loadMaintenance()}
          >
            刷新
          </Button>
        </div>
        <Table<SalaryAdvanceTemplate>
          dataSource={templates}
          pagination={false}
          rowKey="id"
          size="small"
          columns={[
            {
              title: "版本",
              dataIndex: "version",
              width: 90,
              render: (value: string, template) => (
                <Space>
                  <strong>{value}</strong>
                  {template.active && <Tag color="green">当前</Tag>}
                </Space>
              ),
            },
            { title: "Excel 模板", dataIndex: "fileName", width: 240 },
            {
              title: "XLSX SHA-256",
              dataIndex: "sha256",
              ellipsis: true,
              render: (value: string) => <span className="hash-value">{value}</span>,
            },
            {
              title: "PDF SHA-256",
              dataIndex: "pdfUnderlaySha256",
              ellipsis: true,
              render: (value: string) => <span className="hash-value">{value}</span>,
            },
            {
              title: "坐标版本",
              dataIndex: "pdfLayoutVersion",
              width: 150,
            },
          ]}
        />
      </section>

      <section className="salary-table-card">
        <div className="salary-section-heading">
          <div>
            <span>SIGNATURE BINDINGS</span>
            <strong>签名业务代码绑定</strong>
          </div>
          <Button
            icon={<PlusOutlined />}
            type="primary"
            onClick={() => setBindingOpen(true)}
          >
            新建绑定版本
          </Button>
        </div>
        <Table<SignatureBinding>
          columns={bindingColumns}
          dataSource={bindings}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          rowKey="id"
          size="small"
        />
      </section>
    </div>
  );

  return (
    <section className="salary-workspace" aria-label={t("nav.salaryAdvance")}>
      <header className="salary-workspace-header">
        <div>
          <span className="workspace-kicker">CONTROLLED DOCUMENT ISSUANCE</span>
          <h1>
            工资预支单 <span>Salary Advance</span>
          </h1>
          <p>导入、校验、签名快照和正式文件全链路留痕。</p>
        </div>
        <div className="salary-runtime-card">
          <span className="health-dot" />
          <div>
            <strong>无 Office 生成链路</strong>
            <small>ReportLab + pypdf · A4 单页</small>
          </div>
        </div>
      </header>

      <nav className="workspace-subnav" aria-label="工资预支功能">
        <button
          className={view === "ledger" ? "is-active" : ""}
          type="button"
          onClick={() => setView("ledger")}
        >
          <FileProtectOutlined /> 批次与开具
        </button>
        <button
          className={view === "maintenance" ? "is-active" : ""}
          type="button"
          onClick={() => setView("maintenance")}
        >
          <SettingOutlined /> 模板与签名绑定
        </button>
      </nav>

      {view === "ledger" ? renderLedger() : renderMaintenance()}

      {selectedRecord && (
        <RecordDrawer
          busy={busy}
          documents={selectedDocuments}
          record={selectedRecord}
          onClose={() => setSelectedRecord(null)}
          onDownload={(document, format) =>
            void downloadSalaryAdvanceDocument(
              document.id,
              format,
              format === "xlsx"
                ? document.xlsxFileName ?? "salary-advance.xlsx"
                : document.pdfFileName ?? "salary-advance.pdf",
            )
          }
          onEdit={openEdit}
          onPreview={() =>
            void run(
              () => previewSalaryAdvanceRecord(selectedRecord.id),
              "PDF 预览已打开",
            )
          }
        />
      )}

      <Modal
        destroyOnHidden
        forceRender
        open={importOpen}
        title="导入工资预支数据"
        okText="上传并校验"
        cancelText="取消"
        confirmLoading={busy}
        onCancel={() => setImportOpen(false)}
        onOk={() => void submitImport()}
      >
        <Alert
          className="salary-modal-alert"
          showIcon
          type="info"
          message="只读取 .xlsx，不执行宏或外部链接"
        />
        <Form form={importForm} layout="vertical">
          <Form.Item
            label="工资期间"
            name="period"
            rules={[
              { required: true, message: "请输入期间" },
              { pattern: /^\d{6}$/, message: "格式为 YYYYMM" },
            ]}
          >
            <Input maxLength={6} placeholder="202607" />
          </Form.Item>
          <Form.Item label="源数据文件" required>
            <Upload
              accept=".xlsx"
              beforeUpload={() => false}
              fileList={importFiles}
              maxCount={1}
              onChange={({ fileList }) => setImportFiles(fileList)}
            >
              <Button icon={<UploadOutlined />}>选择 XLSX</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        className="salary-edit-modal"
        destroyOnHidden
        forceRender
        open={editOpen}
        title={`修正记录 · ${selectedRecord?.empId ?? ""}`}
        okText="保存并校验"
        cancelText="取消"
        confirmLoading={busy}
        width={760}
        onCancel={() => setEditOpen(false)}
        onOk={() => void submitEdit()}
      >
        <Form className="salary-edit-grid" form={editForm} layout="vertical">
          <Form.Item label="名" name="first_name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="姓" name="surname" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="中文名" name="chinese_name">
            <Input />
          </Form.Item>
          <Form.Item label="部门" name="department" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="职位" name="position" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="入职日期" name="start_date" rules={[{ required: true }]}>
            <Input placeholder="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item className="salary-edit-wide" label="预支原因" name="reason">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item
            label="预支金额"
            name="advance_amount"
            rules={[{ required: true }]}
          >
            <InputNumber min={0.01} precision={2} />
          </Form.Item>
          <Form.Item
            label="月扣金额"
            name="monthly_deduction"
            rules={[{ required: true }]}
          >
            <InputNumber min={0.01} precision={2} />
          </Form.Item>
          <Form.Item label="申请日期" name="request_date" rules={[{ required: true }]}>
            <Input placeholder="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item label="审批内容" name="approval_status" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "Approve", label: "Approve" },
                { value: "Not approved", label: "Not approved" },
              ]}
            />
          </Form.Item>
          <Form.Item
            label="财务签名代码"
            name="finance_signature_code"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            label="总经理签名代码"
            name="md_signature_code"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            className="salary-edit-wide"
            label="财务意见"
            name="finance_comment"
          >
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        destroyOnHidden
        forceRender
        open={bindingOpen}
        title="新建签名业务绑定版本"
        okText="创建并启用"
        cancelText="取消"
        confirmLoading={busy}
        onCancel={() => setBindingOpen(false)}
        onOk={() => void submitBinding()}
      >
        <Alert
          className="salary-modal-alert"
          showIcon
          type="warning"
          message="同一业务代码的旧绑定会保留为历史版本并停用"
        />
        <Form
          form={bindingForm}
          initialValues={{ scopeType: "company" }}
          layout="vertical"
        >
          <Form.Item
            label="业务签名代码"
            name="signatureCode"
            rules={[{ required: true }]}
          >
            <Input placeholder="FIN_XING_LANHUI" />
          </Form.Item>
          <Form.Item label="角色" name="role" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "finance", label: "财务" },
                { value: "md", label: "总经理" },
              ]}
            />
          </Form.Item>
          <Form.Item
            label="签名资产"
            name="signatureAssetId"
            rules={[{ required: true }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              options={signatures.map((signature) => ({
                value: signature.id,
                label: `${signature.name} · v${signature.version}`,
              }))}
            />
          </Form.Item>
          <Form.Item label="适用范围" name="scopeType" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "company", label: "全公司" },
                { value: "period", label: "指定期间" },
                { value: "employee", label: "指定员工" },
                { value: "custom", label: "自定义" },
              ]}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate>
            {({ getFieldValue }) =>
              getFieldValue("scopeType") === "company" ? null : (
                <Form.Item
                  label="范围值"
                  name="scopeValue"
                  rules={[{ required: true }]}
                >
                  <Input placeholder="期间 YYYYMM 或工号" />
                </Form.Item>
              )
            }
          </Form.Item>
        </Form>
      </Modal>
    </section>
  );
}
