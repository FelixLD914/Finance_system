import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ApiOutlined,
  ArrowLeftOutlined,
  ArrowsAltOutlined,
  AuditOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  CloseOutlined,
  CloudDownloadOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  ProfileOutlined,
  FileDoneOutlined,
  FileExcelOutlined,
  FilePdfOutlined,
  FileSearchOutlined,
  ImportOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
  RightOutlined,
  ShrinkOutlined,
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
  Checkbox,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Segmented,
  Select,
  Space,
  Spin,
  Steps,
  Table,
  Tag,
  Tooltip,
  Upload,
} from "antd";
import type { TableProps, UploadFile } from "antd";
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
  identifyDualFiles,
  importDualBatch,
  importExchangeRates,
  importSample,
  listExchangeRateMonths,
  listRateCurrencies,
  matchTaxInvoiceRate,
  listImportBatches,
  listTaxInvoiceDocuments,
  listTaxInvoices,
  listTaxInvoicesByBatch,
  approveTaxInvoiceBatch,
  rejectTaxInvoiceBatch,
  rejectTaxInvoice,
  restoreTaxInvoice,
  updateTaxInvoice,
  voidTaxInvoice,
} from "./api";
import {
  classifyDualFile,
  mergeDualFiles,
  type QueuedFile,
} from "./dualPairing";
import {
  hasSummaryMismatch,
  needsAttention,
  reviewWarnings,
  usdMismatch,
  warningCount,
} from "./reviewReconcile";
import type {
  BotApiStatus,
  DualBatchImportResult,
  DualBatchPairResult,
  DualIdentifyResult,
  DualPairPreview,
  ExchangeRateMonth,
  ImportBatch,
  TaxInvoice,
  TaxInvoiceDocument,
  TaxInvoiceItem,
  TaxInvoiceStatus,
} from "./types";
import { ExchangeRateDirectory } from "./ExchangeRateDirectory";

// 三个平级入口：台账（看）、开票（做）、汇率中心（查/维护）。原来的五个平铺
// 页签里，「识别与导入 / 表格批量导入 / 批次复核」其实是开票这一件事的三个阶段，
// 现在串进「开票」这条向导流水线，不再各占一个顶部页签抢首屏。
type WorkspaceView = "ledger" | "issue" | "rates";

// 开票向导的五步：选汇率 → 导入文件 → 核对匹配 → 汇总复核 → 提交开具。
// 顶部横向步骤标就照这个顺序渲染，第 3、4 步全屏铺开、让位给核对内容。
type WizardStep = "rate" | "import" | "reconcile" | "review" | "submit";
const WIZARD_ORDER: WizardStep[] = [
  "rate",
  "import",
  "reconcile",
  "review",
  "submit",
];

// 导入方式：Sample 表格批量开具，或发票+报关单双流识别配对。
type IssueMethod = "dual" | "sample";

/** 把 <input type="month"> 的 YYYY-MM 和后端月份键（可能带/不带连字符）都归一成纯数字比。 */
function sameMonth(a: string, b: string): boolean {
  return a.replace(/\D/g, "") === b.replace(/\D/g, "");
}

// 台账里可行内编辑的字段（都在后端 TaxInvoiceUpdate 里、且是 date/文本类）。
// 编号/CI/CDN 不在更新 schema 里，FOB THB 由明细算出，状态另有流程——都不给编辑。
type EditableCellField =
  | "invoiceDate"
  | "exchangeRateDate"
  | "customerName"
  | "incoterms";

// 只有未批准（草稿/待复核/待批准）能改，与后端 update_invoice 的门禁一致。
const EDITABLE_STATUSES = new Set<TaxInvoiceStatus>([
  "draft",
  "needs_review",
  "ready",
]);

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
  // 拒批和作废都是历史里的终态，共用同一套「已失效」外观。
  rejected: "status-voided",
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
  // 拒批的税票像软删除一样进历史，可在这里查看并恢复。
  history: ["issued", "voided", "rejected"],
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
  "rejected",
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

