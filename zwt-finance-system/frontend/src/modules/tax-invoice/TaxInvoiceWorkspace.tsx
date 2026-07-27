import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiOutlined,
  CheckCircleOutlined,
  CloseOutlined,
  CloudDownloadOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FileDoneOutlined,
  FileExcelOutlined,
  FilePdfOutlined,
  FileSearchOutlined,
  InboxOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  UploadOutlined,
  PlusOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App as AntApp,
  Button,
  Descriptions,
  Divider,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Upload,
} from "antd";
import type { UploadFile } from "antd";
import type { ColumnsType } from "antd/es/table";

import type { Translate } from "../../i18n";
import { ThaiText } from "../../shared/ThaiText";
import {
  approveTaxInvoice,
  createTaxInvoiceCorrection,
  downloadTaxInvoiceDocument,
  fetchExchangeRates,
  generateTaxInvoiceDocuments,
  getTaxInvoice,
  importDualFiles,
  importExchangeRates,
  importSample,
  listExchangeRates,
  listTaxInvoiceDocuments,
  listTaxInvoices,
  updateTaxInvoice,
  voidTaxInvoice,
} from "./api";
import type {
  ExchangeRate,
  TaxInvoice,
  TaxInvoiceDocument,
  TaxInvoiceItem,
  TaxInvoiceStatus,
} from "./types";

type WorkspaceView = "ledger" | "recognition" | "rates";

const statusLabels: Record<TaxInvoiceStatus, string> = {
  draft: "草稿",
  needs_review: "需复核",
  ready: "待批准",
  approved: "已批准",
  issued: "已出具",
  voided: "已作废",
};

const statusClasses: Record<TaxInvoiceStatus, string> = {
  draft: "status-draft",
  needs_review: "status-pending",
  ready: "status-ready",
  approved: "status-approved",
  issued: "status-issued",
  voided: "status-voided",
};

function StatusTag({ status }: { status: TaxInvoiceStatus }) {
  return (
    <Tag className={`status-tag ${statusClasses[status]}`}>
      {statusLabels[status]}
    </Tag>
  );
}

function money(value: string | null | undefined, currency = ""): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  const formatted = new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric);
  return currency ? `${currency} ${formatted}` : formatted;
}

function dateTime(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
}

function dateLabel(value: string | null): string {
  return value || "—";
}

function warningCount(invoice: TaxInvoice): number {
  return [
    invoice.submissionDateLowConfidence,
    invoice.fobVerificationFailed,
    invoice.isDap,
    invoice.items.length > 18,
  ].filter(Boolean).length;
}

