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
  Tooltip,
  Upload,
} from "antd";
import type { UploadFile } from "antd";
import type { ColumnsType } from "antd/es/table";

import type { Locale, Translate } from "../../i18n";
import { FinanceLifecycleTabs, type FinanceLifecyclePhase } from "../../ui";
import { ThaiText } from "../../shared/ThaiText";
// 签名图库是两个模块共用的，接口挂在 WHT 路由下。
import { listSignatures } from "../wht/api";
import {
  approveTaxInvoice,
  createTaxInvoiceCorrection,
  downloadTaxInvoiceDocument,
  fetchExchangeRates,
  generateTaxInvoiceDocuments,
  getBotApiStatus,
  getTaxInvoice,
  importDualFiles,
  importExchangeRates,
  importSample,
  listExchangeRates,
  listRateCurrencies,
  listTaxInvoiceDocuments,
  listTaxInvoices,
  updateTaxInvoice,
  voidTaxInvoice,
} from "./api";
import type {
  BotApiStatus,
  ExchangeRate,
  TaxInvoice,
  TaxInvoiceDocument,
  TaxInvoiceItem,
  TaxInvoiceStatus,
} from "./types";

type WorkspaceView = "ledger" | "recognition" | "rates";

const statusClasses: Record<TaxInvoiceStatus, string> = {
  draft: "status-draft",
  needs_review: "status-pending",
  ready: "status-ready",
  approved: "status-approved",
  issued: "status-issued",
  voided: "status-voided",
};

/** BOT DAILY_AVG_EXG_RATE 覆盖的主要币种。台账没数据的会标注「无数据」。 */
const CURRENCY_CHOICES = [
  "USD",
  "EUR",
  "JPY",
  "GBP",
  "CNY",
  "HKD",
  "SGD",
  "AUD",
  "CHF",
  "MYR",
  "KRW",
  "TWD",
  "VND",
  "INR",
];

/** 非交易日或 Excel 导入的行拿不到这几种报价，显示为 — 而不是 0.0000。 */
function rateCell(value: string | null): string {
  return value ? Number(value).toFixed(4) : "—";
}

/** 业务阶段 → 内部状态，与 WHT 侧同一套语义。 */
const taxInvoicePhaseStatuses: Record<
  Exclude<FinanceLifecyclePhase, "all">,
  readonly TaxInvoiceStatus[]
> = {
  pending: ["draft", "needs_review", "ready"],
  issuing: ["approved"],
  history: ["issued", "voided"],
};

function isInvoiceInPhase(
  invoice: TaxInvoice,
  phase: FinanceLifecyclePhase,
): boolean {
  return phase === "all" || taxInvoicePhaseStatuses[phase].includes(invoice.status);
}

const STATUS_ORDER: TaxInvoiceStatus[] = [
  "draft",
  "needs_review",
  "ready",
  "approved",
  "issued",
  "voided",
];

function statusLabel(status: TaxInvoiceStatus, t: Translate): string {
  return t(`taxStatus.${status}` as Parameters<Translate>[0]);
}

function StatusTag({ status, t }: { status: TaxInvoiceStatus; t: Translate }) {
  return (
    <Tag className={`status-tag ${statusClasses[status]}`}>{statusLabel(status, t)}</Tag>
  );
}

function money(value: string | null | undefined, locale: Locale, currency = ""): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric);
  return currency ? `${currency} ${formatted}` : formatted;
}

