import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
  ImportOutlined,
  ReloadOutlined,
  TableOutlined,
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
  Table,
  Tag,
  Tooltip,
  Upload,
} from "antd";
import type { UploadFile } from "antd";
import type { ColumnsType } from "antd/es/table";

import type { Locale, Translate } from "../../i18n";
import { useAuth } from "../../auth/AuthContext";
import { FinanceLifecycleTabs, type FinanceLifecyclePhase } from "../../ui";
import { ThaiText } from "../../shared/ThaiText";
// 签名图库是两个模块共用的，接口挂在 WHT 路由下。
import { listSignatures } from "../wht/api";
import type { ApiIssue } from "../../shared/http";
import {
  TaxInvoiceApiError,
  approveTaxInvoice,
  createTaxInvoiceCorrection,
  downloadTaxInvoiceDocument,
  exportTaxInvoiceLedger,
  fetchExchangeRates,
  generateTaxInvoiceDocuments,
  getBotApiStatus,
  getTaxInvoice,
  importDualFiles,
  importExchangeRates,
  importSample,
  listRateCurrencies,
  listTaxInvoiceDocuments,
  listTaxInvoices,
  updateTaxInvoice,
  voidTaxInvoice,
} from "./api";
import {
  classifyDualFile,
  isReadyPair,
  mergeDualFiles,
  type DualPair,
} from "./dualPairing";
import type {
  BotApiStatus,
  TaxInvoice,
  TaxInvoiceDocument,
  TaxInvoiceItem,
  TaxInvoiceStatus,
} from "./types";
import { ExchangeRateDirectory } from "./ExchangeRateDirectory";

type WorkspaceView = "ledger" | "recognition" | "batch" | "rates";

/**
 * Sample 表格的表头要求，与后端 parse_sample_workbook 一一对应
 * （backend/app/modules/tax_invoice/recognition.py）。少一个必填列后端直接
 * 拒收整份文件，所以把清单摆在页面上，省得每次都靠试错。改后端记得同步这里。
 */
const SAMPLE_REQUIRED_COLUMNS = [
  "CDN",
  "Customer Name",
  "Customer Address",
  "Product Name or Service",
  "Product Code",
  "Unit",
  "Quantity",
  "FX Date",
  "FX Rate",
  "FOB Rev USD",
  "FOB Rev THB",
];

const SAMPLE_OPTIONAL_COLUMNS = [
  "C/I No.",
  "CI/PI Date",
  "Invoice Date",
  "Submission Date",
  "RevRec Period",
  "HS CODE",
  "CI Unit Price",
  "FOB Unit Price USD",
  "TAX ID",
  "PO No",
  "INCOTERMS",
  "Payment Term",
];

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

/** 一组导入的结果。成功失败都留一条，界面按原顺序全部列出来。 */
interface DualImportOutcome {
  key: string;
  label: string;
  invoiceFileName: string;
  customsFileName: string;
  ok: boolean;
  invoiceCount: number;
  itemCount: number;
  needsReviewCount: number;
  invoiceIds: string[];
  /** 失败时的主提示；成功为 null。 */
  error: string | null;
  /** 后端逐条退回的明细，展开后显示。 */
  details: string[];
}

/** 队列里的一组：两枚文件徽章 + 状态 + 移除。 */
function DualPairRow({
  index,
  pair,
  t,
  onRemove,
}: {
  index: number;
  pair: DualPair;
  t: Translate;
  onRemove: () => void;
}) {
  const ready = isReadyPair(pair);
  return (
    <li className={`dual-pair-row${ready ? " is-ready" : ""}`}>
      <span className="dual-pair-index">{index}</span>
      <span className="dual-pair-name" title={pair.label}>
        {pair.label}
      </span>
      <span className="dual-pair-files">
        <DualFileChip
          fileName={pair.invoiceFile?.name ?? null}
          icon={<FileExcelOutlined />}
          missingLabel={t("tax.pairMissingExcel")}
        />
        <DualFileChip
          fileName={pair.customsFile?.name ?? null}
          icon={<FilePdfOutlined />}
          missingLabel={t("tax.pairMissingPdf")}
        />
      </span>
      <Button
        aria-label={t("tax.pairRemove", { name: pair.label })}
        icon={<CloseOutlined />}
        size="small"
        type="text"
        onClick={onRemove}
      />
    </li>
  );
}