function InvoiceInspector({
  invoice,
  documents,
  busy,
  onClose,
  onApprove,
  onGenerate,
  onDownload,
  onEdit,
  onVoid,
  onCorrection,
}: {
  invoice: TaxInvoice;
  documents: TaxInvoiceDocument[];
  busy: boolean;
  onClose: () => void;
  onApprove: () => void;
  onGenerate: () => void;
  onDownload: (document: TaxInvoiceDocument) => void;
  onEdit: () => void;
  onVoid: () => void;
  onCorrection: () => void;
}) {
  const warnings = warningCount(invoice);
  const canApprove = ["draft", "needs_review", "ready"].includes(invoice.status);
  const canGenerate = ["approved", "issued"].includes(invoice.status);
  return (
    <aside className="tax-inspector" aria-label="TAX INV 明细">
      <div className="inspector-header">
        <div>
          <span className="record-eyebrow">TAX INVOICE RECORD</span>
          <h2>{invoice.documentNo ?? "待分配正式编号"}</h2>
          <StatusTag status={invoice.status} />
        </div>
        <Space>
          {["draft", "needs_review", "ready"].includes(invoice.status) && (
            <Button icon={<EditOutlined />} size="small" onClick={onEdit}>
              编辑
            </Button>
          )}
          <Button
            aria-label="关闭明细"
            icon={<CloseOutlined />}
            type="text"
            onClick={onClose}
          />
        </Space>
      </div>

      {warnings > 0 && (
        <Alert
          className="tax-review-alert"
          message={`存在 ${warnings} 项需人工确认的信息`}
          description="批准即表示已核对报关提交日期、FOB 验算和贸易条款。"
          showIcon
          type="warning"
        />
      )}

      <section className="inspector-section">
        <h3>日期与编号规则</h3>
        <Descriptions className="task-descriptions" column={1} colon={false}>
          <Descriptions.Item label="正式税票编号">
            {invoice.documentNo ?? "批准时由系统生成"}
          </Descriptions.Item>
          <Descriptions.Item label="开票日期（报关提交日）">
            <strong>{dateLabel(invoice.invoiceDate)}</strong>
          </Descriptions.Item>
          <Descriptions.Item label="汇率目标日期">
            {dateLabel(invoice.exchangeTargetDate)}
          </Descriptions.Item>
          <Descriptions.Item label="实际汇率日期">
            {dateLabel(invoice.exchangeRateDate)}
          </Descriptions.Item>
          <Descriptions.Item label="BOT 汇率">
            {invoice.exchangeRate
              ? `${invoice.currency} / THB ${Number(invoice.exchangeRate).toFixed(4)}`
              : "待匹配"}
          </Descriptions.Item>
        </Descriptions>
      </section>

      <section className="inspector-section">
        <h3>客户及报关资料</h3>
        <Descriptions className="task-descriptions" column={1} colon={false}>
          <Descriptions.Item label="C/I No.">{invoice.ciNo}</Descriptions.Item>
          <Descriptions.Item label="报关单号 CDN">
            {invoice.cdn ?? "—"}
          </Descriptions.Item>
          <Descriptions.Item label="客户名称">
            <ThaiText>{invoice.customerName}</ThaiText>
          </Descriptions.Item>
          <Descriptions.Item label="客户地址">
            <ThaiText>{invoice.customerAddress}</ThaiText>
          </Descriptions.Item>
          <Descriptions.Item label="税号">{invoice.taxId ?? "—"}</Descriptions.Item>
          <Descriptions.Item label="PO No.">{invoice.poNo ?? "—"}</Descriptions.Item>
          <Descriptions.Item label="贸易条款">
            {invoice.incoterms ?? "—"}
            {invoice.isDap && <Tag color="orange">DAP 需复核</Tag>}
          </Descriptions.Item>
        </Descriptions>
      </section>

      <section className="inspector-section">
        <div className="section-title-row">
          <h3>商品明细</h3>
          <span>{invoice.items.length} / 18 行</span>
        </div>
        <Table<TaxInvoiceItem>
          columns={[
            { title: "序号", dataIndex: "lineNumber", width: 58 },
            {
              title: "商品",
              dataIndex: "productName",
              ellipsis: true,
            },
            {
              title: "数量",
              dataIndex: "quantity",
              width: 76,
              align: "right",
            },
            {
              title: "FOB USD",
              dataIndex: "fobRevenueUsd",
              width: 105,
              align: "right",
              render: (value: string | null) => money(value),
            },
          ]}
          dataSource={invoice.items}
          pagination={false}
          rowKey="id"
          scroll={{ y: 230 }}
          size="small"
        />
        <div className="tax-total-strip">
          <span>合计</span>
          <strong>{money(invoice.fobRevenueUsdTotal, "USD")}</strong>
          <strong>{money(invoice.fobRevenueThbTotal, "THB")}</strong>
        </div>
      </section>

      <section className="inspector-section">
        <div className="section-title-row">
          <h3>正式文件</h3>
          <Button
            disabled={!canGenerate}
            icon={<FileDoneOutlined />}
            loading={busy}
            size="small"
            onClick={onGenerate}
          >
            生成正式文件
          </Button>
        </div>
        {documents.length ? (
          <div className="document-stack">
            {documents.map((document) => (
              <button
                className="document-row"
                key={document.id}
                type="button"
                onClick={() => onDownload(document)}
              >
                {document.fileFormat === "pdf" ? (
                  <FilePdfOutlined />
                ) : (
                  <FileExcelOutlined />
                )}
                <span>
                  {document.fileName}
                  <small>v{document.version} · {dateTime(document.createdAt)}</small>
                </span>
                <DownloadOutlined />
              </button>
            ))}
          </div>
        ) : (
          <p className="muted-copy">批准后可生成正式模板文件。</p>
        )}
      </section>

      <div className="inspector-footer">
        {canApprove && (
          <Button
            block
            icon={<SafetyCertificateOutlined />}
            loading={busy}
            type="primary"
            onClick={onApprove}
          >
            复核通过并生成正式编号
          </Button>
        )}
        {["approved", "issued"].includes(invoice.status) && (
          <Button block danger disabled={busy} onClick={onVoid}>
            作废本张税票
          </Button>
        )}
        {invoice.status === "voided" && (
          <Button block icon={<FileSearchOutlined />} onClick={onCorrection}>
            建立更正单
          </Button>
        )}
      </div>
    </aside>
  );
}