function dateTime(value: string | null, locale: Locale): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
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
  locale,
  t,
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
  locale: Locale;
  t: Translate;
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
    <aside className="tax-inspector" aria-label={t("tax.inspectorLabel")}>
      <div className="inspector-header">
        <div>
          <span className="record-eyebrow">{t("tax.recordEyebrow")}</span>
          <h2>{invoice.documentNo ?? t("tax.pendingFormalNumber")}</h2>
          <StatusTag status={invoice.status} t={t} />
        </div>
        <Space>
          {["draft", "needs_review", "ready"].includes(invoice.status) && (
            <Button icon={<EditOutlined />} size="small" onClick={onEdit}>
              {t("common.edit")}
            </Button>
          )}
          <Button
            aria-label={t("tax.closeInspector")}
            icon={<CloseOutlined />}
            type="text"
            onClick={onClose}
          />
        </Space>
      </div>

      {warnings > 0 && (
        <Alert
          className="tax-review-alert"
          message={t("tax.warningCount", { count: warnings })}
          description={t("tax.warningBody")}
          showIcon
          type="warning"
        />
      )}

      <section className="inspector-section">
        <h3>{t("tax.dateSection")}</h3>
        <Descriptions className="task-descriptions" column={1} colon={false}>
          <Descriptions.Item label={t("tax.formalNumber")}>
            {invoice.documentNo ?? t("tax.numberOnApproval")}
          </Descriptions.Item>
          <Descriptions.Item label={t("tax.invoiceDate")}>
            <strong>{dateLabel(invoice.invoiceDate)}</strong>
          </Descriptions.Item>
          <Descriptions.Item label={t("tax.exchangeTargetDate")}>
            {dateLabel(invoice.exchangeTargetDate)}
          </Descriptions.Item>
          <Descriptions.Item label={t("tax.exchangeRateDate")}>
            {dateLabel(invoice.exchangeRateDate)}
          </Descriptions.Item>
          <Descriptions.Item label={t("tax.botRate")}>
            {invoice.exchangeRate
              ? `${invoice.currency} / THB ${Number(invoice.exchangeRate).toFixed(4)}`
              : t("tax.rateUnmatched")}
          </Descriptions.Item>
        </Descriptions>
      </section>

      <section className="inspector-section">
        <h3>{t("tax.customerSection")}</h3>
        <Descriptions className="task-descriptions" column={1} colon={false}>
          <Descriptions.Item label="C/I No.">{invoice.ciNo}</Descriptions.Item>
          <Descriptions.Item label={t("tax.colCdn")}>
            {invoice.cdn ?? "—"}
          </Descriptions.Item>
          <Descriptions.Item label={t("tax.customerName")}>
            <ThaiText>{invoice.customerName}</ThaiText>
          </Descriptions.Item>
          <Descriptions.Item label={t("tax.customerAddress")}>
            <ThaiText>{invoice.customerAddress}</ThaiText>
          </Descriptions.Item>
          <Descriptions.Item label={t("tax.taxId")}>
            {invoice.taxId ?? "—"}
          </Descriptions.Item>
          <Descriptions.Item label="PO No.">{invoice.poNo ?? "—"}</Descriptions.Item>
          <Descriptions.Item label={t("tax.incoterms")}>
            {invoice.incoterms ?? "—"}
            {invoice.isDap && <Tag color="orange">{t("tax.dapNeedsReview")}</Tag>}
          </Descriptions.Item>
        </Descriptions>
      </section>

      <section className="inspector-section">
        <div className="section-title-row">
          <h3>{t("tax.itemsSection")}</h3>
          <span>{t("tax.itemsCount", { count: invoice.items.length })}</span>
        </div>
        <Table<TaxInvoiceItem>
          columns={[
            { title: t("tax.colLine"), dataIndex: "lineNumber", width: 58 },
            {
              title: t("tax.colProduct"),
              dataIndex: "productName",
              ellipsis: true,
            },
            {
              title: t("tax.colQuantity"),
              dataIndex: "quantity",
              width: 76,
              align: "right",
            },
            {
              title: "FOB USD",
              dataIndex: "fobRevenueUsd",
              width: 105,
              align: "right",
              render: (value: string | null) => money(value, locale),
            },
          ]}
          dataSource={invoice.items}
          pagination={false}
          rowKey="id"
          scroll={{ y: 230 }}
          size="small"
        />
        <div className="tax-total-strip">
          <span>{t("tax.total")}</span>
          <strong>{money(invoice.fobRevenueUsdTotal, locale, "USD")}</strong>
          <strong>{money(invoice.fobRevenueThbTotal, locale, "THB")}</strong>
        </div>
      </section>

      <section className="inspector-section">
        <div className="section-title-row">
          <h3>{t("tax.documentsSection")}</h3>
          <Button
            disabled={!canGenerate}
            icon={<FileDoneOutlined />}
            loading={busy}
            size="small"
            onClick={onGenerate}
          >
            {t("tax.generate")}
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
                  <small>
                    v{document.version} · {dateTime(document.createdAt, locale)}
                  </small>
                </span>
                <DownloadOutlined />
              </button>
            ))}
          </div>
        ) : (
          <p className="muted-copy">{t("tax.generateHint")}</p>
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
            {t("tax.approve")}
          </Button>
        )}
        {["approved", "issued"].includes(invoice.status) && (
          <Button block danger disabled={busy} onClick={onVoid}>
            {t("tax.void")}
          </Button>
        )}
        {invoice.status === "voided" && (
          <Button block icon={<FileSearchOutlined />} onClick={onCorrection}>
            {t("tax.createCorrection")}
          </Button>
        )}
      </div>
    </aside>
  );
}