/** 一枚文件徽章。缺失时显示缺的是什么，而不是留白。 */
function DualFileChip({
  fileName,
  icon,
  missingLabel,
}: {
  fileName: string | null;
  icon: ReactNode;
  missingLabel: string;
}) {
  return (
    <span
      className={`dual-file-chip${fileName ? "" : " is-missing"}`}
      title={fileName ?? missingLabel}
    >
      {icon}
      <span>{fileName ?? missingLabel}</span>
    </span>
  );
}

/**
 * 把后端的 reason 码翻成当前语言。认不出的码退回后端给的英文说明，
 * 好过显示一个原始枚举值——后端加了新原因时界面不至于变成乱码。
 */
function conflictText(issue: ApiIssue, t: Translate): string {
  const keys: Record<string, Parameters<Translate>[0]> = {
    duplicate_in_file: "tax.issueDuplicateInFile",
    already_exists: "tax.issueAlreadyExists",
    number_not_allowed: "tax.issueNumberNotAllowed",
  };
  const key = keys[issue.reason];
  if (!key) return issue.detail;
  return t(key, { key: issue.key });
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
          title={t("tax.warningCount", { count: warnings })}
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
  // 汇率维护是写操作（invoice:write）。前端这道只是别让人白跑一趟：
  // 真正的拦截在后端，禁掉按钮拦不住直接调接口的人。
  // canMigrate 随历史迁移 UI 一起摘掉了（见 main 上的「摘除清单」），别再加回来。
  const { can } = useAuth();
  const canWriteRates = can("invoice:write");
  const [view, setView] = useState<WorkspaceView>("ledger");
  const [invoices, setInvoices] = useState<TaxInvoice[]>([]);
  // 汇率中心可以看任何币种；出口税票取哪个汇率是另一回事，业务规则仍是
  // USD 的 buying transfer，不受这里的浏览选择影响。
  const [currency, setCurrency] = useState("USD");
  const [currencies, setCurrencies] = useState<string[]>([]);
  // 汇率中心拆成两件事：把汇率灌进库（写）和查台账（只读）。混在一张卡片里，
  // 想查个汇率的人要盯着"同步/导入"两个写操作按钮，误点代价还不小。
  // 入库在前：台账里的数据都是先同步/导入才有的，查询是它的下游。
  const [rateTab, setRateTab] = useState<"ingest" | "query">("ingest");
  const [botStatus, setBotStatus] = useState<BotApiStatus | null>(null);
  const [selected, setSelected] = useState<TaxInvoice | null>(null);
  const [documents, setDocuments] = useState<TaxInvoiceDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<TaxInvoiceStatus | "all">("all");
  const [period, setPeriod] = useState("all");
  const [phase, setPhase] = useState<FinanceLifecyclePhase>("pending");
  // 识别建单的待导入队列：一次可以拖进任意多组「同名 Excel + 同名 PDF」。
  const [dualPairs, setDualPairs] = useState<DualPair[]>([]);
  // 跑完一批的逐组结果。null 表示还没跑过，空数组不会出现。
  const [dualResults, setDualResults] = useState<DualImportOutcome[] | null>(null);
  const [dualProgress, setDualProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  // 结果清单展开哪几组。默认只展开失败的：成功的看一眼汇总就够了。
  const [dualExpanded, setDualExpanded] = useState<string[]>([]);
  const [sampleFile, setSampleFile] = useState<File | null>(null);
  const [conflicts, setConflicts] = useState<ApiIssue[]>([]);
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

  // 汇率的拉取已随 UI 一起移进 ExchangeRateDirectory，这里不再有 refreshRates。

  // 收 id 而不是整条记录：结果清单里只有 invoiceId，没有台账那份完整对象。
  const openInvoice = useCallback(
    async (invoiceId: string) => {
      setBusy(true);
      try {
        const [detail, nextDocuments] = await Promise.all([
          getTaxInvoice(invoiceId),
          listTaxInvoiceDocuments(invoiceId),
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

  /**
   * 一次投放的整批文件按扩展名归位。同类型多给了几个只认第一个：同一次开票
   * 只有一份 Export Invoice 和一份报关单，静默取最后一个会让人不知道用了哪份。
   */
  const acceptDualFiles = useCallback(
    (files: File[]) => {
      const { pairs, unsupported, duplicated } = mergeDualFiles(dualPairs, files);
      setDualPairs(pairs);
      if (unsupported.length) {
        message.warning(t("tax.unsupportedFiles", { files: unsupported.join("、") }));
      }
      if (duplicated.length) {
        message.warning(t("tax.duplicateIgnored", { files: duplicated.join("、") }));
      }
    },
    [dualPairs, message, t],
  );

  const readyPairs = useMemo(() => dualPairs.filter(isReadyPair), [dualPairs]);
  const incompletePairs = useMemo(
    () => dualPairs.filter((pair) => !isReadyPair(pair)),
    [dualPairs],
  );

  const dualSummary = useMemo(() => {
    if (!dualResults) return null;
    return {
      ok: dualResults.filter((item) => item.ok).length,
      failed: dualResults.filter((item) => !item.ok).length,
      invoices: dualResults.reduce((sum, item) => sum + item.invoiceCount, 0),
      items: dualResults.reduce((sum, item) => sum + item.itemCount, 0),
      needsReview: dualResults.reduce((sum, item) => sum + item.needsReviewCount, 0),
    };
  }, [dualResults]);

  /**
   * 逐组导入。后端 /import/dual 一次只收一对文件，所以批量在前端串行展开。
   *
   * 串行而不是并发：每组是各自独立的事务，串行能保证结果清单的顺序和队列
   * 顺序一致，也不会让二十来个 multipart 请求同时压上去。中途某组失败只记
   * 一条错误继续往下跑——一份坏 PDF 不该把另外十八组一起废掉。
   */
  const runDualImport = async () => {
    if (!readyPairs.length) {
      message.warning(t("tax.dualFilesRequired"));
      return;
    }
    setBusy(true);
    setDualResults(null);
    setDualProgress({ done: 0, total: readyPairs.length });
    const outcomes: DualImportOutcome[] = [];
    for (const pair of readyPairs) {
      const base = {
        key: pair.key,
        label: pair.label,
        invoiceFileName: pair.invoiceFile.name,
        customsFileName: pair.customsFile.name,
      };
      try {
        const result = await importDualFiles(pair.invoiceFile, pair.customsFile);
        outcomes.push({
          ...base,
          ok: true,
          invoiceCount: result.invoiceCount,
          itemCount: result.itemCount,
          needsReviewCount: result.needsReviewCount,
          invoiceIds: result.invoiceIds,
          error: null,
          details: [],
        });
      } catch (error) {
        outcomes.push({
          ...base,
          ok: false,
          invoiceCount: 0,
          itemCount: 0,
          needsReviewCount: 0,
          invoiceIds: [],
          error: error instanceof Error ? error.message : t("tax.recognitionFailed"),
          details: error instanceof TaxInvoiceApiError ? error.details : [],
        });
      }
      setDualProgress({ done: outcomes.length, total: readyPairs.length });
    }

    const succeeded = new Set(
      outcomes.filter((item) => item.ok).map((item) => item.key),
    );
    // 成功的从队列里摘掉，失败的留着——改完文件按原位重跑，不用重新选一遍。
    setDualPairs((current) => current.filter((pair) => !succeeded.has(pair.key)));
    setDualResults(outcomes);
    // 默认只展开失败项：成功的看汇总就够了，出错的必须一眼看到原因。
    setDualExpanded(outcomes.filter((item) => !item.ok).map((item) => item.key));
    setDualProgress(null);
    setBusy(false);

    const failed = outcomes.length - succeeded.size;
    if (failed) {
      message.warning(
        t("tax.batchDualPartial", { ok: succeeded.size, failed }),
      );
    } else {
      message.success(
        t("tax.batchDualDone", {
          groups: succeeded.size,
          invoices: outcomes.reduce((sum, item) => sum + item.invoiceCount, 0),
          items: outcomes.reduce((sum, item) => sum + item.itemCount, 0),
        }),
      );
    }
    // 台账在后台刷新：结果清单留在本页，让人先把这一批核对完。
    await refreshInvoices();
  };

  /** 从结果清单跳去台账看某一份税票。 */
  const openInvoiceFromResult = async (invoiceId: string) => {
    setView("ledger");
    await openInvoice(invoiceId);
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
      // 后端一次退回所有冲突行。塞进 message 会被截断也不能滚动，
      // 逐行清单必须用弹窗展示，用户才能照着改表。
      if (error instanceof TaxInvoiceApiError && error.issues.length) {
        setConflicts(error.issues);
      } else {
        message.error(error instanceof Error ? error.message : t("tax.sampleFailed"));
      }
    } finally {
      setBusy(false);
    }
  };

  const runLedgerExport = async () => {
    if (!filteredInvoices.length) {
      message.warning(t("tax.exportEmpty"));
      return;
    }
    setBusy(true);
    try {
      await exportTaxInvoiceLedger({ status, period, query });
      message.success(t("tax.exportDone"));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("tax.exportFailed"));
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
      if (!currencies.includes(currency)) {
        setCurrencies((current) => [...current, currency].sort());
      }
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
      <header className="workspace-header">
        <div>
          {/* 页头格式与 WHT / 工资预支一致：英文模块码 + <small> 里的功能名。 */}
          <h1>
            <span>TAX INV</span>
            <small>{t("tax.title")}</small>
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
          className={view === "batch" ? "is-active" : ""}
          type="button"
          onClick={() => setView("batch")}
        >
          <ImportOutlined />
          {t("tax.batchNav")}
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
              {/* 导出跟着筛选条件走：看到的是哪一批，导出的就是哪一批。 */}
              <Tooltip title={t("tax.exportLedgerTip")}>
                <Button
                  icon={<DownloadOutlined />}
                  loading={busy}
                  onClick={() => void runLedgerExport()}
                >
                  {t("tax.exportLedger")}
                </Button>
              </Tooltip>
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
                onClick: () => void openInvoice(record.id),
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
              {/* 一个投放区收两种文件：财务同事手上 Excel 和 PDF 是一起拿到的，
                  分成两个框逼他们分两次选，多一次来回没有任何收益。 */}
              <Upload.Dragger
                accept=".xlsx,.xls,.pdf"
                className="dual-drop-zone"
                beforeUpload={(file, batch) => {
                  // beforeUpload 每个文件调一次；只在整批的第一个上处理，
                  // 否则「忽略了哪些文件」的提示会按文件数重复弹。
                  if (file === batch[0]) acceptDualFiles(batch);
                  return false;
                }}
                fileList={[]}
                multiple
                showUploadList={false}
                onDrop={(event) => {
                  // 点击选文件的分支里认不出的文件会走到 acceptDualFiles 提示；
                  // 拖拽这条 rc-upload 会先按 accept 滤掉，根本到不了 beforeUpload。
                  // 拖拽是这个区域的主路径，静默吞掉文件说不过去，单独补一条提示。
                  const rejected = Array.from(event.dataTransfer.files)
                    .filter((file) => !classifyDualFile(file))
                    .map((file) => file.name);
                  if (rejected.length) {
                    message.warning(
                      t("tax.unsupportedFiles", { files: rejected.join("、") }),
                    );
                  }
                }}
              >
                <p className="ant-upload-drag-icon dual-drop-icons">
                  <FileExcelOutlined />
                  <PlusOutlined />
                  <FilePdfOutlined />
                </p>
                <p className="ant-upload-text">{t("tax.dualDropTitle")}</p>
                <p className="ant-upload-hint">{t("tax.dualDropHint")}</p>
                <Button icon={<UploadOutlined />} size="small">
                  {t("tax.dualPickFiles")}
                </Button>
              </Upload.Dragger>
              {dualPairs.length > 0 && (
                <div className="dual-queue">
                  <div className="dual-queue-head">
                    <h3>
                      {t("tax.pairQueue")}
                      <span>{t("tax.pairQueueCount", { count: readyPairs.length })}</span>
                    </h3>
                    <Button size="small" type="text" onClick={() => setDualPairs([])}>
                      {t("tax.pairClearAll")}
                    </Button>
                  </div>
                  {incompletePairs.length > 0 && (
                    <Alert
                      title={t("tax.pairIncomplete", {
                        count: incompletePairs.length,
                      })}
                      description={t("tax.pairIncompleteBody")}
                      showIcon
                      type="warning"
                    />
                  )}
                  {/* 队列可能有二十来组，给个高度上限自己滚，别把按钮顶出首屏。 */}
                  <ol className="dual-pair-list">
                    {dualPairs.map((pair, index) => (
                      <DualPairRow
                        index={index + 1}
                        key={pair.key}
                        pair={pair}
                        t={t}
                        onRemove={() =>
                          setDualPairs((current) =>
                            current.filter((item) => item.key !== pair.key),
                          )
                        }
                      />
                    ))}
                  </ol>
                </div>
              )}
              {dualProgress && (
                <div className="dual-progress">
                  <Progress
                    percent={Math.round((dualProgress.done / dualProgress.total) * 100)}
                    size="small"
                    status="active"
                  />
                  <span>
                    {t("tax.pairProgress", {
                      done: dualProgress.done,
                      total: dualProgress.total,
                    })}
                  </span>
                </div>
              )}
              <Button
                block
                disabled={!readyPairs.length}
                icon={<FileSearchOutlined />}
                loading={busy}
                size="large"
                type="primary"
                onClick={() => void runDualImport()}
              >
                {readyPairs.length > 1
                  ? t("tax.startRecognitionBatch", { count: readyPairs.length })
                  : t("tax.startRecognition")}
              </Button>
            </section>

          </div>

          {dualResults && dualSummary && (
            <section className="tax-tool-card dual-result-card">
              <div className="tool-card-heading">
                <div className="tool-card-icon ink">
                  <FileDoneOutlined />
                </div>
                <div>
                  <span>{t("tax.resultEyebrow")}</span>
                  <h2>{t("tax.resultTitle", { count: dualResults.length })}</h2>
                  <p>{t("tax.resultHint")}</p>
                </div>
                <div className="dual-result-actions">
                  <Button
                    size="small"
                    onClick={() => setDualExpanded(dualResults.map((item) => item.key))}
                  >
                    {t("tax.expandAll")}
                  </Button>
                  <Button size="small" onClick={() => setDualExpanded([])}>
                    {t("tax.collapseAll")}
                  </Button>
                  <Button size="small" type="text" onClick={() => setDualResults(null)}>
                    {t("common.close")}
                  </Button>
                </div>
              </div>
              <div className="dual-result-summary">
                <div>
                  <strong>{dualSummary.ok}</strong>
                  <span>{t("tax.resultOk")}</span>
                </div>
                <div className={dualSummary.failed ? "is-alert" : ""}>
                  <strong>{dualSummary.failed}</strong>
                  <span>{t("tax.resultFailed")}</span>
                </div>
                <div>
                  <strong>{dualSummary.invoices}</strong>
                  <span>{t("tax.countInvoices")}</span>
                </div>
                <div>
                  <strong>{dualSummary.items}</strong>
                  <span>{t("tax.resultItems")}</span>
                </div>
                <div>
                  <strong>{dualSummary.needsReview}</strong>
                  <span>{t("tax.countNeedsReview")}</span>
                </div>
              </div>
              {/* 逐组一行、按导入顺序编号，点标题行展开看这一组的两份源文件
                  和生成结果；失败的默认就是展开的。 */}
              <Table<DualImportOutcome>
                className="dual-result-table"
                columns={[
                  {
                    title: "#",
                    dataIndex: "key",
                    width: 52,
                    render: (_value, _record, index) => index + 1,
                  },
                  {
                    title: t("tax.resultGroup"),
                    dataIndex: "label",
                    ellipsis: true,
                    render: (value: string) => (
                      <span className="dual-result-name">{value}</span>
                    ),
                  },
                  {
                    title: t("tax.colStatus"),
                    dataIndex: "ok",
                    width: 108,
                    render: (ok: boolean) => (
                      <Tag className={`status-tag ${ok ? "status-issued" : "status-voided"}`}>
                        {ok ? t("tax.resultOk") : t("tax.resultFailed")}
                      </Tag>
                    ),
                  },
                  {
                    title: t("tax.countInvoices"),
                    dataIndex: "invoiceCount",
                    width: 88,
                    align: "right",
                  },
                  {
                    title: t("tax.resultItems"),
                    dataIndex: "itemCount",
                    width: 88,
                    align: "right",
                  },
                ]}
                dataSource={dualResults}
                expandable={{
                  expandedRowKeys: dualExpanded,
                  onExpandedRowsChange: (keys) =>
                    setDualExpanded(keys.map((key) => String(key))),
                  expandedRowRender: (record) => (
                    <div className="dual-result-detail">
                      <dl>
                        <dt>{t("tax.invoiceExcel")}</dt>
                        <dd>{record.invoiceFileName}</dd>
                        <dt>{t("tax.customsPdf")}</dt>
                        <dd>{record.customsFileName}</dd>
                      </dl>
                      {record.ok ? (
                        <div className="dual-result-links">
                          {record.invoiceIds.map((invoiceId, index) => (
                            <Button
                              key={invoiceId}
                              size="small"
                              onClick={() => void openInvoiceFromResult(invoiceId)}
                            >
                              {t("tax.resultOpen", { index: index + 1 })}
                            </Button>
                          ))}
                        </div>
                      ) : (
                        <Alert
                          title={record.error}
                          description={
                            record.details.length ? (
                              <ul>
                                {record.details.map((detail) => (
                                  <li key={detail}>{detail}</li>
                                ))}
                              </ul>
                            ) : undefined
                          }
                          showIcon
                          type="error"
                        />
                      )}
                    </div>
                  ),
                }}
                pagination={false}
                rowKey="key"
                size="small"
              />
            </section>
          )}

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

      {view === "batch" && (
        <main className="tax-tool-page">
          <p className="tax-rule-note">
            <SafetyCertificateOutlined />
            <span>{t("tax.batchRuleNote")}</span>
          </p>

          <div className="tax-batch-grid">
            <section className="tax-tool-card">
              <div className="tool-card-heading">
                <div className="tool-card-icon ink">
                  <ImportOutlined />
                </div>
                <div>
                  <span>{t("tax.migration")}</span>
                  <h2>{t("tax.batchIssueTitle")}</h2>
                  <p>{t("tax.batchIssueHint")}</p>
                </div>
              </div>
              <Upload.Dragger
                accept=".xlsx,.xls"
                className="sample-drop-zone"
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
                <p className="ant-upload-drag-icon">
                  <FileExcelOutlined />
                </p>
                <p className="ant-upload-text">{t("tax.pickSample")}</p>
                <p className="ant-upload-hint">{t("tax.samplePickHint")}</p>
              </Upload.Dragger>
              {/* 这条原来也是一块 Alert，和右栏那块并排像两个错误提示在抢注意力。
                  它其实是"导进来之后会怎样"的说明，不是警告，压成一条内联注记。 */}
              <p className="tax-inline-note">
                <WarningOutlined />
                <span>
                  <strong>{t("tax.sampleWarning")}</strong>
                  {t("tax.sampleWarningBody")}
                </span>
              </p>
              <Button
                block
                disabled={!sampleFile}
                icon={<ImportOutlined />}
                loading={busy}
                size="large"
                type="primary"
                onClick={() => void runSampleImport()}
              >
                {t("tax.runSampleImport")}
              </Button>
            </section>

            <section className="tax-tool-card tax-column-card">
              <div className="tool-card-heading">
                <div className="tool-card-icon copper">
                  <TableOutlined />
                </div>
                <div>
                  <span>{t("tax.batchColumns")}</span>
                  <h2>Sample.xlsx</h2>
                  <p>{t("tax.batchColumnsHint")}</p>
                </div>
              </div>
              {/* DocumentNo 一律拒收，没有例外——这是编号只在批准事务里生成
                  这条规则最容易被文件绕过的地方，必须写在最显眼的位置。 */}
              <Alert
                title={t("tax.batchNumberForbidden")}
                description={t("tax.batchNumberForbiddenBody")}
                showIcon
                type="info"
              />
              <div className="column-group">
                <h3>
                  {t("tax.batchRequired")}
                  <span>{SAMPLE_REQUIRED_COLUMNS.length}</span>
                </h3>
                <div className="column-tags">
                  {SAMPLE_REQUIRED_COLUMNS.map((name) => (
                    <code className="is-required" key={name}>
                      {name}
                    </code>
                  ))}
                </div>
              </div>
              <div className="column-group">
                <h3>
                  {t("tax.batchOptional")}
                  <span>{SAMPLE_OPTIONAL_COLUMNS.length}</span>
                </h3>
                <div className="column-tags">
                  {SAMPLE_OPTIONAL_COLUMNS.map((name) => (
                    <code key={name}>{name}</code>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </main>
      )}

      {view === "rates" && (
        <main className="tax-tool-page">
          {/* 查询与入库分开：查台账是只读高频操作，同步/导入是低频写操作，
              混在一张卡里想查个数的人也要面对两个写按钮。 */}
          <nav className="rate-tab-switch" aria-label={t("tax.rates")}>
            <button
              className={rateTab === "ingest" ? "is-active" : ""}
              type="button"
              onClick={() => setRateTab("ingest")}
            >
              {t("tax.rateIngest")}
            </button>
            <button
              className={rateTab === "query" ? "is-active" : ""}
              type="button"
              onClick={() => setRateTab("query")}
            >
              {t("tax.rateQuery")}
            </button>
          </nav>

          {rateTab === "ingest" && (
            <div className="rate-ingest-grid">
              {/* 只在缺密钥时提示怎么配；已配置属于基础设施状态，与开票业务
                  无关，不再常驻一条绿色横幅。 */}
              {botUnconfigured && (
                <Alert
                  className="bot-status-alert"
                  showIcon
                  type="warning"
                  title={t("tax.botNotConfigured")}
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
                  disabled={botUnconfigured || !canWriteRates}
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
                  disabled={!canWriteRates}
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
                  disabled={!rateFile || !canWriteRates}
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
            <ExchangeRateDirectory
              canWrite={canWriteRates}
              currencies={currencies}
              currency={currency}
              locale={locale}
              t={t}
              onCurrencyChange={setCurrency}
            />
          )}
        </main>
      )}

      <Modal
        className="tax-conflict-modal"
        footer={null}
        open={conflicts.length > 0}
        title={t("tax.conflictTitle", { count: conflicts.length })}
        width={680}
        onCancel={() => setConflicts([])}
      >
        <Alert title={t("tax.conflictIntro")} showIcon type="error" />
        <ol className="conflict-list">
          {conflicts.map((issue, index) => (
            <li key={`${issue.reason}-${issue.key}-${index}`}>
              <span className="conflict-row">
                {issue.rows.length
                  ? t("tax.conflictRows", { rows: issue.rows.join(", ") })
                  : t("tax.conflictNoRow")}
              </span>
              <span>{conflictText(issue, t)}</span>
            </li>
          ))}
        </ol>
      </Modal>

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
        <Alert title={t("tax.editHint")} showIcon type="info" />
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
          title={
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