export function TaxInvoiceWorkspace({ t }: { t: Translate }) {
  const { message, modal } = AntApp.useApp();
  const [view, setView] = useState<WorkspaceView>("ledger");
  const [invoices, setInvoices] = useState<TaxInvoice[]>([]);
  const [rates, setRates] = useState<ExchangeRate[]>([]);
  const [selected, setSelected] = useState<TaxInvoice | null>(null);
  const [documents, setDocuments] = useState<TaxInvoiceDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<TaxInvoiceStatus | "all">("all");
  const [period, setPeriod] = useState("all");
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [customsFile, setCustomsFile] = useState<File | null>(null);
  const [sampleFile, setSampleFile] = useState<File | null>(null);
  const [rateFile, setRateFile] = useState<File | null>(null);
  const [fetchOpen, setFetchOpen] = useState(false);
  const [workflowAction, setWorkflowAction] = useState<
    "void" | "correction" | null
  >(null);
  const [workflowReason, setWorkflowReason] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editForm] = Form.useForm();
  const [fetchDates, setFetchDates] = useState({
    startDate: "",
    endDate: "",
  });

  const refreshInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const response = await listTaxInvoices();
      setInvoices(response.items);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "税票台账加载失败");
    } finally {
      setLoading(false);
    }
  }, [message]);

  const refreshRates = useCallback(async () => {
    try {
      setRates(await listExchangeRates());
    } catch (error) {
      message.error(error instanceof Error ? error.message : "汇率加载失败");
    }
  }, [message]);

  useEffect(() => {
    void Promise.all([refreshInvoices(), refreshRates()]);
  }, [refreshInvoices, refreshRates]);

  const openInvoice = useCallback(
    async (invoice: TaxInvoice) => {
      setBusy(true);
      try {
        const [detail, nextDocuments] = await Promise.all([
          getTaxInvoice(invoice.id),
          listTaxInvoiceDocuments(invoice.id),
        ]);
        setSelected(detail);
        setDocuments(nextDocuments);
      } catch (error) {
        message.error(error instanceof Error ? error.message : "明细加载失败");
      } finally {
        setBusy(false);
      }
    },
    [message],
  );

  const periods = useMemo(
    () =>
      Array.from(
        new Set(invoices.map((invoice) => invoice.revenuePeriod).filter(Boolean)),
      ).sort().reverse() as string[],
    [invoices],
  );

  const filteredInvoices = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return invoices.filter((invoice) => {
      if (status !== "all" && invoice.status !== status) return false;
      if (period !== "all" && invoice.revenuePeriod !== period) return false;
      if (!normalized) return true;
      return [
        invoice.documentNo,
        invoice.ciNo,
        invoice.cdn,
        invoice.customerName,
      ].some((value) => value?.toLocaleLowerCase().includes(normalized));
    });
  }, [invoices, period, query, status]);

  const columns: ColumnsType<TaxInvoice> = [
    {
      title: "税票编号",
      dataIndex: "documentNo",
      width: 205,
      render: (value: string | null) => (
        <strong className="record-number">{value ?? "待分配"}</strong>
      ),
    },
    {
      title: "开票日期（报关提交日）",
      dataIndex: "invoiceDate",
      width: 180,
      render: dateLabel,
    },
    { title: "C/I No.", dataIndex: "ciNo", width: 145, ellipsis: true },
    { title: "报关单号", dataIndex: "cdn", width: 165, ellipsis: true },
    {
      title: "客户",
      dataIndex: "customerName",
      width: 260,
      ellipsis: true,
      render: (value: string) => <ThaiText>{value}</ThaiText>,
    },
    { title: "贸易条款", dataIndex: "incoterms", width: 95 },
    {
      title: "实际汇率日期",
      dataIndex: "exchangeRateDate",
      width: 130,
      render: dateLabel,
    },
    {
      title: "FOB THB",
      dataIndex: "fobRevenueThbTotal",
      width: 140,
      align: "right",
      render: (value: string | null) => money(value),
    },
    {
      title: "状态",
      dataIndex: "status",
      fixed: "right",
      width: 105,
      render: (value: TaxInvoiceStatus) => <StatusTag status={value} />,
    },
  ];

  const approveSelected = () => {
    if (!selected) return;
    const warnings = warningCount(selected);
    modal.confirm({
      title: "确认批准并分配正式编号？",
      content:
        warnings > 0
          ? `本记录存在 ${warnings} 项警示。确认已经人工核对后再批准。`
          : "正式编号会按照开票日期生成，批准后不可直接修改。",
      okText: warnings > 0 ? "已核对，继续批准" : "确认批准",
      cancelText: "取消",
      async onOk() {
        setBusy(true);
        try {
          const updated = await approveTaxInvoice(
            selected.id,
            selected.version,
            warnings > 0,
          );
          setSelected(updated);
          setInvoices((current) =>
            current.map((invoice) => (invoice.id === updated.id ? updated : invoice)),
          );
          message.success(`正式编号 ${updated.documentNo} 已生成`);
        } catch (error) {
          message.error(error instanceof Error ? error.message : "批准失败");
          throw error;
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const generateSelected = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const created = await generateTaxInvoiceDocuments(selected.id);
      setDocuments((current) => [...created, ...current]);
      const detail = await getTaxInvoice(selected.id);
      setSelected(detail);
      setInvoices((current) =>
        current.map((invoice) => (invoice.id === detail.id ? detail : invoice)),
      );
      message.success("TAX INV 正式文件已生成（Excel + PDF）");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "文件生成失败");
    } finally {
      setBusy(false);
    }
  };

  const runWorkflowAction = async () => {
    if (!selected || !workflowAction) return;
    if (workflowReason.trim().length < 2) {
      message.warning("请填写至少 2 个字符的原因");
      return;
    }
    setBusy(true);
    try {
      if (workflowAction === "void") {
        const updated = await voidTaxInvoice(
          selected.id,
          selected.version,
          workflowReason,
        );
        setSelected(updated);
        setInvoices((current) =>
          current.map((invoice) => (invoice.id === updated.id ? updated : invoice)),
        );
        message.success(`税票 ${updated.documentNo} 已作废，原编号永久保留`);
      } else {
        const correction = await createTaxInvoiceCorrection(
          selected.id,
          selected.version,
          workflowReason,
        );
        setInvoices((current) => [correction, ...current]);
        setSelected(correction);
        setDocuments([]);
        message.success("更正单已建立，复核后会分配新的正式编号");
      }
      setWorkflowAction(null);
      setWorkflowReason("");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "流程操作失败");
    } finally {
      setBusy(false);
    }
  };

  const openEdit = () => {
    if (!selected) return;
    editForm.setFieldsValue({
      invoiceDate: selected.invoiceDate,
      exchangeTargetDate: selected.exchangeTargetDate,
      exchangeRateDate: selected.exchangeRateDate,
      exchangeRate: selected.exchangeRate ? Number(selected.exchangeRate) : null,
      customerName: selected.customerName,
      customerAddress: selected.customerAddress,
      taxId: selected.taxId,
      poNo: selected.poNo,
      incoterms: selected.incoterms,
      paymentTerm: selected.paymentTerm,
      items: selected.items.map((item) => ({
        lineNumber: item.lineNumber,
        productName: item.productName,
        productCode: item.productCode,
        hsCode: item.hsCode,
        unit: item.unit,
        quantity: item.quantity ? Number(item.quantity) : null,
        ciUnitPrice: item.ciUnitPrice ? Number(item.ciUnitPrice) : null,
        fobUnitPriceUsd: item.fobUnitPriceUsd
          ? Number(item.fobUnitPriceUsd)
          : null,
        fobRevenueUsd: item.fobRevenueUsd ? Number(item.fobRevenueUsd) : null,
        fobRevenueThb: item.fobRevenueThb ? Number(item.fobRevenueThb) : null,
      })),
    });
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!selected) return;
    const values = await editForm.validateFields();
    setBusy(true);
    try {
      const items = (values.items as Record<string, unknown>[]).map(
        (item, index) => ({
          ...item,
          lineNumber: index + 1,
        }),
      );
      const updated = await updateTaxInvoice(selected.id, {
        ...values,
        version: selected.version,
        items,
      });
      setSelected(updated);
      setInvoices((current) =>
        current.map((invoice) => (invoice.id === updated.id ? updated : invoice)),
      );
      setEditOpen(false);
      message.success("税票复核资料已保存");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const runDualImport = async () => {
    if (!invoiceFile || !customsFile) {
      message.warning("请同时选择 Export Invoice Excel 与报关单 PDF");
      return;
    }
    setBusy(true);
    try {
      const result = await importDualFiles(invoiceFile, customsFile);
      message.success(
        `识别完成：${result.invoiceCount} 份税票，${result.itemCount} 条商品`,
      );
      setInvoiceFile(null);
      setCustomsFile(null);
      await refreshInvoices();
      setView("ledger");
      if (result.invoiceIds[0]) {
        const detail = await getTaxInvoice(result.invoiceIds[0]);
        await openInvoice(detail);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : "识别导入失败");
    } finally {
      setBusy(false);
    }
  };

  const runSampleImport = async () => {
    if (!sampleFile) {
      message.warning("请选择旧系统 Sample.xlsx");
      return;
    }
    setBusy(true);
    try {
      const result = await importSample(sampleFile);
      message.success(
        `历史导入完成：${result.invoiceCount} 份，其中 ${result.needsReviewCount} 份需复核`,
      );
      setSampleFile(null);
      await refreshInvoices();
      setView("ledger");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "历史导入失败");
    } finally {
      setBusy(false);
    }
  };

  const runRateImport = async () => {
    if (!rateFile) {
      message.warning("请选择 BOT 汇率 Excel");
      return;
    }
    setBusy(true);
    try {
      const result = await importExchangeRates(rateFile);
      message.success(`汇率已更新：新增 ${result.created}，覆盖 ${result.updated}`);
      setRateFile(null);
      await refreshRates();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "汇率导入失败");
    } finally {
      setBusy(false);
    }
  };

  const runBotFetch = async () => {
    if (!fetchDates.startDate || !fetchDates.endDate) {
      message.warning("请选择开始和结束日期");
      return;
    }
    setBusy(true);
    try {
      const result = await fetchExchangeRates(
        fetchDates.startDate,
        fetchDates.endDate,
      );
      message.success(`BOT 汇率同步完成：新增 ${result.created}，更新 ${result.updated}`);
      setFetchOpen(false);
      await refreshRates();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "BOT API 同步失败");
    } finally {
      setBusy(false);
    }
  };

  const uploadList = (file: File | null): UploadFile[] =>
    file ? [{ uid: file.name, name: file.name, status: "done" }] : [];

  return (
    <section className="tax-workspace" aria-label={t("nav.taxInvoice")}>
      <header className="workspace-header tax-workspace-header">
        <div>
          <span className="workspace-kicker">EXPORT SALES TAX INVOICE</span>
          <h1>
            <span>TAX INV</span>
            税票管理
          </h1>
          <p>识别报关资料、锁定开票日期、匹配 BOT 汇率并生成正式税票。</p>
        </div>
        <div className="tax-health-card">
          <span className="health-dot" />
          <div>
            <strong>业务规则已锁定</strong>
            <small>编号仅在批准时由数据库事务生成</small>
          </div>
        </div>
      </header>

      <nav className="workspace-subnav" aria-label="TAX INV 功能">
        <button
          className={view === "ledger" ? "is-active" : ""}
          type="button"
          onClick={() => setView("ledger")}
        >
          <DatabaseOutlined />税票台账
        </button>
        <button
          className={view === "recognition" ? "is-active" : ""}
          type="button"
          onClick={() => setView("recognition")}
        >
          <FileSearchOutlined />识别与导入
        </button>
        <button
          className={view === "rates" ? "is-active" : ""}
          type="button"
          onClick={() => setView("rates")}
        >
          <ApiOutlined />BOT 汇率中心
        </button>
      </nav>

      {view === "ledger" && (
        <div className={`tax-ledger-layout${selected ? " has-inspector" : ""}`}>
          <main className="tax-ledger-main">
            <div className="tax-filter-bar">
              <Select
                options={[
                  { value: "all", label: "全部期数" },
                  ...periods.map((value) => ({
                    value,
                    label: `${value.slice(0, 4)}-${value.slice(4)}`,
                  })),
                ]}
                value={period}
                onChange={setPeriod}
              />
              <Select
                options={[
                  { value: "all", label: "全部状态" },
                  ...Object.entries(statusLabels).map(([value, label]) => ({
                    value,
                    label,
                  })),
                ]}
                value={status}
                onChange={setStatus}
              />
              <Input.Search
                allowClear
                placeholder="搜索税票编号、C/I、CDN 或客户"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <Button
                icon={<ReloadOutlined />}
                loading={loading}
                onClick={() => void refreshInvoices()}
              >
                刷新
              </Button>
            </div>
            <div className="tax-ledger-summary">
              <div>
                <strong>{filteredInvoices.length}</strong>
                <span>份税票</span>
              </div>
              <div>
                <strong>
                  {filteredInvoices.filter((item) => item.status === "needs_review").length}
                </strong>
                <span>待人工复核</span>
              </div>
              <div>
                <strong>
                  {filteredInvoices.filter((item) => item.status === "issued").length}
                </strong>
                <span>已生成正式文件</span>
              </div>
            </div>
            <Table
              columns={columns}
              dataSource={filteredInvoices}
              loading={loading}
              pagination={{ pageSize: 15, showSizeChanger: false }}
              rowClassName={(record) =>
                record.id === selected?.id ? "selected-table-row" : ""
              }
              rowKey="id"
              scroll={{ x: 1450, y: "calc(100vh - 395px)" }}
              size="middle"
              onRow={(record) => ({
                onClick: () => void openInvoice(record),
              })}
            />
          </main>
          {selected && (
            <InvoiceInspector
              busy={busy}
              documents={documents}
              invoice={selected}
              onApprove={approveSelected}
              onClose={() => setSelected(null)}
              onDownload={(document) => void downloadTaxInvoiceDocument(document)}
              onEdit={openEdit}
              onGenerate={() => void generateSelected()}
              onCorrection={() => {
                setWorkflowReason("");
                setWorkflowAction("correction");
              }}
              onVoid={() => {
                setWorkflowReason("");
                setWorkflowAction("void");
              }}
            />
          )}
        </div>
      )}

      {view === "recognition" && (
        <main className="tax-tool-page">
          <section className="tax-rule-banner">
            <div className="rule-badge">
              <SafetyCertificateOutlined />
            </div>
            <div>
              <span>DATE GOVERNANCE</span>
              <h2>日期字段独立保存，不再互相覆盖</h2>
              <p>
                开票日期取报关单提交日期；税票编号跟随开票日期；汇率目标日和实际回溯日按
                BOT 原逻辑分别保留。
              </p>
            </div>
            <div className="rule-flow">
              <span>报关提交日</span>
              <b>→</b>
              <span>开票日期</span>
              <b>→</b>
              <span>税票编号日期</span>
            </div>
          </section>

          <div className="tax-import-grid">
            <section className="tax-tool-card tax-dual-card">
              <div className="tool-card-heading">
                <div className="tool-card-icon copper">
                  <FileSearchOutlined />
                </div>
                <div>
                  <span>新开税票</span>
                  <h2>双文件智能识别</h2>
                  <p>Export Invoice Excel + 泰国报关单 PDF</p>
                </div>
              </div>
              <div className="dual-upload-grid">
                <Upload.Dragger
                  accept=".xlsx,.xls"
                  beforeUpload={(file) => {
                    setInvoiceFile(file);
                    return false;
                  }}
                  fileList={uploadList(invoiceFile)}
                  maxCount={1}
                  onRemove={() => {
                    setInvoiceFile(null);
                  }}
                >
                  <p className="ant-upload-drag-icon"><FileExcelOutlined /></p>
                  <p className="ant-upload-text">Export Invoice Excel</p>
                  <p className="ant-upload-hint">识别客户、贸易条款与商品</p>
                </Upload.Dragger>
                <Upload.Dragger
                  accept=".pdf"
                  beforeUpload={(file) => {
                    setCustomsFile(file);
                    return false;
                  }}
                  fileList={uploadList(customsFile)}
                  maxCount={1}
                  onRemove={() => {
                    setCustomsFile(null);
                  }}
                >
                  <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                  <p className="ant-upload-text">Customs Declaration PDF</p>
                  <p className="ant-upload-hint">提取 CDN 与报关提交日期</p>
                </Upload.Dragger>
              </div>
              <Button
                block
                icon={<FileSearchOutlined />}
                loading={busy}
                size="large"
                type="primary"
                onClick={() => void runDualImport()}
              >
                开始识别并建立复核记录
              </Button>
            </section>

            <section className="tax-tool-card">
              <div className="tool-card-heading">
                <div className="tool-card-icon ink">
                  <DatabaseOutlined />
                </div>
                <div>
                  <span>历史迁移</span>
                  <h2>导入旧系统 Sample</h2>
                  <p>用于导入上线前的 TAX INV 台账</p>
                </div>
              </div>
              <Alert
                message="历史文件缺少报关提交日时不会自动正式开票"
                description="系统会临时沿用旧 FX Date 并标为低置信度，必须人工补录或核对。"
                showIcon
                type="warning"
              />
              <Upload
                accept=".xlsx,.xls"
                beforeUpload={(file) => {
                  setSampleFile(file);
                  return false;
                }}
                fileList={uploadList(sampleFile)}
                maxCount={1}
                onRemove={() => {
                  setSampleFile(null);
                }}
              >
                <Button icon={<UploadOutlined />} size="large">
                  选择 Sample.xlsx
                </Button>
              </Upload>
              <Button
                disabled={!sampleFile}
                loading={busy}
                size="large"
                onClick={() => void runSampleImport()}
              >
                导入历史台账
              </Button>
            </section>
          </div>

          <section className="tax-quality-strip">
            <div><CheckCircleOutlined /><span><strong>最多 18 条商品</strong>超过模板容量时禁止批准</span></div>
            <div><WarningOutlined /><span><strong>FOB 自动验算</strong>差异记录进入人工复核</span></div>
            <div><CloudDownloadOutlined /><span><strong>源文件留档</strong>随每日附件备份保留</span></div>
          </section>
        </main>
      )}

      {view === "rates" && (
        <main className="tax-tool-page">
          <div className="rate-stat-grid">
            <section>
              <Statistic title="USD 汇率记录" value={rates.length} suffix="天" />
              <Progress
                percent={Math.min(100, Math.round((rates.length / 366) * 100))}
                showInfo={false}
                strokeColor="#a87349"
              />
              <small>列表最多显示最近 500 条</small>
            </section>
            <section>
              <Statistic
                precision={4}
                title="最近 Buying Transfer"
                value={Number(rates[0]?.buyingTransfer ?? 0)}
              />
              <small>{rates[0]?.rateDate ?? "尚未导入"} · {rates[0]?.source ?? "—"}</small>
            </section>
            <section className="rate-actions-card">
              <Button icon={<ApiOutlined />} type="primary" onClick={() => setFetchOpen(true)}>
                从 BOT API 同步
              </Button>
              <Upload
                accept=".xlsx,.xls"
                beforeUpload={(file) => {
                  setRateFile(file);
                  return false;
                }}
                fileList={uploadList(rateFile)}
                maxCount={1}
                onRemove={() => {
                  setRateFile(null);
                }}
              >
                <Button icon={<FileExcelOutlined />}>选择 BOT Excel</Button>
              </Upload>
              <Button disabled={!rateFile} loading={busy} onClick={() => void runRateImport()}>
                导入所选文件
              </Button>
            </section>
          </div>
          <section className="rate-ledger-card">
            <div className="section-title-row">
              <div>
                <span className="workspace-kicker">EXCHANGE RATE LEDGER</span>
                <h2>汇率台账</h2>
              </div>
              <Button icon={<ReloadOutlined />} onClick={() => void refreshRates()}>
                刷新
              </Button>
            </div>
            {rates.length ? (
              <Table
                columns={[
                  { title: "币种", dataIndex: "currency", width: 100 },
                  { title: "汇率日期", dataIndex: "rateDate", width: 150 },
                  {
                    title: "Buying Transfer",
                    dataIndex: "buyingTransfer",
                    width: 180,
                    align: "right",
                    render: (value: string) => Number(value).toFixed(4),
                  },
                  {
                    title: "来源",
                    dataIndex: "source",
                    width: 150,
                    render: (value: string) => (
                      <Tag>{value === "bot_api" ? "BOT API" : "BOT Excel"}</Tag>
                    ),
                  },
                  { title: "源文件", dataIndex: "sourceFileName", ellipsis: true },
                  {
                    title: "更新时间",
                    dataIndex: "updatedAt",
                    width: 190,
                    render: dateTime,
                  },
                ]}
                dataSource={rates}
                pagination={{ pageSize: 15, showSizeChanger: false }}
                rowKey={(record) => `${record.currency}-${record.rateDate}`}
              />
            ) : (
              <Empty description="尚未导入 BOT 汇率" />
            )}
          </section>
        </main>
      )}

      <Modal
        cancelText="取消"
        confirmLoading={busy}
        okText="开始同步"
        open={fetchOpen}
        title="从泰国央行 BOT API 同步汇率"
        onCancel={() => setFetchOpen(false)}
        onOk={() => void runBotFetch()}
      >
        <p className="modal-intro">
          API 凭证只从服务器环境变量读取，不会显示或保存在浏览器。
        </p>
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <label className="date-field">
            <span>开始日期</span>
            <Input
              type="date"
              value={fetchDates.startDate}
              onChange={(event) =>
                setFetchDates((current) => ({
                  ...current,
                  startDate: event.target.value,
                }))
              }
            />
          </label>
          <label className="date-field">
            <span>结束日期</span>
            <Input
              type="date"
              value={fetchDates.endDate}
              onChange={(event) =>
                setFetchDates((current) => ({
                  ...current,
                  endDate: event.target.value,
                }))
              }
            />
          </label>
        </Space>
      </Modal>

      <Modal
        cancelText="取消"
        className="tax-edit-modal"
        confirmLoading={busy}
        okText="保存复核资料"
        open={editOpen}
        title="编辑 TAX INV 复核资料"
        width={1040}
        onCancel={() => setEditOpen(false)}
        onOk={() => void saveEdit()}
      >
        <Alert
          message="开票日期必须填写报关单提交日期；汇率目标日和实际命中日请分别维护。"
          showIcon
          type="info"
        />
        <Form form={editForm} layout="vertical">
          <div className="tax-edit-grid">
            <Form.Item
              label="开票日期（报关提交日）"
              name="invoiceDate"
              rules={[{ required: true, message: "请选择开票日期" }]}
            >
              <Input type="date" />
            </Form.Item>
            <Form.Item
              label="汇率目标日期"
              name="exchangeTargetDate"
              rules={[{ required: true, message: "请选择汇率目标日期" }]}
            >
              <Input type="date" />
            </Form.Item>
            <Form.Item label="实际汇率日期" name="exchangeRateDate">
              <Input type="date" />
            </Form.Item>
            <Form.Item
              label="BOT Buying Transfer"
              name="exchangeRate"
              rules={[{ required: true, message: "请输入汇率" }]}
            >
              <InputNumber min={0.000001} precision={6} />
            </Form.Item>
            <Form.Item
              label="客户名称"
              name="customerName"
              rules={[{ required: true, message: "请输入客户名称" }]}
            >
              <Input className="thai-input" />
            </Form.Item>
            <Form.Item
              className="tax-edit-address"
              label="客户地址"
              name="customerAddress"
              rules={[{ required: true, message: "请输入客户地址" }]}
            >
              <Input className="thai-input" />
            </Form.Item>
            <Form.Item label="税号" name="taxId"><Input /></Form.Item>
            <Form.Item label="PO No." name="poNo"><Input /></Form.Item>
            <Form.Item label="贸易条款" name="incoterms"><Input /></Form.Item>
            <Form.Item label="付款条件" name="paymentTerm"><Input /></Form.Item>
          </div>
          <Divider titlePlacement="left">商品明细（最多 18 行）</Divider>
          <Form.List
            name="items"
            rules={[
              {
                async validator(_, items) {
                  if (!items?.length) throw new Error("至少保留一条商品");
                  if (items.length > 18) throw new Error("正式模板最多 18 条商品");
                },
              },
            ]}
          >
            {(fields, { add, remove }, { errors }) => (
              <>
                <div className="tax-item-editor">
                  <div className="tax-item-editor-head">
                    <span>#</span><span>商品名称</span><span>商品代码</span>
                    <span>单位</span><span>数量</span><span>FOB 单价</span>
                    <span>FOB USD</span><span>FOB THB</span><span />
                  </div>
                  {fields.map((field, index) => (
                    <div className="tax-item-editor-row" key={field.key}>
                      <span>{index + 1}</span>
                      <Form.Item name={[field.name, "productName"]}>
                        <Input />
                      </Form.Item>
                      <Form.Item name={[field.name, "productCode"]}>
                        <Input />
                      </Form.Item>
                      <Form.Item name={[field.name, "unit"]}>
                        <Input />
                      </Form.Item>
                      <Form.Item name={[field.name, "quantity"]}>
                        <InputNumber min={0} precision={4} />
                      </Form.Item>
                      <Form.Item name={[field.name, "fobUnitPriceUsd"]}>
                        <InputNumber min={0} precision={4} />
                      </Form.Item>
                      <Form.Item name={[field.name, "fobRevenueUsd"]}>
                        <InputNumber min={0} precision={2} />
                      </Form.Item>
                      <Form.Item name={[field.name, "fobRevenueThb"]}>
                        <InputNumber min={0} precision={2} />
                      </Form.Item>
                      <Button
                        danger
                        disabled={fields.length === 1}
                        icon={<DeleteOutlined />}
                        type="text"
                        onClick={() => remove(field.name)}
                      />
                    </div>
                  ))}
                </div>
                <Form.ErrorList errors={errors} />
                <Button
                  disabled={fields.length >= 18}
                  icon={<PlusOutlined />}
                  type="dashed"
                  onClick={() => add({ lineNumber: fields.length + 1 })}
                >
                  添加商品行
                </Button>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>

      <Modal
        cancelText="取消"
        confirmLoading={busy}
        okButtonProps={{ danger: workflowAction === "void" }}
        okText={workflowAction === "void" ? "确认作废" : "建立更正单"}
        open={workflowAction !== null}
        title={workflowAction === "void" ? "作废正式税票" : "从已作废税票建立更正单"}
        onCancel={() => setWorkflowAction(null)}
        onOk={() => void runWorkflowAction()}
      >
        <Alert
          message={
            workflowAction === "void"
              ? "作废后原正式编号永久保留，不会回收或重复使用。"
              : "更正单会复制原商品和客户资料，但必须重新复核，并分配新的正式编号。"
          }
          showIcon
          type={workflowAction === "void" ? "warning" : "info"}
        />
        <label className="workflow-reason-field">
          <span>{workflowAction === "void" ? "作废原因" : "更正原因"}</span>
          <Input.TextArea
            maxLength={1000}
            placeholder="请输入可供审计追溯的原因"
            rows={4}
            value={workflowReason}
            onChange={(event) => setWorkflowReason(event.target.value)}
          />
        </label>
      </Modal>
    </section>
  );
}