export function TaxInvoiceWorkspace({ t, locale }: { t: Translate; locale: Locale }) {
  const { message, modal } = AntApp.useApp();
  const [view, setView] = useState<WorkspaceView>("ledger");
  const [invoices, setInvoices] = useState<TaxInvoice[]>([]);
  const [rates, setRates] = useState<ExchangeRate[]>([]);
  // 汇率中心可以看任何币种；出口税票取哪个汇率是另一回事，业务规则仍是
  // USD 的 buying transfer，不受这里的浏览选择影响。
  const [currency, setCurrency] = useState("USD");
  const [currencies, setCurrencies] = useState<string[]>([]);
  // 汇率中心拆成两件事：查台账（只读）和把汇率灌进库（写）。混在一张卡片里，
  // 想查个汇率的人要盯着"同步/导入"两个写操作按钮，误点代价还不小。
  const [rateTab, setRateTab] = useState<"query" | "ingest">("query");
  const [rateRange, setRateRange] = useState({ startDate: "", endDate: "" });
  const [botStatus, setBotStatus] = useState<BotApiStatus | null>(null);
  const [selected, setSelected] = useState<TaxInvoice | null>(null);
  const [documents, setDocuments] = useState<TaxInvoiceDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<TaxInvoiceStatus | "all">("all");
  const [period, setPeriod] = useState("all");
  const [phase, setPhase] = useState<FinanceLifecyclePhase>("pending");
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
      message.error(error instanceof Error ? error.message : t("tax.ledgerLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [message, t]);

  const refreshRates = useCallback(
    async (nextCurrency = currency) => {
      try {
        setRates(
          await listExchangeRates(
            nextCurrency,
            rateRange.startDate || undefined,
            rateRange.endDate || undefined,
          ),
        );
      } catch (error) {
        message.error(error instanceof Error ? error.message : t("tax.rateLoadFailed"));
      }
    },
    [currency, message, rateRange.endDate, rateRange.startDate, t],
  );

  useEffect(() => {
    void refreshInvoices();
    // 配置自检和币种列表失败都不该打断页面：拿不到就退化，不弹错。
    void getBotApiStatus()
      .then(setBotStatus)
      .catch(() => setBotStatus(null));
    void listRateCurrencies()
      .then((items) => setCurrencies(items.length ? items : ["USD"]))
      .catch(() => setCurrencies(["USD"]));
  }, [refreshInvoices]);

  useEffect(() => {
    void refreshRates(currency);
  }, [currency, refreshRates]);

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
        message.error(error instanceof Error ? error.message : t("tax.detailLoadFailed"));
      } finally {
        setBusy(false);
      }
    },
    [message, t],
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
      if (!isInvoiceInPhase(invoice, phase)) return false;
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
  }, [invoices, period, phase, query, status]);

  const lifecycleCounts = useMemo(
    () => ({
      pending: invoices.filter((item) => isInvoiceInPhase(item, "pending")).length,
      issuing: invoices.filter((item) => isInvoiceInPhase(item, "issuing")).length,
      history: invoices.filter((item) => isInvoiceInPhase(item, "history")).length,
      all: invoices.length,
    }),
    [invoices],
  );

  const columns: ColumnsType<TaxInvoice> = [
    {
      title: t("tax.colDocumentNo"),
      dataIndex: "documentNo",
      width: 205,
      render: (value: string | null) => (
        <strong className="record-number">{value ?? t("tax.pendingNumber")}</strong>
      ),
    },
    {
      title: t("tax.colInvoiceDate"),
      dataIndex: "invoiceDate",
      width: 180,
      render: dateLabel,
    },
    { title: "C/I No.", dataIndex: "ciNo", width: 145, ellipsis: true },
    { title: t("tax.colCdn"), dataIndex: "cdn", width: 165, ellipsis: true },
    {
      title: t("tax.colCustomer"),
      dataIndex: "customerName",
      width: 260,
      ellipsis: true,
      render: (value: string) => <ThaiText>{value}</ThaiText>,
    },
    { title: t("tax.colIncoterms"), dataIndex: "incoterms", width: 95 },
    {
      title: t("tax.colRateDate"),
      dataIndex: "exchangeRateDate",
      width: 130,
      render: dateLabel,
    },
    {
      title: "FOB THB",
      dataIndex: "fobRevenueThbTotal",
      width: 140,
      align: "right",
      render: (value: string | null) => money(value, locale),
    },
    {
      title: t("tax.colStatus"),
      dataIndex: "status",
      fixed: "right",
      width: 105,
      render: (value: TaxInvoiceStatus) => <StatusTag status={value} t={t} />,
    },
  ];

  const approveSelected = () => {
    if (!selected) return;
    const warnings = warningCount(selected);
    modal.confirm({
      title: t("tax.approveTitle"),
      content:
        warnings > 0
          ? t("tax.approveWithWarnings", { count: warnings })
          : t("tax.approveClean"),
      okText: warnings > 0 ? t("tax.approveOkWarned") : t("tax.approveOk"),
      cancelText: t("common.cancel"),
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
          message.success(
            t("tax.numberAssigned", { number: updated.documentNo ?? "" }),
          );
        } catch (error) {
          message.error(error instanceof Error ? error.message : t("tax.approveFailed"));
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
      // 取适用于 TAX INV 的默认签名（usage 为 tax_inv 或 both）。
      // 一张都没有就出不带签名的文件，而不是报错挡住出票。
      const signatures = await listSignatures(false, "tax_inv").catch(() => []);
      const signature = signatures.find((item) => item.isDefault) ?? signatures[0];
      const created = await generateTaxInvoiceDocuments(
        selected.id,
        signature?.id ?? null,
      );
      setDocuments((current) => [...created, ...current]);
      const detail = await getTaxInvoice(selected.id);
      setSelected(detail);
      setInvoices((current) =>
        current.map((invoice) => (invoice.id === detail.id ? detail : invoice)),
      );
      message.success(t("tax.documentsGenerated"));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("tax.generateFailed"));
    } finally {
      setBusy(false);
    }
  };

  const runWorkflowAction = async () => {
    if (!selected || !workflowAction) return;
    if (workflowReason.trim().length < 2) {
      message.warning(t("tax.reasonTooShort"));
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
        message.success(t("tax.voided", { number: updated.documentNo ?? "" }));
      } else {
        const correction = await createTaxInvoiceCorrection(
          selected.id,
          selected.version,
          workflowReason,
        );
        setInvoices((current) => [correction, ...current]);
        setSelected(correction);
        setDocuments([]);
        message.success(t("tax.correctionCreated"));
      }
      setWorkflowAction(null);
      setWorkflowReason("");
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("tax.workflowFailed"));
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
      message.success(t("tax.editSaved"));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("tax.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const runDualImport = async () => {
    if (!invoiceFile || !customsFile) {
      message.warning(t("tax.dualFilesRequired"));
      return;
    }
    setBusy(true);
    try {
      const result = await importDualFiles(invoiceFile, customsFile);
      message.success(
        t("tax.recognitionDone", {
          invoices: result.invoiceCount,
          items: result.itemCount,
        }),
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
      message.error(error instanceof Error ? error.message : t("tax.recognitionFailed"));
    } finally {
      setBusy(false);
    }
  };

  const runSampleImport = async () => {
    if (!sampleFile) {
      message.warning(t("tax.sampleRequired"));
      return;
    }
    setBusy(true);
    try {
      const result = await importSample(sampleFile);
      message.success(
        t("tax.sampleDone", {
          invoices: result.invoiceCount,
          review: result.needsReviewCount,
        }),
      );
      setSampleFile(null);
      await refreshInvoices();
      setView("ledger");
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("tax.sampleFailed"));
    } finally {
      setBusy(false);
    }
  };

  const runRateImport = async () => {
    if (!rateFile) {
      message.warning(t("tax.rateFileRequired"));
      return;
    }
    setBusy(true);
    try {
      const result = await importExchangeRates(rateFile, currency);
      message.success(
        t("tax.rateImported", { created: result.created, updated: result.updated }),
      );
      setRateFile(null);
      await refreshRates();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("tax.rateImportFailed"));
    } finally {
      setBusy(false);
    }
  };

  const runBotFetch = async () => {
    if (!fetchDates.startDate || !fetchDates.endDate) {
      message.warning(t("tax.datesRequired"));
      return;
    }
    setBusy(true);
    try {
      const result = await fetchExchangeRates(
        fetchDates.startDate,
        fetchDates.endDate,
        currency,
      );
      message.success(
        t("tax.botSynced", { created: result.created, updated: result.updated }),
      );
      setFetchOpen(false);
      if (!currencies.includes(currency)) {
        setCurrencies((current) => [...current, currency].sort());
      }
      await refreshRates();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("tax.botFailed"));
    } finally {
      setBusy(false);
    }
  };

  const uploadList = (file: File | null): UploadFile[] =>
    file ? [{ uid: file.name, name: file.name, status: "done" }] : [];

  const botUnconfigured = botStatus !== null && !botStatus.configured;

  return (
    <section className="tax-workspace" aria-label={t("nav.taxInvoice")}>
      <header className="workspace-header tax-workspace-header">
        <div>
          <span className="workspace-kicker">{t("tax.kicker")}</span>
          <h1>
            <span>TAX INV</span>
            {t("tax.title")}
          </h1>
          <p>{t("tax.subtitle")}</p>
        </div>
        {/* 常驻规则说明压成一枚小胶囊：它是背景信息，不该和页面标题抢注意力。 */}
        <Tooltip title={t("tax.rulesLocked")}>
          <span className="tax-health-pill">
            <span className="health-dot" />
            {t("tax.rulesLocked")}
          </span>
        </Tooltip>
      </header>

      <nav className="workspace-subnav" aria-label={t("tax.navLabel")}>
        <button
          className={view === "ledger" ? "is-active" : ""}
          type="button"
          onClick={() => setView("ledger")}
        >
          <DatabaseOutlined />
          {t("tax.ledger")}
        </button>
        <button
          className={view === "recognition" ? "is-active" : ""}
          type="button"
          onClick={() => setView("recognition")}
        >
          <FileSearchOutlined />
          {t("tax.recognition")}
        </button>
        <button
          className={view === "rates" ? "is-active" : ""}
          type="button"
          onClick={() => setView("rates")}
        >
          <ApiOutlined />
          {t("tax.rates")}
        </button>
      </nav>

      {view === "ledger" && (
        <div className={`tax-ledger-layout${selected ? " has-inspector" : ""}`}>
          <main className="tax-ledger-main">
            <FinanceLifecycleTabs
              activeKey={phase}
              ariaLabel={t("lifecycle.aria", { module: "TAX INV" })}
              counts={lifecycleCounts}
              labels={{
                pending: t("lifecycle.pending"),
                issuing: t("lifecycle.issuing"),
                history: t("lifecycle.history"),
                all: t("lifecycle.all"),
              }}
              onChange={(nextPhase) => {
                setPhase(nextPhase);
                setStatus("all");
                setSelected(null);
              }}
            />
            <div className="tax-filter-bar">
              <Select
                options={[
                  { value: "all", label: t("tax.allPeriods") },
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
                  { value: "all", label: t("tax.allStatuses") },
                  ...STATUS_ORDER.map((value) => ({
                    value,
                    label: statusLabel(value, t),
                  })),
                ]}
                value={status}
                onChange={setStatus}
              />
              <Input.Search
                allowClear
                placeholder={t("tax.searchPlaceholder")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <Button
                icon={<ReloadOutlined />}
                loading={loading}
                onClick={() => void refreshInvoices()}
              >
                {t("common.refresh")}
              </Button>
            </div>
            <div className="tax-ledger-summary">
              <div>
                <strong>{filteredInvoices.length}</strong>
                <span>{t("tax.countInvoices")}</span>
              </div>
              <div>
                <strong>
                  {filteredInvoices.filter((item) => item.status === "needs_review").length}
                </strong>
                <span>{t("tax.countNeedsReview")}</span>
              </div>
              <div>
                <strong>
                  {filteredInvoices.filter((item) => item.status === "issued").length}
                </strong>
                <span>{t("tax.countIssued")}</span>
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
              locale={locale}
              t={t}
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
          {/* 原来是一整块深色横幅，占掉首屏近三分之一。规则本身没变，
              但它是一次性知识，压成一行提示条即可。 */}
          <p className="tax-rule-note">
            <SafetyCertificateOutlined />
            <span>{t("tax.dateGovernance")}</span>
          </p>

          <div className="tax-import-grid">
            <section className="tax-tool-card tax-dual-card">
              <div className="tool-card-heading">
                <div className="tool-card-icon copper">
                  <FileSearchOutlined />
                </div>
                <div>
                  <span>{t("tax.newInvoice")}</span>
                  <h2>{t("tax.dualRecognition")}</h2>
                  <p>{t("tax.dualRecognitionHint")}</p>
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
                  <p className="ant-upload-text">{t("tax.invoiceExcel")}</p>
                  <p className="ant-upload-hint">{t("tax.invoiceExcelHint")}</p>
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
                  <p className="ant-upload-text">{t("tax.customsPdf")}</p>
                  <p className="ant-upload-hint">{t("tax.customsPdfHint")}</p>
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
                {t("tax.startRecognition")}
              </Button>
            </section>

            <section className="tax-tool-card">
              <div className="tool-card-heading">
                <div className="tool-card-icon ink">
                  <DatabaseOutlined />
                </div>
                <div>
                  <span>{t("tax.migration")}</span>
                  <h2>{t("tax.importSample")}</h2>
                  <p>{t("tax.importSampleHint")}</p>
                </div>
              </div>
              <Alert
                message={t("tax.sampleWarning")}
                description={t("tax.sampleWarningBody")}
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
                  {t("tax.pickSample")}
                </Button>
              </Upload>
              <Button
                disabled={!sampleFile}
                loading={busy}
                size="large"
                onClick={() => void runSampleImport()}
              >
                {t("tax.runSampleImport")}
              </Button>
            </section>
          </div>

          <section className="tax-quality-strip">
            <div>
              <CheckCircleOutlined />
              <span>
                <strong>{t("tax.quality18")}</strong>
                {t("tax.quality18Body")}
              </span>
            </div>
            <div>
              <WarningOutlined />
              <span>
                <strong>{t("tax.qualityFob")}</strong>
                {t("tax.qualityFobBody")}
              </span>
            </div>
            <div>
              <CloudDownloadOutlined />
              <span>
                <strong>{t("tax.qualityArchive")}</strong>
                {t("tax.qualityArchiveBody")}
              </span>
            </div>
          </section>
        </main>
      )}

      {view === "rates" && (
        <main className="tax-tool-page">
          {/* 查询与入库分开：查台账是只读高频操作，同步/导入是低频写操作，
              混在一张卡里想查个数的人也要面对两个写按钮。 */}
          <nav className="rate-tab-switch" aria-label={t("tax.rates")}>
            <button
              className={rateTab === "query" ? "is-active" : ""}
              type="button"
              onClick={() => setRateTab("query")}
            >
              {t("tax.rateQuery")}
            </button>
            <button
              className={rateTab === "ingest" ? "is-active" : ""}
              type="button"
              onClick={() => setRateTab("ingest")}
            >
              {t("tax.rateIngest")}
            </button>
          </nav>

          {rateTab === "query" && (
            <div className="rate-stat-grid">
              <section>
                <Statistic
                  title={t("tax.rateRecords", { currency })}
                  value={rates.length}
                  suffix={t("tax.days")}
                />
                <Progress
                  percent={Math.min(100, Math.round((rates.length / 366) * 100))}
                  showInfo={false}
                  strokeColor="#a87349"
                />
                <small>{t("tax.rateListLimit")}</small>
              </section>
              <section>
                <Statistic
                  precision={4}
                  title={t("tax.latestBuyingTransfer")}
                  value={Number(rates[0]?.buyingTransfer ?? 0)}
                />
                <small>
                  {rates[0]?.rateDate ?? t("tax.notImported")} · {rates[0]?.source ?? "—"}
                </small>
              </section>
              <section className="rate-query-card">
                <label className="rate-currency-field">
                  <span>{t("tax.currency")}</span>
                  <Select
                    options={CURRENCY_CHOICES.map((code) => ({
                      value: code,
                      label: currencies.includes(code)
                        ? code
                        : `${code} · ${t("tax.noData")}`,
                    }))}
                    showSearch
                    value={currency}
                    onChange={setCurrency}
                  />
                </label>
                <label className="rate-currency-field">
                  <span>{t("tax.startDate")}</span>
                  <Input
                    type="date"
                    value={rateRange.startDate}
                    onChange={(event) =>
                      setRateRange((current) => ({
                        ...current,
                        startDate: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="rate-currency-field">
                  <span>{t("tax.endDate")}</span>
                  <Input
                    type="date"
                    value={rateRange.endDate}
                    onChange={(event) =>
                      setRateRange((current) => ({
                        ...current,
                        endDate: event.target.value,
                      }))
                    }
                  />
                </label>
                {(rateRange.startDate || rateRange.endDate) && (
                  <Button
                    size="small"
                    type="text"
                    onClick={() => setRateRange({ startDate: "", endDate: "" })}
                  >
                    {t("tax.clearRange")}
                  </Button>
                )}
              </section>
            </div>
          )}

          {rateTab === "ingest" && (
            <div className="rate-ingest-grid">
              {/* 只在缺密钥时提示怎么配；已配置属于基础设施状态，与开票业务
                  无关，不再常驻一条绿色横幅。 */}
              {botUnconfigured && (
                <Alert
                  className="bot-status-alert"
                  showIcon
                  type="warning"
                  message={t("tax.botNotConfigured")}
                  description={t("tax.botNotConfiguredBody", {
                    envVar: botStatus?.envVar ?? "ZWT_BOT_API_KEY",
                    file: "zwt-finance-system/.env",
                  })}
                />
              )}
              <section className="tax-tool-card">
                <div className="tool-card-heading">
                  <div className="tool-card-icon copper">
                    <ApiOutlined />
                  </div>
                  <div>
                    <span>{t("tax.rateIngest")}</span>
                    <h2>{t("tax.syncFromBot")}</h2>
                    <p>{t("tax.syncFromBotHint")}</p>
                  </div>
                </div>
                <Button
                  block
                  disabled={botUnconfigured}
                  icon={<ApiOutlined />}
                  size="large"
                  type="primary"
                  onClick={() => setFetchOpen(true)}
                >
                  {t("tax.syncFromBot")}
                </Button>
              </section>
              <section className="tax-tool-card">
                <div className="tool-card-heading">
                  <div className="tool-card-icon ink">
                    <FileExcelOutlined />
                  </div>
                  <div>
                    <span>{t("tax.rateIngest")}</span>
                    <h2>{t("tax.pickBotExcel")}</h2>
                    <p>{t("tax.pickBotExcelHint")}</p>
                  </div>
                </div>
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
                  <Button icon={<FileExcelOutlined />} size="large">
                    {t("tax.pickBotExcel")}
                  </Button>
                </Upload>
                <Button
                  disabled={!rateFile}
                  loading={busy}
                  size="large"
                  onClick={() => void runRateImport()}
                >
                  {t("tax.importPicked")}
                </Button>
              </section>
            </div>
          )}
          {rateTab === "query" && (
          <section className="rate-ledger-card">
            <div className="section-title-row">
              <div>
                <span className="workspace-kicker">{t("tax.rateLedgerKicker")}</span>
                <h2>{t("tax.rateLedger")}</h2>
              </div>
              <Button icon={<ReloadOutlined />} onClick={() => void refreshRates()}>
                {t("common.refresh")}
              </Button>
            </div>
            {rates.length ? (
              <Table
                columns={[
                  { title: t("tax.colCurrency"), dataIndex: "currency", width: 90 },
                  { title: t("tax.colRateDay"), dataIndex: "rateDate", width: 120 },
                  {
                    // 出口税票取的就是这一列，加粗与其余三种区分开。
                    title: `Buying Transfer · ${t("tax.rateUsedForInvoice")}`,
                    dataIndex: "buyingTransfer",
                    width: 190,
                    align: "right",
                    render: (value: string) => <strong>{Number(value).toFixed(4)}</strong>,
                  },
                  {
                    title: "Buying Sight",
                    dataIndex: "buyingSight",
                    width: 130,
                    align: "right",
                    render: rateCell,
                  },
                  {
                    title: "Selling",
                    dataIndex: "selling",
                    width: 120,
                    align: "right",
                    render: rateCell,
                  },
                  {
                    title: "Mid Rate",
                    dataIndex: "midRate",
                    width: 120,
                    align: "right",
                    render: rateCell,
                  },
                  {
                    title: t("tax.colSource"),
                    dataIndex: "source",
                    width: 150,
                    render: (value: string) => (
                      <Tag>{value === "bot_api" ? "BOT API" : "BOT Excel"}</Tag>
                    ),
                  },
                  { title: t("tax.colSourceFile"), dataIndex: "sourceFileName", ellipsis: true },
                  {
                    title: t("tax.colUpdatedAt"),
                    dataIndex: "updatedAt",
                    width: 190,
                    render: (value: string) => dateTime(value, locale),
                  },
                ]}
                dataSource={rates}
                pagination={{ pageSize: 15, showSizeChanger: false }}
                rowKey={(record) => `${record.currency}-${record.rateDate}`}
                scroll={{ x: 1100 }}
              />
            ) : (
              <Empty description={t("tax.noRates")} />
            )}
          </section>
          )}
        </main>
      )}

      <Modal
        cancelText={t("common.cancel")}
        confirmLoading={busy}
        okText={t("tax.startSync")}
        open={fetchOpen}
        title={t("tax.botModalTitle")}
        onCancel={() => setFetchOpen(false)}
        onOk={() => void runBotFetch()}
      >
        <p className="modal-intro">{t("tax.botModalIntro")}</p>
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <label className="date-field">
            <span>{t("tax.currency")}</span>
            <Select
              options={CURRENCY_CHOICES.map((code) => ({ value: code, label: code }))}
              showSearch
              value={currency}
              onChange={setCurrency}
            />
          </label>
          <label className="date-field">
            <span>{t("tax.startDate")}</span>
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
            <span>{t("tax.endDate")}</span>
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
        cancelText={t("common.cancel")}
        className="tax-edit-modal"
        confirmLoading={busy}
        okText={t("tax.editSave")}
        open={editOpen}
        title={t("tax.editTitle")}
        width={1040}
        onCancel={() => setEditOpen(false)}
        onOk={() => void saveEdit()}
      >
        <Alert message={t("tax.editHint")} showIcon type="info" />
        <Form form={editForm} layout="vertical">
          <div className="tax-edit-grid">
            <Form.Item
              label={t("tax.invoiceDate")}
              name="invoiceDate"
              rules={[{ required: true, message: t("tax.invoiceDateRequired") }]}
            >
              <Input type="date" />
            </Form.Item>
            <Form.Item
              label={t("tax.exchangeTargetDate")}
              name="exchangeTargetDate"
              rules={[{ required: true, message: t("tax.targetDateRequired") }]}
            >
              <Input type="date" />
            </Form.Item>
            <Form.Item label={t("tax.exchangeRateDate")} name="exchangeRateDate">
              <Input type="date" />
            </Form.Item>
            <Form.Item
              label="BOT Buying Transfer"
              name="exchangeRate"
              rules={[{ required: true, message: t("tax.rateRequired") }]}
            >
              <InputNumber min={0.000001} precision={6} />
            </Form.Item>
            <Form.Item
              label={t("tax.customerName")}
              name="customerName"
              rules={[{ required: true, message: t("tax.customerNameRequired") }]}
            >
              <Input className="thai-input" />
            </Form.Item>
            <Form.Item
              className="tax-edit-address"
              label={t("tax.customerAddress")}
              name="customerAddress"
              rules={[{ required: true, message: t("tax.customerAddressRequired") }]}
            >
              <Input className="thai-input" />
            </Form.Item>
            <Form.Item label={t("tax.taxId")} name="taxId"><Input /></Form.Item>
            <Form.Item label="PO No." name="poNo"><Input /></Form.Item>
            <Form.Item label={t("tax.incoterms")} name="incoterms"><Input /></Form.Item>
            <Form.Item label={t("tax.paymentTerm")} name="paymentTerm"><Input /></Form.Item>
          </div>
          <Divider titlePlacement="left">{t("tax.itemsDivider")}</Divider>
          <Form.List
            name="items"
            rules={[
              {
                async validator(_, items) {
                  if (!items?.length) throw new Error(t("tax.atLeastOneItem"));
                  if (items.length > 18) throw new Error(t("tax.atMost18Items"));
                },
              },
            ]}
          >
            {(fields, { add, remove }, { errors }) => (
              <>
                <div className="tax-item-editor">
                  <div className="tax-item-editor-head">
                    <span>#</span>
                    <span>{t("tax.colProductName")}</span>
                    <span>{t("tax.colProductCode")}</span>
                    <span>{t("tax.colUnit")}</span>
                    <span>{t("tax.colQuantity")}</span>
                    <span>{t("tax.colFobUnitPrice")}</span>
                    <span>FOB USD</span>
                    <span>FOB THB</span>
                    <span />
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
                  {t("tax.addItem")}
                </Button>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>

      <Modal
        cancelText={t("common.cancel")}
        confirmLoading={busy}
        okButtonProps={{ danger: workflowAction === "void" }}
        okText={workflowAction === "void" ? t("tax.voidOk") : t("tax.correctionOk")}
        open={workflowAction !== null}
        title={workflowAction === "void" ? t("tax.voidTitle") : t("tax.correctionTitle")}
        onCancel={() => setWorkflowAction(null)}
        onOk={() => void runWorkflowAction()}
      >
        <Alert
          message={
            workflowAction === "void" ? t("tax.voidWarning") : t("tax.correctionWarning")
          }
          showIcon
          type={workflowAction === "void" ? "warning" : "info"}
        />
        <label className="workflow-reason-field">
          <span>
            {workflowAction === "void" ? t("tax.voidReason") : t("tax.correctionReason")}
          </span>
          <Input.TextArea
            maxLength={1000}
            placeholder={t("tax.reasonPlaceholder")}
            rows={4}
            value={workflowReason}
            onChange={(event) => setWorkflowReason(event.target.value)}
          />
        </label>
      </Modal>
    </section>
  );
}