/** 一份清单（Excel 或 PDF）。两份清单单独列出是这次改版的要点之一。 */
function QueueColumn({
  files,
  icon,
  title,
  onRemove,
}: {
  files: QueuedFile[];
  icon: ReactNode;
  title: string;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="dual-file-column">
      <h4>
        {icon} {title}
        <span>{files.length}</span>
      </h4>
      {files.length === 0 ? (
        <p className="dual-file-empty">—</p>
      ) : (
        <ol>
          {files.map((item) => (
            <li key={item.id} title={item.file.name}>
              <span>{item.file.name}</span>
              <Button
                aria-label={item.file.name}
                icon={<CloseOutlined />}
                size="small"
                type="text"
                onClick={() => onRemove(item.id)}
              />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * 一组配对结果占一行：左边 Excel、右边 PDF，中间是后端读出来的核对字段。
 *
 * 关单侧的字段（提交日期 / 海关汇率 / 货代 / 报关单泰铢金额）直接摆在这一行上：
 * 用户在点导入之前就该看到"这份关单读出来是什么"，而不是导完再去复核页找。
 */
function DualPairRow({
  index,
  pair,
  t,
}: {
  index: number;
  pair: DualPairPreview;
  t: Translate;
}) {
  const { invoice, customs } = pair;
  return (
    <li className={`dual-pair-row is-${pair.status.replace("_", "-")}`}>
      <span className="dual-pair-index">{index}</span>
      <span className="dual-pair-name" title={pair.key}>
        {pair.key}
        {invoice?.incoterms ? <em>{invoice.incoterms}</em> : null}
      </span>
      <span className="dual-pair-files">
        <DualFileChip
          fileName={invoice?.fileName ?? null}
          icon={<FileExcelOutlined />}
          missingLabel={t("tax.pairMissingExcel")}
        />
        <DualFileChip
          fileName={customs?.fileName ?? null}
          icon={<FilePdfOutlined />}
          missingLabel={t("tax.pairMissingPdf")}
        />
      </span>
      <span className="dual-pair-facts">
        {customs ? (
          <>
            <span>
              {t("tax.pairSubmitDate")}：{customs.submissionDate ?? "—"}
              {customs.submissionDateLowConfidence ? (
                <b title={customs.submissionDateConfidence ?? ""}>
                  {t("tax.pairNeedsReview")}
                </b>
              ) : null}
            </span>
            <span>
              {t("tax.pairCustomsRate")}：{customs.customsExchangeRate ?? "—"}
            </span>
            <span title={customs.forwarderNameTh ?? ""}>
              {t("tax.pairForwarder")}：{customs.forwarderName ?? "—"}
            </span>
            <span>
              {t("tax.pairCustomsThb")}：
              {customs.customsFobThbPrintedTotal ??
                customs.customsFobThbLineTotal ??
                "—"}
            </span>
            {customs.warnings.map((warning) => (
              <span className="dual-pair-warning" key={warning}>
                {warning}
              </span>
            ))}
          </>
        ) : (
          <span className="dual-pair-warning">
            {pair.status === "invoice_only"
              ? t("tax.pairPendingCustoms")
              : t("tax.pairOrphanCustoms")}
          </span>
        )}
        {pair.conflicts.map((conflict) => (
          <span className="dual-pair-warning" key={conflict}>
            {conflict}
          </span>
        ))}
        {pair.supersededCustomsFileNames.length > 0 && (
          <span className="dual-pair-warning">
            {t("tax.pairSupersededCustoms", {
              files: pair.supersededCustomsFileNames.join("、"),
            })}
          </span>
        )}
      </span>
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

// 复核台的核对口径（warningCount / usdMismatch / needsAttention / reviewWarnings…）
// 都抽到了 ./reviewReconcile，单独单测、单独调口径。

export function InvoiceInspector({
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
  onMatchRate,
  onReject,
  onRestore,
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
  onMatchRate: () => void;
  onReject: () => void;
  onRestore: () => void;
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

      {/* 客户及报关资料排在最前：一张税票先认「开给谁、对哪张报关单」，
          日期与编号是这份主体确定后才需要核的口径，所以放到下一段。 */}
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
            {invoice.exchangeRate ? (
              `${invoice.currency} / THB ${Number(invoice.exchangeRate).toFixed(4)}`
            ) : (
              // 汇率是一次性在识别建单时匹配的；那时汇率表若无当期数据就一直空着。
              // 未批准的记录给一个「按提交日重新匹配」的入口，省得逐张手抄。
              <span className="tax-rate-unmatched">
                {t("tax.rateUnmatched")}
                {canApprove && (
                  <Button
                    icon={<ApiOutlined />}
                    loading={busy}
                    size="small"
                    type="link"
                    onClick={onMatchRate}
                  >
                    {t("tax.matchRate")}
                  </Button>
                )}
              </span>
            )}
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
              width: 92,
              align: "right",
              // 数量按业务口径无小数（源数据是 "9504.0000" 这种），千分位显示、
              // 且不让 "9504.0000" 换行断成两截（详情抽屉里那个诡异的下挂 0）。
              render: (value: string | null) =>
                value != null && value !== ""
                  ? Number(value).toLocaleString(undefined, {
                      maximumFractionDigits: 0,
                    })
                  : "—",
            },
            {
              title: "FOB USD",
              dataIndex: "fobRevenueUsd",
              width: 108,
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
        {/* 拒批＝软删除：未批准的可拒批进历史，编号未发、可再恢复。 */}
        {canApprove && (
          <Button block danger disabled={busy} onClick={onReject}>
            {t("tax.reject")}
          </Button>
        )}
        {invoice.status === "rejected" && (
          <Button
            block
            icon={<ReloadOutlined />}
            loading={busy}
            type="primary"
            onClick={onRestore}
          >
            {t("tax.restore")}
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

/**
 * 复核台钻进一批后的一张对账卡：整张票摊开在原位审——发票每行 FOB USD 与报关单
 * 该行并排、汇总并排、警告直接列出，逐条批准/拒批就在卡上，不用点开抽屉再关。
 * 抽屉入口（ProfileOutlined）保留，用来看全部字段与生成/作废等完整生命周期。
 */
export function BatchReviewCard({
  invoice,
  expanded,
  selectable,
  selected,
  busy,
  locale,
  t,
  onToggle,
  onToggleSelect,
  onOpenDrawer,
  onEdit,
  onApprove,
  onReject,
  onMatchRate,
}: {
  invoice: TaxInvoice;
  expanded: boolean;
  selectable: boolean;
  selected: boolean;
  busy: boolean;
  locale: Locale;
  t: Translate;
  onToggle: () => void;
  onToggleSelect: (checked: boolean) => void;
  onOpenDrawer: () => void;
  onEdit: () => void;
  onApprove: () => void;
  onReject: () => void;
  onMatchRate: () => void;
}) {
  const canApprove = ["draft", "needs_review", "ready"].includes(invoice.status);
  const warnings = reviewWarnings(invoice, t);
  const summaryOff = hasSummaryMismatch(invoice);
  const flagged = needsAttention(invoice);
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();

  const lineColumns: ColumnsType<TaxInvoiceItem> = [
    { title: t("tax.colLine"), dataIndex: "lineNumber", width: 46 },
    { title: t("tax.colProduct"), dataIndex: "productName", ellipsis: true },
    {
      title: t("tax.colQuantity"),
      dataIndex: "quantity",
      width: 78,
      align: "right",
      render: (value: string | null) =>
        value ? Number(value).toLocaleString() : "—",
    },
    {
      title: t("tax.colInvoiceFobUsd"),
      dataIndex: "fobRevenueUsd",
      width: 118,
      align: "right",
      render: (value: string | null) => money(value, locale),
    },
    {
      title: t("tax.colCustomsFobUsd"),
      dataIndex: "customsFobUsd",
      width: 122,
      align: "right",
      render: (value: string | null) => (value != null ? money(value, locale) : "—"),
    },
    {
      title: t("tax.colLineCheck"),
      key: "check",
      width: 56,
      align: "center",
      render: (_value: unknown, record: TaxInvoiceItem) => {
        if (record.customsFobUsd == null) {
          return <span className="review-check-na">—</span>;
        }
        return usdMismatch(record.fobRevenueUsd, record.customsFobUsd) ? (
          <CloseCircleOutlined className="review-check-off" />
        ) : (
          <CheckCircleOutlined className="review-check-ok" />
        );
      },
    },
  ];

  return (
    <section
      className={`tax-review-card${flagged ? " is-flagged" : ""}${
        expanded ? " is-open" : ""
      }`}
    >
      <div className="review-card-head">
        <Checkbox
          checked={selected}
          disabled={!selectable}
          onChange={(event) => onToggleSelect(event.target.checked)}
          onClick={stop}
        />
        <button className="review-card-headline" type="button" onClick={onToggle}>
          <RightOutlined className="review-card-caret" />
          <StatusTag status={invoice.status} t={t} />
          <span className="review-card-id">
            C/I {invoice.ciNo}
            <span className="review-card-cdn">
              · {t("tax.colCdn")} {invoice.cdn ?? "—"}
            </span>
          </span>
          <span className="review-card-sub">
            {invoice.incoterms ?? "—"} · {dateLabel(invoice.invoiceDate)}
            {!expanded &&
              (flagged ? (
                <span className="review-card-flag">
                  <WarningOutlined /> {t("tax.reviewNeedsAttention")}
                </span>
              ) : (
                <span className="review-card-ok">
                  <CheckCircleOutlined /> {t("tax.reviewAllMatch")}
                </span>
              ))}
          </span>
        </button>
        <Space size={4}>
          <Tooltip title={t("tax.reviewOpenDrawer")}>
            <Button
              aria-label={t("tax.reviewOpenDrawer")}
              icon={<ProfileOutlined />}
              size="small"
              onClick={onOpenDrawer}
            />
          </Tooltip>
          {canApprove && (
            <Button icon={<EditOutlined />} size="small" onClick={onEdit}>
              {t("common.edit")}
            </Button>
          )}
          {canApprove && (
            <Button danger disabled={busy} size="small" onClick={onReject}>
              {t("tax.reject")}
            </Button>
          )}
          {canApprove && (
            <Button loading={busy} size="small" type="primary" onClick={onApprove}>
              {t("tax.approve")}
            </Button>
          )}
        </Space>
      </div>

      {expanded && (
        <div className="review-card-body">
          {warnings.length > 0 && (
            <Alert
              className="review-card-alert"
              type="warning"
              showIcon
              message={
                <ul className="review-warning-list">
                  {warnings.map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ul>
              }
            />
          )}
          {!invoice.exchangeRate && canApprove && (
            <div className="review-rate-missing">
              <span>{t("tax.rateUnmatched")}</span>
              <Button
                icon={<ApiOutlined />}
                loading={busy}
                size="small"
                type="link"
                onClick={onMatchRate}
              >
                {t("tax.matchRate")}
              </Button>
            </div>
          )}
          <div className="review-line-head">
            <span>{t("tax.reviewLineTitle")}</span>
            <span className="review-thb-ref">
              {t("tax.reviewCustomsThbRef")}{" "}
              {money(invoice.customsFobThbPrintedTotal, locale)}
              <Tag>{t("tax.reviewRefOnly")}</Tag>
            </span>
          </div>
          <Table<TaxInvoiceItem>
            className="review-line-table"
            columns={lineColumns}
            dataSource={invoice.items}
            pagination={false}
            rowClassName={(record) =>
              usdMismatch(record.fobRevenueUsd, record.customsFobUsd)
                ? "review-line-off"
                : ""
            }
            rowKey="id"
            size="small"
          />
          <div className={`review-summary${summaryOff ? " is-off" : ""}`}>
            <div>
              <span>{t("tax.reviewInvoiceTotal")}</span>
              <strong>{money(invoice.fobRevenueUsdTotal, locale, "USD")}</strong>
            </div>
            <div>
              <span>{t("tax.reviewCustomsTotal")}</span>
              <strong>
                {invoice.customsFobUsdTotal != null
                  ? money(invoice.customsFobUsdTotal, locale, "USD")
                  : t("tax.reviewNoCustomsTotal")}
              </strong>
            </div>
            <div className="review-summary-verdict">
              {invoice.customsFobUsdTotal == null ? (
                <span className="review-check-na">—</span>
              ) : summaryOff ? (
                <span className="review-check-off">
                  <CloseCircleOutlined /> {t("tax.reviewSummaryOff")}
                </span>
              ) : (
                <span className="review-check-ok">
                  <CheckCircleOutlined /> {t("tax.reviewSummaryOk")}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
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
  // 开票向导所在步；issueMethod 记这一批走 Sample 还是双流；issueMonth 是选中的
  // 开票月份（YYYY-MM，用于「当月汇率是否就绪」的自检）；rateMonths 是有汇率数据
  // 的月份清单，进汇率步时拉一次。
  const [wizardStep, setWizardStep] = useState<WizardStep>("rate");
  const [issueMethod, setIssueMethod] = useState<IssueMethod>("dual");
  const [issueMonth, setIssueMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [rateMonths, setRateMonths] = useState<ExchangeRateMonth[]>([]);
  const [rateMonthsLoading, setRateMonthsLoading] = useState(false);
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
  // 台账按收入期间（月）分组：每月一段、带小计。默认开，可切回平铺分页表。
  const [groupByMonth, setGroupByMonth] = useState(true);
  // 分组时钻进了哪个月：null＝第一层月份列表；有值＝进了那一月的全区域详情。
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  // 列头筛选（客户 / incoterms）：受控且在 filteredInvoices 里集中过滤，
  // 这样分组视图下一处勾选对全部月份生效（antd 各表自带筛选只作用于本表）。
  const [colFilters, setColFilters] = useState<{
    customerName: string[];
    incoterms: string[];
  }>({ customerName: [], incoterms: [] });
  // 行内单元格编辑：一次只编一格（哪一行的哪个字段），编辑中的值单独存，保存时置忙。
  const [editingCell, setEditingCell] = useState<{
    id: string;
    field: EditableCellField;
  } | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [savingCell, setSavingCell] = useState(false);
  const [phase, setPhase] = useState<FinanceLifecyclePhase>("pending");
  // 复核台：导入批次列表 → 钻进某一批的对账表。
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState<ImportBatch | null>(null);
  const [batchInvoices, setBatchInvoices] = useState<TaxInvoice[]>([]);
  const [batchInvoicesLoading, setBatchInvoicesLoading] = useState(false);
  const [reviewSelectedKeys, setReviewSelectedKeys] = useState<string[]>([]);
  const [reviewQuery, setReviewQuery] = useState("");
  // 复核卡展开集合：进批时默认只展开「要人细看」的（needsAttention），其余折成一行。
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  // 识别建单的文件队列。Excel 与 PDF 分开放：配对键在文件内容里（C/I No.），
  // 浏览器解析不了，得整批发给后端识别才知道谁跟谁一组。
  const [dualQueue, setDualQueue] = useState<{
    invoices: QueuedFile[];
    customs: QueuedFile[];
  }>({ invoices: [], customs: [] });
  // 后端算好的配对结果。null 表示还没识别过。
  const [dualIdentify, setDualIdentify] = useState<DualIdentifyResult | null>(null);
  const [identifying, setIdentifying] = useState(false);
  // 整批导入的结果：一趟请求落进一个复核批次。null 表示还没跑过。
  const [dualBatchResult, setDualBatchResult] =
    useState<DualBatchImportResult | null>(null);
  const [sampleFile, setSampleFile] = useState<File | null>(null);
  const [conflicts, setConflicts] = useState<ApiIssue[]>([]);
  const [rateFile, setRateFile] = useState<File | null>(null);
  const [fetchOpen, setFetchOpen] = useState(false);
  const [workflowAction, setWorkflowAction] = useState<
    "void" | "correction" | null
  >(null);
  const [workflowReason, setWorkflowReason] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  // 编辑弹窗独立于 selected：复核卡上点「编辑」不该顺带把右侧抽屉也弹出来
  // （抽屉 open 挂在 !!selected 上）。用这个 state 单独记「在编哪张」。
  const [editingInvoice, setEditingInvoice] = useState<TaxInvoice | null>(null);
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

  const refreshBatches = useCallback(async () => {
    setBatchesLoading(true);
    try {
      setBatches(await listImportBatches());
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("tax.batchesLoadFailed"));
    } finally {
      setBatchesLoading(false);
    }
  }, [message, t]);

  const openBatch = useCallback(
    async (batch: ImportBatch) => {
      setSelectedBatch(batch);
      setReviewSelectedKeys([]);
      setSelected(null);
      setBatchInvoicesLoading(true);
      try {
        const response = await listTaxInvoicesByBatch(batch.id);
        setBatchInvoices(response.items);
        // 默认只展开要人细看的那几张，一致又无警告的折成一行。
        setExpandedKeys(
          new Set(
            response.items.filter(needsAttention).map((invoice) => invoice.id),
          ),
        );
      } catch (error) {
        message.error(error instanceof Error ? error.message : t("tax.detailLoadFailed"));
      } finally {
        setBatchInvoicesLoading(false);
      }
    },
    [message, t],
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

  // 进「汇总复核」步时拉批次列表（首次进入、或从别的步切回都刷新一遍）。
  useEffect(() => {
    if (view === "issue" && wizardStep === "review") void refreshBatches();
  }, [view, wizardStep, refreshBatches]);

  // 进「选择汇率」步时拉当前币种有数据的月份，用来判断选中月是否已就绪。
  useEffect(() => {
    if (view === "issue" && wizardStep === "rate") {
      setRateMonthsLoading(true);
      listExchangeRateMonths(currency)
        .then(setRateMonths)
        .catch(() => setRateMonths([]))
        .finally(() => setRateMonthsLoading(false));
    }
  }, [view, wizardStep, currency]);

  // 台账里某张票被单条操作（批准/拒批/恢复/改…）后，把变化镜像进复核台的
  // 对账表——省得每个单条 handler 都各自去动 batchInvoices。只更新两边都在的行。
  useEffect(() => {
    if (!selectedBatch) return;
    setBatchInvoices((current) =>
      current.map((row) => invoices.find((item) => item.id === row.id) ?? row),
    );
  }, [invoices, selectedBatch]);

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

  // 列头筛选可选值：从当前台账里去重取，客户名单较长时配 filterSearch 搜索。
  const customerOptions = useMemo(
    () =>
      Array.from(
        new Set(invoices.map((invoice) => invoice.customerName).filter(Boolean)),
      ).sort() as string[],
    [invoices],
  );
  const incotermsOptions = useMemo(
    () =>
      Array.from(
        new Set(invoices.map((invoice) => invoice.incoterms).filter(Boolean)),
      ).sort() as string[],
    [invoices],
  );

  const filteredInvoices = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return invoices.filter((invoice) => {
      if (!isInvoiceInPhase(invoice, phase)) return false;
      if (status !== "all" && invoice.status !== status) return false;
      if (period !== "all" && invoice.revenuePeriod !== period) return false;
      if (
        colFilters.customerName.length &&
        !colFilters.customerName.includes(invoice.customerName ?? "")
      )
        return false;
      if (
        colFilters.incoterms.length &&
        !colFilters.incoterms.includes(invoice.incoterms ?? "")
      )
        return false;
      if (!normalized) return true;
      return [
        invoice.documentNo,
        invoice.ciNo,
        invoice.cdn,
        invoice.customerName,
      ].some((value) => value?.toLocaleLowerCase().includes(normalized));
    });
  }, [colFilters, invoices, period, phase, query, status]);

  // 台账按月分组：有收入期间的按月倒序，没期间的（空）永远垫底；每段带 FOB THB 小计。
  const ledgerGroups = useMemo(() => {
    const byPeriod = new Map<string, TaxInvoice[]>();
    for (const invoice of filteredInvoices) {
      const key = invoice.revenuePeriod ?? "";
      const rows = byPeriod.get(key);
      if (rows) rows.push(invoice);
      else byPeriod.set(key, [invoice]);
    }
    const keys = Array.from(byPeriod.keys()).sort((a, b) => {
      if (a === "") return 1;
      if (b === "") return -1;
      return b.localeCompare(a);
    });
    return keys.map((key) => {
      const rows = byPeriod.get(key) ?? [];
      const fobThbTotal = rows.reduce(
        (sum, row) => sum + Number(row.fobRevenueThbTotal ?? 0),
        0,
      );
      return {
        key: key || "none",
        label: key ? `${key.slice(0, 4)}-${key.slice(4)}` : t("tax.noPeriod"),
        rows,
        needsReview: rows.filter((row) => row.status === "needs_review").length,
        fobThbTotal: fobThbTotal.toFixed(2),
      };
    });
  }, [filteredInvoices, t]);

  // 当前筛选下还需人工复核的张数。>0 时汇总条给出去批次复核的入口。
  const needsReviewCount = filteredInvoices.filter(
    (item) => item.status === "needs_review",
  ).length;

  type MonthGroup = (typeof ledgerGroups)[number];
  // 钻进的那一月（找不到＝筛选把它筛没了，退回月份列表）。
  const monthDetail: MonthGroup | null = selectedMonth
    ? (ledgerGroups.find((group) => group.key === selectedMonth) ?? null)
    : null;

  // 复核台对账表的客户端筛选：一个搜索框跨 编号/CI/CDN/客户 过滤。
  const reviewRows = useMemo(() => {
    const normalized = reviewQuery.trim().toLocaleLowerCase();
    if (!normalized) return batchInvoices;
    return batchInvoices.filter((invoice) =>
      [invoice.documentNo, invoice.ciNo, invoice.cdn, invoice.customerName].some(
        (value) => value?.toLocaleLowerCase().includes(normalized),
      ),
    );
  }, [batchInvoices, reviewQuery]);

  // 复核卡展开/折叠：单张切换 + 顶部「全部展开/折叠」。当前搜索筛出来的都展开了
  // 才算「全展」，此时按钮切成「全部折叠」。
  const allReviewExpanded =
    reviewRows.length > 0 && reviewRows.every((row) => expandedKeys.has(row.id));
  const toggleCardExpand = (id: string) => {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAllCards = () => {
    setExpandedKeys(
      allReviewExpanded ? new Set() : new Set(reviewRows.map((row) => row.id)),
    );
  };

  const lifecycleCounts = useMemo(
    () => ({
      pending: invoices.filter((item) => isInvoiceInPhase(item, "pending")).length,
      issuing: invoices.filter((item) => isInvoiceInPhase(item, "issuing")).length,
      history: invoices.filter((item) => isInvoiceInPhase(item, "history")).length,
      all: invoices.length,
    }),
    [invoices],
  );

  // 保存一格的改动：只发 {version, 该字段} 的最小 patch，后端 exclude_unset
  // 保证其余字段和明细一字不动；改 invoiceDate 会被后端重算期间/状态，行会自动
  // 归到新月份。乐观锁冲突或校验失败弹错并刷新一次，拿到最新 version 免反复 409。
  const commitCellEdit = async (row: TaxInvoice, field: EditableCellField) => {
    const trimmed = editingValue.trim();
    // 客户名后端要求非空：清空当撤销处理，不真发上去把名字抹掉。
    const next = trimmed === "" ? (field === "customerName" ? undefined : null) : trimmed;
    if (next === undefined) {
      setEditingCell(null);
      return;
    }
    if (next === ((row[field] as string | null) ?? null)) {
      setEditingCell(null);
      return;
    }
    setSavingCell(true);
    try {
      const updated = await updateTaxInvoice(row.id, {
        version: row.version,
        [field]: next,
      });
      setInvoices((current) =>
        current.map((invoice) => (invoice.id === updated.id ? updated : invoice)),
      );
      if (selected?.id === updated.id) setSelected(updated);
      setEditingCell(null);
      message.success(t("tax.editSaved"));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("tax.saveFailed"));
      void refreshInvoices();
    } finally {
      setSavingCell(false);
    }
  };

  // 一格的渲染：不可编辑（已批准/已开具等）就只显示；可编辑时值旁挂个铅笔，
  // 点开变成行内输入框。铅笔与输入框都 stopPropagation，免得连带触发整行点击（打开详情）。
  const renderEditableCell = (
    record: TaxInvoice,
    field: EditableCellField,
    display: ReactNode,
    inputType: "date" | "text",
  ): ReactNode => {
    if (!EDITABLE_STATUSES.has(record.status)) return display;
    const isEditing =
      editingCell?.id === record.id && editingCell.field === field;
    if (isEditing) {
      return (
        <span
          className="tax-cell-edit"
          onClick={(event) => event.stopPropagation()}
        >
          <Input
            autoFocus
            className={field === "customerName" ? "thai-input" : undefined}
            disabled={savingCell}
            size="small"
            type={inputType === "date" ? "date" : undefined}
            value={editingValue}
            onBlur={() => void commitCellEdit(record, field)}
            onChange={(event) => setEditingValue(event.target.value)}
            onPressEnter={() => void commitCellEdit(record, field)}
          />
        </span>
      );
    }
    return (
      <span className="tax-cell-editable">
        <span className="tax-cell-value">{display}</span>
        <button
          className="tax-cell-edit-btn"
          title={t("tax.editCell")}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setEditingCell({ id: record.id, field });
            setEditingValue((record[field] as string | null) ?? "");
          }}
        >
          <EditOutlined />
        </button>
      </span>
    );
  };

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
      render: (value: string | null, record) =>
        renderEditableCell(record, "invoiceDate", dateLabel(value), "date"),
    },
    { title: "C/I No.", dataIndex: "ciNo", width: 145, ellipsis: true },
    { title: t("tax.colCdn"), dataIndex: "cdn", width: 165, ellipsis: true },
    {
      title: t("tax.colCustomer"),
      dataIndex: "customerName",
      width: 260,
      ellipsis: true,
      filters: customerOptions.map((value) => ({ text: value, value })),
      filteredValue: colFilters.customerName.length ? colFilters.customerName : null,
      filterSearch: true,
      render: (value: string, record) =>
        renderEditableCell(record, "customerName", <ThaiText>{value}</ThaiText>, "text"),
    },
    {
      title: t("tax.colIncoterms"),
      dataIndex: "incoterms",
      width: 118,
      filters: incotermsOptions.map((value) => ({ text: value, value })),
      filteredValue: colFilters.incoterms.length ? colFilters.incoterms : null,
      render: (value: string | null, record) =>
        renderEditableCell(record, "incoterms", value ?? "—", "text"),
    },
    {
      title: t("tax.colRateDate"),
      dataIndex: "exchangeRateDate",
      width: 152,
      render: (value: string | null, record) =>
        renderEditableCell(record, "exchangeRateDate", dateLabel(value), "date"),
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

  // 列头筛选是受控的：把 antd 回传的选中值收进 colFilters，真正过滤在
  // filteredInvoices 里做。分组视图每段一张表都挂这个 handler，任意一张改都对全部生效。
  const onLedgerFilterChange: TableProps<TaxInvoice>["onChange"] = (
    _pagination,
    filters,
  ) => {
    setColFilters({
      customerName: (filters.customerName as string[] | null) ?? [],
      incoterms: (filters.incoterms as string[] | null) ?? [],
    });
  };

  // 按月分组第一层：每月一行，点行钻进那一月的全区域详情。
  const monthColumns: ColumnsType<MonthGroup> = [
    {
      title: t("tax.periodColumn"),
      dataIndex: "label",
      render: (value: string) => <strong className="tax-month-label">{value}</strong>,
    },
    {
      title: t("tax.countInvoices"),
      dataIndex: "rows",
      width: 120,
      align: "right",
      render: (rows: TaxInvoice[]) => rows.length,
    },
    {
      title: t("tax.countNeedsReview"),
      dataIndex: "needsReview",
      width: 120,
      align: "right",
      render: (value: number) =>
        value ? <span className="tax-month-review">{value}</span> : value,
    },
    {
      title: "FOB THB",
      dataIndex: "fobThbTotal",
      width: 190,
      align: "right",
      render: (value: string) => money(value, locale),
    },
    {
      title: "",
      dataIndex: "key",
      width: 56,
      align: "right",
      render: () => <RightOutlined className="tax-month-arrow" />,
    },
  ];

  // 复核台不再用扁平表：整批摊成对账卡（BatchReviewCard），逐行发票/报关单
  // FOB USD 并排。原 reviewColumns（末尾并排海关汇率/报关单 THB）已随之移除。

  // 单条批准：抽屉里的 selected 和复核卡上的任一张票都走这里。只动 invoices，
  // batchInvoices 由既有 effect 从 invoices 镜像回来；抽屉开着且是同一张才同步 selected。
  const approveInvoice = (target: TaxInvoice) => {
    const warnings = warningCount(target);
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
            target.id,
            target.version,
            warnings > 0,
          );
          setInvoices((current) =>
            current.map((invoice) => (invoice.id === updated.id ? updated : invoice)),
          );
          setSelected((current) => (current?.id === updated.id ? updated : current));
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

  const approveSelected = () => {
    if (selected) approveInvoice(selected);
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

  const matchRateInvoice = async (target: TaxInvoice) => {
    setBusy(true);
    try {
      const updated = await matchTaxInvoiceRate(target.id, target.version);
      setInvoices((current) =>
        current.map((invoice) => (invoice.id === updated.id ? updated : invoice)),
      );
      setSelected((current) => (current?.id === updated.id ? updated : current));
      message.success(
        t("tax.matchRateDone", {
          rate: updated.exchangeRate ? Number(updated.exchangeRate).toFixed(4) : "",
        }),
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("tax.matchRateFailed"));
    } finally {
      setBusy(false);
    }
  };

  const matchRateSelected = async () => {
    if (selected) await matchRateInvoice(selected);
  };

  const rejectInvoice = (target: TaxInvoice) => {
    modal.confirm({
      title: t("tax.rejectTitle"),
      content: t("tax.rejectBody"),
      okText: t("tax.reject"),
      okButtonProps: { danger: true },
      cancelText: t("common.cancel"),
      async onOk() {
        setBusy(true);
        try {
          const updated = await rejectTaxInvoice(target.id, target.version);
          setInvoices((current) =>
            current.map((invoice) => (invoice.id === updated.id ? updated : invoice)),
          );
          setSelected((current) => (current?.id === updated.id ? updated : current));
          message.success(t("tax.rejected"));
        } catch (error) {
          message.error(error instanceof Error ? error.message : t("tax.rejectFailed"));
          throw error;
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const rejectSelected = () => {
    if (selected) rejectInvoice(selected);
  };

  const restoreSelected = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const updated = await restoreTaxInvoice(selected.id, selected.version);
      setSelected(updated);
      setInvoices((current) =>
        current.map((invoice) => (invoice.id === updated.id ? updated : invoice)),
      );
      message.success(t("tax.restored"));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("tax.restoreFailed"));
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

  const openEdit = (target: TaxInvoice | null = selected) => {
    if (!target) return;
    setEditingInvoice(target);
    editForm.setFieldsValue({
      invoiceDate: target.invoiceDate,
      exchangeTargetDate: target.exchangeTargetDate,
      exchangeRateDate: target.exchangeRateDate,
      exchangeRate: target.exchangeRate ? Number(target.exchangeRate) : null,
      customerName: target.customerName,
      customerAddress: target.customerAddress,
      taxId: target.taxId,
      poNo: target.poNo,
      incoterms: target.incoterms,
      paymentTerm: target.paymentTerm,
      items: target.items.map((item) => ({
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
    if (!editingInvoice) return;
    const values = await editForm.validateFields();
    setBusy(true);
    try {
      const items = (values.items as Record<string, unknown>[]).map(
        (item, index) => ({
          ...item,
          lineNumber: index + 1,
        }),
      );
      const updated = await updateTaxInvoice(editingInvoice.id, {
        ...values,
        version: editingInvoice.version,
        items,
      });
      setInvoices((current) =>
        current.map((invoice) => (invoice.id === updated.id ? updated : invoice)),
      );
      // 抽屉开着且是同一张才同步；复核卡编辑时抽屉没开，别硬把它弹出来。
      setSelected((current) => (current?.id === updated.id ? updated : current));
      setEditOpen(false);
      message.success(t("tax.editSaved"));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("tax.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  /** 一次投放的整批文件按扩展名进两份清单。配对留到识别那一步。 */
  const acceptDualFiles = useCallback(
    (files: File[]) => {
      const { invoices, customs, unsupported, duplicated } = mergeDualFiles(
        dualQueue,
        files,
      );
      setDualQueue({ invoices, customs });
      // 队列变了，上一次的配对结果就过期了——留着会让人对着旧配对点导入。
      setDualIdentify(null);
      if (unsupported.length) {
        message.warning(t("tax.unsupportedFiles", { files: unsupported.join("、") }));
      }
      if (duplicated.length) {
        message.warning(t("tax.duplicateIgnored", { files: duplicated.join("、") }));
      }
    },
    [dualQueue, message, t],
  );

  const queuedCount = dualQueue.invoices.length + dualQueue.customs.length;

  /** 把整批文件发给后端认身份并配对。只读不写，不产生任何记录。 */
  const runIdentify = async () => {
    if (!queuedCount) {
      message.warning(t("tax.dualFilesRequired"));
      return;
    }
    setIdentifying(true);
    try {
      const result = await identifyDualFiles([
        ...dualQueue.invoices.map((item) => item.file),
        ...dualQueue.customs.map((item) => item.file),
      ]);
      setDualIdentify(result);
      // 上一轮导入残留的跳过/退回清单在这里清掉，免得配对预览里混着旧结果。
      setDualBatchResult(null);
      // 识别完直接进「核对匹配」步看配对结果——识别的产物就是这一步的输入。
      setWizardStep("reconcile");
      if (result.rejected.length) {
        message.warning(
          t("tax.identifyRejected", { count: result.rejected.length }),
        );
      }
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : t("tax.recognitionFailed"),
      );
    } finally {
      setIdentifying(false);
    }
  };

  /**
   * 可导入的组：有发票就能导。关单缺失也导——业务口径是先按发票开票，
   * 这张票停在"待补关单"，补到关单再回填。孤立关单（只有 PDF）导不了：
   * 报关单上没有商品明细和单价，凭它开不出一张税票。
   */
  const importablePairs = useMemo(
    () =>
      (dualIdentify?.pairs ?? []).filter(
        // conflict 组一律不导：同一 C/I No. 配到多份不同关单，选错就是拿作废的
        // 那版开成了税票，而且金额看着都合理，事后极难发现。
        (pair) => pair.invoice !== null && pair.status !== "conflict",
      ),
    [dualIdentify],
  );

  /**
   * 整批导入：把两份清单的全部文件一趟发给后端 /import/dual/batch，后端自己
   * 识别 + 按 C/I No. 配对 + 匹配汇率，整批落进同一个复核批次（不自动出编号，
   * 进复核台等人批准）。取代旧的「前端逐组串行调 /import/dual」：一个事务全进
   * 或全不进，撞上重复业务键整批 409，走冲突弹窗照错改。
   */
  const runDualImport = async () => {
    if (!importablePairs.length) {
      message.warning(t("tax.dualFilesRequired"));
      return;
    }
    setBusy(true);
    setDualBatchResult(null);
    // 整批发：孤立关单/冲突的文件也要一起给后端，它才配得出来（配不上的进 skipped）。
    const files = [
      ...dualQueue.invoices.map((item) => item.file),
      ...dualQueue.customs.map((item) => item.file),
    ];
    try {
      const result = await importDualBatch(files, currency);
      setDualBatchResult(result);

      // 真进库的那几对，把源文件从两份清单里摘掉——改完重跑不用重选。冲突/
      // 待补关单/读不了的留着，方便修好再来。识别预览里也同步摘掉已导入的组。
      const consumed = new Set<string>();
      for (const pair of result.results) {
        consumed.add(pair.invoiceFileName);
        if (pair.customsFileName) consumed.add(pair.customsFileName);
      }
      setDualQueue((current) => ({
        invoices: current.invoices.filter((item) => !consumed.has(item.file.name)),
        customs: current.customs.filter((item) => !consumed.has(item.file.name)),
      }));
      const importedKeys = new Set(result.results.map((pair) => pair.key));
      setDualIdentify((current) =>
        current
          ? {
              ...current,
              pairs: current.pairs.filter((pair) => !importedKeys.has(pair.key)),
              readyCount: current.pairs.filter(
                (pair) => !importedKeys.has(pair.key) && pair.status === "ready",
              ).length,
            }
          : current,
      );

      // 台账在后台刷新；跳过/退回的文件由复核步顶部的提示条继续显示，不静默丢。
      await refreshInvoices();
      if (result.batchId) {
        message.success(
          t("tax.batchDualDone", {
            invoices: result.invoiceCount,
            items: result.itemCount,
          }),
        );
        // 有可导入的组：直接进「汇总复核」步核对这一批。
        await enterBatchReview(result.batchId);
      } else {
        // 没有一对可导入：只有孤立关单/冲突/读不了的文件。留在核对步看提示条。
        message.warning(t("tax.batchDualNothing"));
      }
    } catch (error) {
      // 整批 409（重复业务键）：一条都不进，队列原样留着。逐行冲突用弹窗展示，
      // 塞进 message 会被截断也没法滚动。
      if (error instanceof TaxInvoiceApiError && error.issues.length) {
        setConflicts(error.issues);
      } else {
        message.error(
          error instanceof Error ? error.message : t("tax.recognitionFailed"),
        );
      }
    } finally {
      setBusy(false);
    }
  };

  /** 导入成功后直接进向导「汇总复核」步，并打开刚建成的这一批。 */
  const enterBatchReview = useCallback(
    async (batchId: string) => {
      setView("issue");
      setWizardStep("review");
      try {
        const list = await listImportBatches();
        setBatches(list);
        const target = list.find((batch) => batch.id === batchId);
        if (target) await openBatch(target);
      } catch {
        // 拉批次失败也没关系：进复核步后那个 effect 会自己再拉一次。
      }
    },
    [openBatch],
  );

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
      // Sample 没有配对/跳过清单，清掉上一次双流留下的结果，直接进复核步。
      setDualBatchResult(null);
      await refreshInvoices();
      await enterBatchReview(result.batchId);
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
      // 钻进某一月时导的必须只是那一月。后端按 revenue_period 相等过滤，
      // 所以直接把钻进的期数当 period 传；不传的话导出会悄悄变成全部期数，
      // 用户在「2026-02」这个页面上点导出却拿到全年，对不上账才会发现。
      await exportTaxInvoiceLedger({
        status,
        period: selectedMonth && selectedMonth !== "none" ? selectedMonth : period,
        query,
      });
      message.success(t("tax.exportDone"));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("tax.exportFailed"));
    } finally {
      setBusy(false);
    }
  };

  // 批量批准/拒批后：批次计数、对账表、台账全变了，一起刷新并清空勾选。
  // 这里直接取回批次清单（而不是只调 refreshBatches），好把选中批次的实时
  // 计数（待批准/已批准）也刷新——提交步的统计与「全部已完成」判定都靠它。
  const reloadAfterBatchAction = useCallback(async () => {
    const [freshBatches] = await Promise.all([
      listImportBatches(),
      refreshInvoices(),
    ]);
    setBatches(freshBatches);
    if (selectedBatch) {
      const updated = freshBatches.find((batch) => batch.id === selectedBatch.id);
      if (updated) setSelectedBatch(updated);
      try {
        const response = await listTaxInvoicesByBatch(selectedBatch.id);
        setBatchInvoices(response.items);
      } catch {
        // 对账表刷新失败不致命：批次列表和台账已更新，用户可手动重进这批。
      }
    }
    setReviewSelectedKeys([]);
  }, [refreshInvoices, selectedBatch]);

  const runBatchApprove = async (scope: "all" | "selected") => {
    if (!selectedBatch) return;
    if (scope === "selected" && !reviewSelectedKeys.length) {
      message.warning(t("tax.reviewSelectNone"));
      return;
    }
    setBusy(true);
    try {
      // acceptWarnings=false：有警告（DAP / FOB 不符 / 提交日低可信）的不在批量里
      // 静默批准，会被跳过并列出，交给用户逐条在详情里确认。
      const result = await approveTaxInvoiceBatch(
        selectedBatch.id,
        scope === "selected" ? reviewSelectedKeys : null,
        false,
      );
      if (result.skipped.length) {
        message.warning(
          t("tax.batchApprovePartial", {
            ok: result.approvedCount,
            skipped: result.skipped.length,
          }),
        );
      } else {
        message.success(t("tax.batchApproveDone", { count: result.approvedCount }));
      }
      await reloadAfterBatchAction();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("tax.approveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const runBatchReject = (scope: "all" | "selected") => {
    if (!selectedBatch) return;
    if (scope === "selected" && !reviewSelectedKeys.length) {
      message.warning(t("tax.reviewSelectNone"));
      return;
    }
    const batchId = selectedBatch.id;
    const ids = scope === "selected" ? reviewSelectedKeys : null;
    modal.confirm({
      title: t("tax.batchRejectTitle"),
      content: t("tax.batchRejectBody"),
      okText: t("tax.reject"),
      okButtonProps: { danger: true },
      cancelText: t("common.cancel"),
      async onOk() {
        setBusy(true);
        try {
          const result = await rejectTaxInvoiceBatch(batchId, ids);
          message.success(t("tax.batchRejectDone", { count: result.rejectedCount }));
          await reloadAfterBatchAction();
        } catch (error) {
          message.error(error instanceof Error ? error.message : t("tax.rejectFailed"));
          throw error;
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const runBatchExport = async () => {
    if (!selectedBatch) return;
    setBusy(true);
    try {
      await exportTaxInvoiceLedger({ batchId: selectedBatch.id });
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

  // 钻进某一月＝一个独立的整页视图，不是台账页里的一段。模块页头、子导航、
  // 生命周期页签、筛选栏全部让位，只留一条返回条，剩下的高度整块归表格。
  // 之前把它塞在台账页内，页头能堆到 400px 以上，表体被 .tax-ledger-main 的
  // overflow:hidden 截掉一半，怎么滚都只看得见一小片。
  const monthPage = view === "ledger" ? monthDetail : null;

  // 开票向导当前步索引；顶部步骤标与「上一步/下一步」都从这里取。
  const wizardIndex = WIZARD_ORDER.indexOf(wizardStep);
  const goStep = (step: WizardStep) => setWizardStep(step);
  // 从台账进开票：永远从第一步（选汇率）开新的一批，清掉上一轮的批次/详情选中。
  const startWizard = () => {
    setSelectedBatch(null);
    setSelected(null);
    setWizardStep("rate");
    setView("issue");
  };
  // 退出向导回台账：批次留在库里（台账可见、可再进复核），只清界面选中态。
  const exitWizard = () => {
    setSelectedBatch(null);
    setSelected(null);
    setView("ledger");
  };
  // 选中开票月是否已有 BOT 汇率数据（按当前币种）。
  const issueMonthRate = rateMonths.find((entry) =>
    sameMonth(entry.month, issueMonth),
  );

  return (
    <section
      className={monthPage ? "tax-workspace is-drilldown" : "tax-workspace"}
      aria-label={t("nav.taxInvoice")}
    >
      {monthPage ? (
        // 整页视图的唯一头部：返回 + 月份 + 该月汇总 + 就地搜索/刷新/导出。
        // 搜索仍写回同一个 query，所以筛完当月列表也跟着变。
        <header className="tax-drill-bar">
          <Button
            className="tax-drill-back"
            icon={<ArrowLeftOutlined />}
            type="text"
            onClick={() => {
              setSelectedMonth(null);
              setSelected(null);
            }}
          >
            {t("tax.monthBackToList")}
          </Button>
          <div className="tax-drill-title">
            <h1>{monthPage.label}</h1>
            <span>
              {t("tax.monthSummary", {
                total: monthPage.rows.length,
                review: monthPage.needsReview,
              })}
              {` · FOB THB ${money(monthPage.fobThbTotal, locale)}`}
            </span>
          </div>
          <Input.Search
            allowClear
            className="tax-drill-search"
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
          {/* 「无收入期间」那一组没有期数可传，后端过滤不出来，导出只会变成
              全部期数。与其导错，不如在这一组里禁用并说明。 */}
          <Tooltip
            title={
              monthPage.key === "none"
                ? t("tax.exportNoPeriodTip")
                : t("tax.exportLedgerTip")
            }
          >
            <Button
              disabled={monthPage.key === "none"}
              icon={<DownloadOutlined />}
              loading={busy}
              onClick={() => void runLedgerExport()}
            >
              {t("tax.exportLedger")}
            </Button>
          </Tooltip>
        </header>
      ) : view === "issue" ? (
        // 开票向导：顶部只留一条「返回台账 + 横向步骤标」的窄条，
        // 模块大标题与子导航全部让位——核对/复核内容才是这条流水线的主体。
        <header className="tax-wizard-bar">
          <Button
            className="tax-drill-back"
            icon={<ArrowLeftOutlined />}
            type="text"
            onClick={exitWizard}
          >
            {t("tax.wizardBackToLedger")}
          </Button>
          <Steps
            className="tax-wizard-steps"
            size="small"
            current={wizardIndex}
            items={[
              { title: t("tax.stepRate"), icon: <CalendarOutlined /> },
              { title: t("tax.stepImport"), icon: <ImportOutlined /> },
              { title: t("tax.stepReconcile"), icon: <FileSearchOutlined /> },
              { title: t("tax.stepReview"), icon: <AuditOutlined /> },
              { title: t("tax.stepSubmit"), icon: <SafetyCertificateOutlined /> },
            ]}
            // 步骤标只用于回看已过的步；往前只能靠每步自己的「下一步」，
            // 免得跳过汇率/导入直接落到没有数据的复核步。
            onChange={(next) => {
              if (next <= wizardIndex) goStep(WIZARD_ORDER[next]);
            }}
          />
        </header>
      ) : (
        <>
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

          {/* 三个平级入口：看（台账）/ 做（开票）/ 查（汇率中心）。 */}
          <nav className="workspace-subnav" aria-label={t("tax.navLabel")}>
            <button
              className={view === "ledger" ? "is-active" : ""}
              type="button"
              onClick={() => setView("ledger")}
            >
              <DatabaseOutlined />
              {t("tax.ledger")}
            </button>
            {/* 子导航只在台账/汇率两个视图出现；进「开票」后整条导航换成向导步骤标，
                所以这里的开票入口不需要 is-active 态。 */}
            <button className="" type="button" onClick={startWizard}>
              <FileDoneOutlined />
              {t("tax.issueNav")}
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
        </>
      )}

      {/* 钻进某一月：页头已经换成 .tax-drill-bar，这里只剩一张占满剩余高度的表。
          高度不再靠 calc(100vh - N) 猜，由 .tax-ledger-main 的 flex 链决定，
          scroll.y 只是 CSS 没生效时的兜底值。 */}
      {monthPage && (
        <div className="tax-ledger-layout">
          <main className="tax-ledger-main is-drill">
            <Table
              columns={columns}
              dataSource={monthPage.rows}
              loading={loading}
              pagination={false}
              rowClassName={(record) =>
                record.id === selected?.id ? "selected-table-row" : ""
              }
              rowKey="id"
              scroll={{ x: 1450, y: "calc(100vh - 130px)" }}
              size="middle"
              onChange={onLedgerFilterChange}
              onRow={(record) => ({
                onClick: () => void openInvoice(record.id),
              })}
            />
          </main>
        </div>
      )}

      {view === "ledger" && !monthPage && (
        <div className="tax-ledger-layout">
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
                setSelectedMonth(null);
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
              <Tooltip title={t("tax.groupByMonthTip")}>
                <Button
                  icon={<CalendarOutlined />}
                  type={groupByMonth ? "primary" : "default"}
                  onClick={() => {
                    setGroupByMonth((on) => !on);
                    setSelectedMonth(null);
                  }}
                >
                  {t("tax.groupByMonth")}
                </Button>
              </Tooltip>
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
            {/* 三个计数压成一行细条：原来是 58px 高的三宫格，跟上面生命周期页签
                的角标讲的是同一批数字，占着首屏却不多给一点信息。
                台账只负责「看」，批准要去批次复核，所以待复核数后面挂条明路。 */}
            <div className="tax-ledger-summary">
              <div>
                <strong>{filteredInvoices.length}</strong>
                <span>{t("tax.countInvoices")}</span>
              </div>
              <div>
                <strong>{needsReviewCount}</strong>
                <span>{t("tax.countNeedsReview")}</span>
                {needsReviewCount > 0 && (
                  <Button
                    className="tax-ledger-summary-link"
                    size="small"
                    type="link"
                    onClick={() => {
                      // 去开票向导的「汇总复核」步：不带具体批次，落到批次列表自己挑。
                      setSelectedMonth(null);
                      setSelected(null);
                      setSelectedBatch(null);
                      setWizardStep("review");
                      setView("issue");
                    }}
                  >
                    {t("tax.ledgerGotoReview")}
                  </Button>
                )}
              </div>
              <div>
                <strong>
                  {filteredInvoices.filter((item) => item.status === "issued").length}
                </strong>
                <span>{t("tax.countIssued")}</span>
              </div>
            </div>
            {groupByMonth ? (
              // 第一层：每月一行（期间 / 张数 / 待复核 / FOB THB 小计），点行钻进整页详情。
              <Table<MonthGroup>
                className="tax-month-list"
                columns={monthColumns}
                dataSource={ledgerGroups}
                loading={loading}
                pagination={false}
                rowKey="key"
                scroll={{ y: "calc(100vh - 340px)" }}
                size="middle"
                locale={{ emptyText: <Empty description={t("tax.ledgerEmpty")} /> }}
                onRow={(group) => ({
                  onClick: () => setSelectedMonth(group.key),
                })}
              />
            ) : (
              <Table
                columns={columns}
                dataSource={filteredInvoices}
                loading={loading}
                pagination={{ pageSize: 15, showSizeChanger: false }}
                rowClassName={(record) =>
                  record.id === selected?.id ? "selected-table-row" : ""
                }
                rowKey="id"
                scroll={{ x: 1450, y: "calc(100vh - 340px)" }}
                size="middle"
                onChange={onLedgerFilterChange}
                onRow={(record) => ({
                  onClick: () => void openInvoice(record.id),
                })}
              />
            )}
          </main>
        </div>
      )}

      {view === "issue" && wizardStep === "rate" && (
        <div className="tax-wizard-body">
          <main className="tax-wizard-panel">
            <p className="tax-rule-note">
              <SafetyCertificateOutlined />
              <span>{t("tax.stepRateNote")}</span>
            </p>
            <section className="tax-tool-card">
              <div className="tool-card-heading">
                <div className="tool-card-icon copper">
                  <CalendarOutlined />
                </div>
                <div>
                  <span>{t("tax.stepRate")}</span>
                  <h2>{t("tax.rateStepTitle")}</h2>
                  <p>{t("tax.rateStepHint")}</p>
                </div>
              </div>
              <div className="tax-rate-picker">
                <label className="date-field">
                  <span>{t("tax.issueMonth")}</span>
                  <Input
                    type="month"
                    value={issueMonth}
                    onChange={(event) => setIssueMonth(event.target.value)}
                  />
                </label>
                <label className="date-field">
                  <span>{t("tax.currency")}</span>
                  <Select
                    options={(currencies.length ? currencies : ["USD"]).map(
                      (code) => ({ value: code, label: code }),
                    )}
                    showSearch
                    value={currency}
                    onChange={setCurrency}
                  />
                </label>
              </div>
              {/* 当月汇率是否就绪：就绪→绿条报天数；缺→黄条给两条入库入口。 */}
              {rateMonthsLoading ? (
                <p className="tax-inline-note">
                  <Spin size="small" />
                  <span>{t("tax.rateChecking")}</span>
                </p>
              ) : issueMonthRate ? (
                <Alert
                  showIcon
                  type="success"
                  title={t("tax.rateReady", {
                    month: issueMonth,
                    days: issueMonthRate.dayCount,
                  })}
                  description={t("tax.rateReadyBody")}
                />
              ) : (
                <Alert
                  showIcon
                  type="warning"
                  title={t("tax.rateMissing", { month: issueMonth })}
                  description={t("tax.rateMissingBody")}
                />
              )}
              <div className="tax-rate-actions">
                <Button
                  disabled={!canWriteRates}
                  icon={<ApiOutlined />}
                  onClick={() => setFetchOpen(true)}
                >
                  {t("tax.syncFromBot")}
                </Button>
                <Upload
                  accept=".xlsx,.xls"
                  disabled={!canWriteRates}
                  beforeUpload={(file) => {
                    setRateFile(file);
                    return false;
                  }}
                  fileList={uploadList(rateFile)}
                  maxCount={1}
                  onRemove={() => setRateFile(null)}
                >
                  <Button icon={<FileExcelOutlined />}>{t("tax.pickBotExcel")}</Button>
                </Upload>
                {rateFile && (
                  <Button
                    disabled={!canWriteRates}
                    loading={busy}
                    type="primary"
                    onClick={() => void runRateImport()}
                  >
                    {t("tax.importPicked")}
                  </Button>
                )}
              </div>
            </section>
            <div className="tax-wizard-foot">
              <span className="tax-wizard-foot-spacer" />
              <Button
                icon={<RightOutlined />}
                iconPosition="end"
                type="primary"
                onClick={() => goStep("import")}
              >
                {t("tax.wizardNextImport")}
              </Button>
            </div>
          </main>
        </div>
      )}

      {view === "issue" && wizardStep === "import" && (
        <div className="tax-wizard-body">
          <main className="tax-wizard-panel">
            <p className="tax-rule-note">
              <SafetyCertificateOutlined />
              <span>{t("tax.dateGovernance")}</span>
            </p>
            {/* 两种开票方式二选一：发票+报关单双流识别，或 Sample 表格批量。 */}
            <Segmented
              className="tax-issue-methods"
              block
              value={issueMethod}
              onChange={(value) => setIssueMethod(value as IssueMethod)}
              options={[
                {
                  value: "dual",
                  label: (
                    <span className="tax-method-opt">
                      <FileSearchOutlined />
                      {t("tax.methodDual")}
                    </span>
                  ),
                },
                {
                  value: "sample",
                  label: (
                    <span className="tax-method-opt">
                      <TableOutlined />
                      {t("tax.methodSample")}
                    </span>
                  ),
                },
              ]}
            />

            {issueMethod === "dual" ? (
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
                <Upload.Dragger
                  accept=".xlsx,.xls,.pdf"
                  className="dual-drop-zone"
                  beforeUpload={(file, batch) => {
                    if (file === batch[0]) acceptDualFiles(batch);
                    return false;
                  }}
                  fileList={[]}
                  multiple
                  showUploadList={false}
                  onDrop={(event) => {
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
                {queuedCount > 0 && (
                  <div className="dual-queue">
                    <div className="dual-queue-head">
                      <h3>
                        {t("tax.fileQueue")}
                        <span>
                          {t("tax.fileQueueCount", {
                            excel: dualQueue.invoices.length,
                            pdf: dualQueue.customs.length,
                          })}
                        </span>
                      </h3>
                      <Button
                        size="small"
                        type="text"
                        onClick={() => {
                          setDualQueue({ invoices: [], customs: [] });
                          setDualIdentify(null);
                        }}
                      >
                        {t("tax.pairClearAll")}
                      </Button>
                    </div>
                    <div className="dual-file-columns">
                      <QueueColumn
                        files={dualQueue.invoices}
                        icon={<FileExcelOutlined />}
                        title={t("tax.queueExcel")}
                        onRemove={(id) => {
                          setDualQueue((current) => ({
                            ...current,
                            invoices: current.invoices.filter(
                              (item) => item.id !== id,
                            ),
                          }));
                          setDualIdentify(null);
                        }}
                      />
                      <QueueColumn
                        files={dualQueue.customs}
                        icon={<FilePdfOutlined />}
                        title={t("tax.queuePdf")}
                        onRemove={(id) => {
                          setDualQueue((current) => ({
                            ...current,
                            customs: current.customs.filter(
                              (item) => item.id !== id,
                            ),
                          }));
                          setDualIdentify(null);
                        }}
                      />
                    </div>
                  </div>
                )}
              </section>
            ) : (
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
                  onRemove={() => setSampleFile(null)}
                >
                  <p className="ant-upload-drag-icon">
                    <FileExcelOutlined />
                  </p>
                  <p className="ant-upload-text">{t("tax.pickSample")}</p>
                  <p className="ant-upload-hint">{t("tax.samplePickHint")}</p>
                </Upload.Dragger>
                <p className="tax-inline-note">
                  <WarningOutlined />
                  <span>
                    <strong>{t("tax.sampleWarning")}</strong>
                    {t("tax.sampleWarningBody")}
                  </span>
                </p>
              </section>
            )}

            <div className="tax-wizard-foot">
              <Button icon={<ArrowLeftOutlined />} onClick={() => goStep("rate")}>
                {t("tax.wizardPrev")}
              </Button>
              <span className="tax-wizard-foot-spacer" />
              {issueMethod === "dual" ? (
                <Button
                  disabled={!queuedCount}
                  icon={<FileSearchOutlined />}
                  loading={identifying}
                  type="primary"
                  onClick={() => void runIdentify()}
                >
                  {t("tax.identifyAndPair", { count: queuedCount })}
                </Button>
              ) : (
                <Button
                  disabled={!sampleFile}
                  icon={<RightOutlined />}
                  iconPosition="end"
                  type="primary"
                  onClick={() => goStep("reconcile")}
                >
                  {t("tax.wizardNextReconcile")}
                </Button>
              )}
            </div>
          </main>
        </div>
      )}

      {view === "issue" && wizardStep === "reconcile" && (
        <div className="tax-wizard-body">
          <main className="tax-wizard-panel is-wide">
            {issueMethod === "dual" ? (
              !dualIdentify ? (
                <Empty description={t("tax.reconcileNoIdentify")}>
                  <Button type="primary" onClick={() => goStep("import")}>
                    {t("tax.wizardPrev")}
                  </Button>
                </Empty>
              ) : (
                <>
                  <div className="tax-review-head">
                    <div>
                      <h2>{t("tax.reconcileTitle")}</h2>
                      <p>
                        {t("tax.pairSummary", {
                          ready: dualIdentify.readyCount,
                          invoiceOnly: dualIdentify.invoiceOnlyCount,
                          customsOnly: dualIdentify.customsOnlyCount,
                          conflict: dualIdentify.conflictCount,
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="tax-reconcile-scroll">
                    {/* 三种「要注意」压成一条状态条：原来是三块整幅 Alert 叠在一起，
                        单是标题+说明就吃掉两百多像素首屏，而它们讲的其实只是三个数。
                        每类的详细说明挂在 title 上（悬停可看），每一组具体因为什么
                        不能导，配对行自己那行红字已经写了，不必在顶部重复一遍。 */}
                    {(dualIdentify.conflictCount > 0 ||
                      dualIdentify.invoiceOnlyCount > 0 ||
                      dualIdentify.rejected.length > 0) && (
                      <div className="tax-triage-bar">
                        {dualIdentify.conflictCount > 0 && (
                          <span
                            className="tax-triage-chip is-danger"
                            title={t("tax.pairConflictBody")}
                          >
                            <CloseCircleOutlined />
                            {t("tax.pairConflict", {
                              count: dualIdentify.conflictCount,
                            })}
                          </span>
                        )}
                        {dualIdentify.invoiceOnlyCount > 0 && (
                          <span
                            className="tax-triage-chip is-info"
                            title={t("tax.pairInvoiceOnlyBody")}
                          >
                            <InfoCircleOutlined />
                            {t("tax.pairInvoiceOnly", {
                              count: dualIdentify.invoiceOnlyCount,
                            })}
                          </span>
                        )}
                        {dualIdentify.rejected.length > 0 && (
                          <span className="tax-triage-chip is-warning">
                            <WarningOutlined />
                            {t("tax.identifyRejected", {
                              count: dualIdentify.rejected.length,
                            })}
                          </span>
                        )}
                      </div>
                    )}
                    {/* 读不进来的文件：文件名 + 原因必须看得见（不能只挂 tooltip，
                        那等于把原因藏起来）。压成每份一行的小字，一份约 18px，
                        比原来那块整幅 Alert 省掉七成高度，但话说全了。 */}
                    {dualIdentify.rejected.length > 0 && (
                      <ul className="dual-reject-list is-compact">
                        {dualIdentify.rejected.map((item) => (
                          <li key={`${item.kind}-${item.fileName}`}>
                            <b>{item.fileName}</b>：{item.reason}
                          </li>
                        ))}
                      </ul>
                    )}
                    <ol className="dual-pair-list">
                      {dualIdentify.pairs.map((pair, index) => (
                        <DualPairRow
                          index={index + 1}
                          key={pair.key}
                          pair={pair}
                          t={t}
                        />
                      ))}
                    </ol>
                  </div>
                  <div className="tax-wizard-foot">
                    <Button
                      icon={<ArrowLeftOutlined />}
                      onClick={() => goStep("import")}
                    >
                      {t("tax.wizardPrev")}
                    </Button>
                    <span className="tax-wizard-foot-spacer" />
                    <Button
                      disabled={!importablePairs.length}
                      icon={<ImportOutlined />}
                      loading={busy}
                      type="primary"
                      onClick={() => void runDualImport()}
                    >
                      {importablePairs.length > 1
                        ? t("tax.confirmImportBatch", {
                            count: importablePairs.length,
                          })
                        : t("tax.confirmImport")}
                    </Button>
                  </div>
                </>
              )
            ) : !sampleFile ? (
              <Empty description={t("tax.reconcileNoSample")}>
                <Button type="primary" onClick={() => goStep("import")}>
                  {t("tax.wizardPrev")}
                </Button>
              </Empty>
            ) : (
              <>
                <div className="tax-review-head">
                  <div>
                    <h2>{t("tax.reconcileSampleTitle")}</h2>
                    <p>{t("tax.reconcileSampleHint")}</p>
                  </div>
                </div>
                <div className="tax-reconcile-scroll">
                  <section className="tax-tool-card tax-column-card">
                    <div className="tool-card-heading">
                      <div className="tool-card-icon copper">
                        <FileExcelOutlined />
                      </div>
                      <div>
                        <span>{t("tax.batchColumns")}</span>
                        <h2>{sampleFile.name}</h2>
                        <p>{t("tax.batchColumnsHint")}</p>
                      </div>
                    </div>
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
                <div className="tax-wizard-foot">
                  <Button
                    icon={<ArrowLeftOutlined />}
                    onClick={() => goStep("import")}
                  >
                    {t("tax.wizardPrev")}
                  </Button>
                  <span className="tax-wizard-foot-spacer" />
                  <Button
                    icon={<ImportOutlined />}
                    loading={busy}
                    type="primary"
                    onClick={() => void runSampleImport()}
                  >
                    {t("tax.runSampleImport")}
                  </Button>
                </div>
              </>
            )}
          </main>
        </div>
      )}

      {view === "issue" && wizardStep === "review" && (
        <div className="tax-ledger-layout">
          <main className="tax-ledger-main">
            {!selectedBatch ? (
              <>
                <div className="tax-review-head">
                  <div>
                    <h2>{t("tax.reviewBatches")}</h2>
                    <p>{t("tax.reviewBatchesHint")}</p>
                  </div>
                  <Button
                    icon={<ReloadOutlined />}
                    loading={batchesLoading}
                    onClick={() => void refreshBatches()}
                  >
                    {t("common.refresh")}
                  </Button>
                </div>
                <Table<ImportBatch>
                  columns={[
                    {
                      title: t("tax.reviewBatchFiles"),
                      dataIndex: "sourceFileNames",
                      ellipsis: true,
                      render: (value: string) => <span title={value}>{value}</span>,
                    },
                    {
                      title: t("tax.reviewBatchMode"),
                      dataIndex: "importMode",
                      width: 96,
                    },
                    {
                      title: t("tax.reviewBatchTotal"),
                      dataIndex: "total",
                      width: 72,
                      align: "right",
                    },
                    {
                      // 列头用「需复核」跟状态标签同词；「待人工复核」是台账
                      // 汇总条那一层的说法，塞进列头既长又对不上标签。
                      title: t("tax.reviewBatchNeedsReview"),
                      dataIndex: "needsReview",
                      width: 88,
                      align: "right",
                    },
                    {
                      title: t("tax.reviewBatchApproved"),
                      dataIndex: "approved",
                      width: 88,
                      align: "right",
                    },
                    {
                      title: t("tax.reviewBatchCreated"),
                      dataIndex: "createdAt",
                      width: 150,
                      render: (value: string) => dateTime(value, locale),
                    },
                  ]}
                  dataSource={batches}
                  loading={batchesLoading}
                  pagination={{ pageSize: 12, showSizeChanger: false }}
                  rowKey="id"
                  size="middle"
                  onRow={(record) => ({ onClick: () => void openBatch(record) })}
                  locale={{ emptyText: <Empty description={t("tax.reviewNoBatches")} /> }}
                />
              </>
            ) : (
              <>
                <div className="tax-review-head">
                  <div>
                    <Button
                      className="tax-review-back"
                      size="small"
                      type="link"
                      onClick={() => {
                        setSelectedBatch(null);
                        setSelected(null);
                      }}
                    >
                      ← {t("tax.reviewBackToList")}
                    </Button>
                    <h2 title={selectedBatch.sourceFileNames}>
                      {selectedBatch.sourceFileNames}
                    </h2>
                    <p>
                      {t("tax.reviewBatchSummary", {
                        total: selectedBatch.total,
                        pending: selectedBatch.pending,
                        approved: selectedBatch.approved,
                      })}
                    </p>
                  </div>
                  {/* 批完这一批就该回台账按月核对：两个视图是同一批记录的两条轴
                      （批次＝来源与出号闸门，台账＝收入期间与申报口径），
                      给条明路，别让用户自己回子导航找。 */}
                  <Button
                    icon={<DatabaseOutlined />}
                    onClick={() => {
                      setSelectedBatch(null);
                      setSelected(null);
                      setSelectedMonth(null);
                      setView("ledger");
                    }}
                  >
                    {t("tax.reviewGotoLedger")}
                  </Button>
                </div>
                {/* 复核步只管「看清、剔错」：搜索/展开/导出 + 拒批坏的那几张。
                    批准并出号是下一步（提交开具）的事，不在这一层动。 */}
                <div className="tax-review-actions">
                  <Input.Search
                    allowClear
                    placeholder={t("tax.searchPlaceholder")}
                    value={reviewQuery}
                    onChange={(event) => setReviewQuery(event.target.value)}
                  />
                  <span className="tax-review-spacer" />
                  <Button
                    icon={
                      allReviewExpanded ? <ShrinkOutlined /> : <ArrowsAltOutlined />
                    }
                    onClick={toggleAllCards}
                  >
                    {allReviewExpanded
                      ? t("tax.reviewCollapseAll")
                      : t("tax.reviewExpandAll")}
                  </Button>
                  <Button
                    icon={<DownloadOutlined />}
                    loading={busy}
                    onClick={() => void runBatchExport()}
                  >
                    {t("tax.reviewExport")}
                  </Button>
                  <Button
                    danger
                    disabled={busy || !reviewRows.length}
                    onClick={() =>
                      runBatchReject(reviewSelectedKeys.length ? "selected" : "all")
                    }
                  >
                    {reviewSelectedKeys.length
                      ? t("tax.reviewRejectSelected", { count: reviewSelectedKeys.length })
                      : t("tax.reviewRejectAll")}
                  </Button>
                  <Button
                    disabled={selectedBatch.pending === 0}
                    icon={<RightOutlined />}
                    iconPosition="end"
                    type="primary"
                    onClick={() => goStep("submit")}
                  >
                    {t("tax.wizardNextSubmit")}
                  </Button>
                </div>
                {/* 导入时没进库的文件（孤立关单/冲突/读不了）——绝不静默丢，
                    在复核步顶部照原因列出，方便修好再回上一步重导。 */}
                {dualBatchResult &&
                  (dualBatchResult.skipped.length > 0 ||
                    dualBatchResult.rejected.length > 0) && (
                    <div className="tax-triage-bar is-inset is-stacked">
                      <span className="tax-triage-chip is-warning">
                        <WarningOutlined />
                        {t("tax.reviewImportPartial", {
                          skipped: dualBatchResult.skipped.length,
                          rejected: dualBatchResult.rejected.length,
                        })}
                      </span>
                      {/* 原因逐条写出来（小字一行一条），别让用户去猜少了什么。 */}
                      <ul className="dual-reject-list is-compact">
                        {dualBatchResult.skipped.map((item) => (
                          <li key={item.key}>{item.reason}</li>
                        ))}
                        {dualBatchResult.rejected.map((item) => (
                          <li key={item.fileName}>
                            <b>{item.fileName}</b>：{item.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                {/* 整批摊成一列对账卡：每张票直接展开审，逐条批准/拒批就在卡上，
                    不用点行开抽屉再关。卡片流融进 .tax-ledger-main 的 flex 链，
                    自身滚动（外层 overflow:hidden 兜底）。 */}
                {batchInvoicesLoading ? (
                  <div className="tax-review-cards is-status">
                    <Spin />
                  </div>
                ) : reviewRows.length === 0 ? (
                  <div className="tax-review-cards is-status">
                    <Empty description={t("tax.reviewNoInvoices")} />
                  </div>
                ) : (
                  <div className="tax-review-cards">
                    {reviewRows.map((invoice) => (
                      <BatchReviewCard
                        busy={busy}
                        expanded={expandedKeys.has(invoice.id)}
                        invoice={invoice}
                        key={invoice.id}
                        locale={locale}
                        selectable={["draft", "needs_review", "ready"].includes(
                          invoice.status,
                        )}
                        selected={reviewSelectedKeys.includes(invoice.id)}
                        t={t}
                        onApprove={() => approveInvoice(invoice)}
                        onEdit={() => openEdit(invoice)}
                        onMatchRate={() => void matchRateInvoice(invoice)}
                        onOpenDrawer={() => void openInvoice(invoice.id)}
                        onReject={() => rejectInvoice(invoice)}
                        onToggle={() => toggleCardExpand(invoice.id)}
                        onToggleSelect={(checked) =>
                          setReviewSelectedKeys((current) =>
                            checked
                              ? [...current, invoice.id]
                              : current.filter((id) => id !== invoice.id),
                          )
                        }
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </main>
        </div>
      )}

      {view === "issue" && wizardStep === "submit" && (
        <div className="tax-wizard-body">
          <main className="tax-wizard-panel">
            {!selectedBatch ? (
              <Empty description={t("tax.submitNoBatch")}>
                <Button type="primary" onClick={() => goStep("review")}>
                  {t("tax.wizardPrev")}
                </Button>
              </Empty>
            ) : selectedBatch.pending > 0 ? (
              <section className="tax-tool-card tax-submit-card">
                <div className="tool-card-heading">
                  <div className="tool-card-icon copper">
                    <SafetyCertificateOutlined />
                  </div>
                  <div>
                    <span>{t("tax.stepSubmit")}</span>
                    <h2>{t("tax.submitTitle")}</h2>
                    <p>{t("tax.submitHint")}</p>
                  </div>
                </div>
                <div className="tax-submit-stats">
                  <div>
                    <strong>{selectedBatch.total}</strong>
                    <span>{t("tax.reviewBatchTotal")}</span>
                  </div>
                  <div>
                    <strong>{selectedBatch.pending}</strong>
                    <span>{t("tax.submitPending")}</span>
                  </div>
                  <div>
                    <strong>{selectedBatch.approved}</strong>
                    <span>{t("tax.reviewBatchApproved")}</span>
                  </div>
                </div>
                {/* 批准即在同一事务里生成正式编号并落 issued。带警告的（DAP /
                    FOB 不符 / 提交日低可信）不在整批里静默出号，会被跳过并列出，
                    回上一步逐条改或拒批。 */}
                <Alert
                  showIcon
                  type="info"
                  title={t("tax.submitFlaggedNote")}
                  description={t("tax.submitFlaggedBody")}
                />
                <div className="tax-wizard-foot">
                  <Button
                    icon={<ArrowLeftOutlined />}
                    onClick={() => goStep("review")}
                  >
                    {t("tax.wizardPrev")}
                  </Button>
                  <span className="tax-wizard-foot-spacer" />
                  <Button
                    danger
                    disabled={busy}
                    onClick={() => runBatchReject("all")}
                  >
                    {t("tax.reviewRejectAll")}
                  </Button>
                  <Button
                    icon={<SafetyCertificateOutlined />}
                    loading={busy}
                    type="primary"
                    onClick={() => void runBatchApprove("all")}
                  >
                    {t("tax.submitApproveAll")}
                  </Button>
                </div>
              </section>
            ) : (
              // 全部已批准出号：这一批开票完成，给回台账 / 再开一批两条出路。
              <section className="tax-tool-card tax-submit-done">
                <div className="tax-submit-done-mark">
                  <CheckCircleOutlined />
                </div>
                <h2>{t("tax.submitDoneTitle")}</h2>
                <p>{t("tax.submitDoneBody", { count: selectedBatch.approved })}</p>
                <div className="tax-wizard-foot is-center">
                  <Button
                    icon={<DatabaseOutlined />}
                    onClick={() => {
                      setSelectedBatch(null);
                      setSelected(null);
                      setSelectedMonth(null);
                      setView("ledger");
                    }}
                  >
                    {t("tax.reviewGotoLedger")}
                  </Button>
                  <Button
                    icon={<FileDoneOutlined />}
                    type="primary"
                    onClick={startWizard}
                  >
                    {t("tax.submitNewBatch")}
                  </Button>
                </div>
              </section>
            )}
          </main>
        </div>
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

      {/* 详情统一走右侧抽屉：台账和复核台点行都开它，宽度足够看清所有字段和明细，
          不再挤在窄侧栏或叠在表格下面。抽屉自带遮罩/ESC，InvoiceInspector 保留自己的
          头部（含关闭/编辑），所以 closable=false 免得两个关闭按钮。 */}
      <Drawer
        classNames={{ body: "tax-inspector-drawer-body" }}
        closable={false}
        open={!!selected}
        title={null}
        width={680}
        onClose={() => setSelected(null)}
      >
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
            onEdit={() => openEdit()}
            onGenerate={() => void generateSelected()}
            onMatchRate={() => void matchRateSelected()}
            onReject={rejectSelected}
            onRestore={() => void restoreSelected()}
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
      </Drawer>

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
