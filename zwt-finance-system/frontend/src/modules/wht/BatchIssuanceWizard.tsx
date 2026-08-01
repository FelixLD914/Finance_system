import { useMemo, useState } from "react";
import {
  ArrowLeftOutlined,
  CheckCircleFilled,
  FileExcelOutlined,
  UploadOutlined,
  UserAddOutlined,
} from "@ant-design/icons";
import {
  App as AntApp,
  Button,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Steps,
  Table,
  Tag,
  Upload,
} from "antd";
import type { ColumnsType } from "antd/es/table";

import type { Translate } from "../../i18n";
import { ApiError } from "../../shared/http";
import { ThaiText } from "../../shared/ThaiText";
import { downloadBatchTemplate } from "./api";
import {
  type EditableRow,
  type RowIssue,
  applyPayeeToRows,
  deriveRowState,
  toEditableRow,
} from "./batchRowState";
import type {
  BatchCommitInput,
  BatchCreateResult,
  BatchPreviewResult,
  BatchRowStatus,
  IncomeTypeOption,
  WhtType,
} from "./types";

interface BatchIssuanceWizardProps {
  t: Translate;
  incomeTypes: IncomeTypeOption[];
  pending: boolean;
  /** 三个平行视图的页签由 workspace 统一渲染，这里只负责摆位置。 */
  viewSwitch: React.ReactNode;
  onPreview: (file: File) => Promise<BatchPreviewResult>;
  onCommit: (input: BatchCommitInput) => Promise<BatchCreateResult>;
  onBackToLedger: () => void;
}

type Step = "upload" | "review" | "done";

const statusTone: Record<BatchRowStatus, string> = {
  ready: "status-approved",
  payee_missing: "status-pending",
  needs_input: "status-draft",
};

function statusLabel(status: BatchRowStatus, t: Translate): string {
  return {
    ready: t("wht.rowReady"),
    payee_missing: t("wht.rowPayeeMissing"),
    needs_input: t("wht.rowNeedsInput"),
  }[status];
}

/** 问题码 → 当前语言的文案。判定在 batchRowState，措辞在这里。 */
function issueText(issue: RowIssue, t: Translate): string {
  switch (issue.code) {
    case "payeeMissing":
      return t("wht.issuePayeeMissing", { taxId: issue.taxId });
    case "payeeInactive":
      return t("wht.issuePayeeInactive", { name: issue.name });
    case "rateRequired":
      return t("wht.issueRateRequired", {
        incomeType: issue.incomeType,
        whtType: issue.whtType,
      });
    case "rateReasonRequired":
      return t("wht.issueRateReason", {
        rate: issue.rate,
        statutory: issue.statutory,
      });
  }
}

function formatMoney(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatRate(rate: number | null): string {
  return rate === null ? "—" : `${(rate * 100).toFixed(2)}%`;
}

/**
 * 批量开具向导：上传 → 核对 → 完成。
 *
 * 与原来的一步式导入的根本差别在中间那一步：解析结果先摊开给人核对，主数据里没有的
 * 收款方在这里手工补录，而不是整张表退回让人回 Excel 里改。补录的资料跟着草稿走，
 * 等票据批准时才写进收款方主数据 —— 没走到批准的草稿不会污染主数据。
 */
export function BatchIssuanceWizard({
  t,
  incomeTypes,
  pending,
  viewSwitch,
  onPreview,
  onCommit,
  onBackToLedger,
}: BatchIssuanceWizardProps) {
  const { message, modal } = AntApp.useApp();
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [sourceFileName, setSourceFileName] = useState("");
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BatchCreateResult | null>(null);
  /** 正在补录的税号。同税号的所有行共用一份资料，所以按税号而不是按行开框。 */
  const [payeeTaxId, setPayeeTaxId] = useState<string | null>(null);
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [payeeForm] = Form.useForm();
  const [rowForm] = Form.useForm();

  const states = useMemo(
    () => rows.map((row) => deriveRowState(row, incomeTypes)),
    [incomeTypes, rows],
  );
  const counts = useMemo(
    () => ({
      total: states.length,
      ready: states.filter((state) => state.status === "ready").length,
      missing: states.filter((state) => state.status === "payee_missing").length,
      invalid: states.filter((state) => state.status === "needs_input").length,
    }),
    [states],
  );
  const blocked = counts.total - counts.ready;

  const stateOf = (rowNumber: number) => {
    const index = rows.findIndex((row) => row.rowNumber === rowNumber);
    return index === -1 ? null : states[index];
  };

  const readFile = async () => {
    if (!file) return;
    try {
      setBusy(true);
      const preview = await onPreview(file);
      setRows(preview.rows.map(toEditableRow));
      setSourceFileName(preview.sourceFileName);
      setStep("review");
    } catch (previewError) {
      // 结构性问题（缺列、日期格式不对）在解析阶段就整表退回：这类错误改 Excel 比
      // 在界面上一行行改快，也没必要为一张读不出来的表渲染核对页。
      if (previewError instanceof ApiError && previewError.details.length > 0) {
        modal.error({
          title: t("wht.batchImportRejected"),
          width: 620,
          content: (
            <ul className="import-error-list">
              {previewError.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          ),
        });
        return;
      }
      if (previewError instanceof Error) message.error(previewError.message);
    } finally {
      setBusy(false);
    }
  };

  const openPayeeForm = (taxId: string) => {
    const row = rows.find((item) => item.payee.taxId === taxId);
    payeeForm.setFieldsValue({
      nameTh: row?.payee.nameTh ?? "",
      nameEn: row?.payee.nameEn ?? "",
      addressTh: row?.payee.addressTh ?? "",
      whtType: row?.payee.whtType ?? undefined,
    });
    setPayeeTaxId(taxId);
  };

  const savePayeeProfile = async () => {
    if (!payeeTaxId) return;
    try {
      const values = await payeeForm.validateFields();
      setRows((current) =>
        applyPayeeToRows(current, payeeTaxId, {
          nameTh: values.nameTh.trim(),
          nameEn: values.nameEn?.trim() || null,
          addressTh: values.addressTh.trim(),
          whtType: values.whtType as WhtType,
        }),
      );
      setPayeeTaxId(null);
    } catch {
      // validateFields 的 reject 不是 Error，表单自己已经把错误标在字段上了。
    }
  };

  const openRowForm = (rowNumber: number) => {
    const row = rows.find((item) => item.rowNumber === rowNumber);
    const state = stateOf(rowNumber);
    rowForm.setFieldsValue({
      // 表单按百分数收，落库前再除回小数——与单张开具的税率框口径一致。
      whtRate:
        state?.effectiveRate == null ? undefined : Number((state.effectiveRate * 100).toFixed(2)),
      rateReason: row?.rateReason ?? "",
    });
    setEditingRow(rowNumber);
  };

  const saveRow = async () => {
    if (editingRow === null) return;
    try {
      const values = await rowForm.validateFields();
      setRows((current) =>
        current.map((row) =>
          row.rowNumber === editingRow
            ? {
                ...row,
                whtRate: values.whtRate == null ? null : values.whtRate / 100,
                rateReason: values.rateReason?.trim() || null,
              }
            : row,
        ),
      );
      setEditingRow(null);
    } catch {
      // 同上：校验没过时表单已经把错误标在字段上。
    }
  };

  const commit = async () => {
    try {
      setBusy(true);
      const created = await onCommit({
        sourceFileName,
        rows: rows.map((row, index) => ({
          rowNumber: row.rowNumber,
          period: row.period,
          issuanceType: row.issuanceType,
          supplementRun: row.supplementRun,
          incomeType: row.incomeType,
          paymentDate: row.paymentDate,
          totalAmount: row.totalAmount,
          // 用推导出的生效税率而不是 row.whtRate：表里留空、由目录带出法定值的行，
          // row.whtRate 是 null，直接提交等于让服务端再推一遍。传定值更实在。
          whtRate: states[index].effectiveRate,
          rateReason: row.rateReason,
          payee: {
            payeeId: row.payee.payeeId,
            taxId: row.payee.taxId,
            nameTh: row.payee.nameTh,
            nameEn: row.payee.nameEn,
            addressTh: row.payee.addressTh,
            whtType: row.payee.whtType,
          },
        })),
      });
      setResult(created);
      setStep("done");
    } catch (commitError) {
      if (commitError instanceof ApiError && commitError.issues.length > 0) {
        modal.error({
          title: t("wht.batchImportRejected"),
          width: 620,
          content: (
            <ul className="import-error-list">
              {commitError.issues.map((issue) => (
                <li key={`${issue.rows.join(",")}-${issue.reason}`}>
                  {t("wht.rowNumber")} {issue.rows.join(", ")}：{issue.detail}
                </li>
              ))}
            </ul>
          ),
        });
        return;
      }
      if (commitError instanceof Error) message.error(commitError.message);
    } finally {
      setBusy(false);
    }
  };

  const restart = () => {
    setStep("upload");
    setFile(null);
    setRows([]);
    setResult(null);
    setSourceFileName("");
  };

  const columns: ColumnsType<EditableRow> = [
    {
      title: t("wht.rowNumber"),
      dataIndex: "rowNumber",
      width: 48,
      render: (value: number) => <span className="numeric">{value}</span>,
    },
    {
      title: t("wht.status"),
      key: "status",
      width: 104,
      render: (_, row) => {
        const state = stateOf(row.rowNumber);
        if (!state) return null;
        return (
          <Tag className={`status-tag ${statusTone[state.status]}`}>
            {statusLabel(state.status, t)}
          </Tag>
        );
      },
    },
    {
      title: t("wht.company"),
      key: "payee",
      width: 192,
      render: (_, row) => {
        if (row.payee.payeeId) {
          return (
            <div className="wht-review-payee">
              <ThaiText>{row.payee.nameTh}</ThaiText>
              <small className="numeric">{row.payee.taxId}</small>
            </div>
          );
        }
        return (
          <div className="wht-review-payee">
            {row.payee.nameTh ? (
              <>
                <ThaiText>{row.payee.nameTh}</ThaiText>
                <small>
                  <span className="numeric">{row.payee.taxId}</span>
                  <Tag color="gold">{t("wht.pendingPayeeTag")}</Tag>
                </small>
              </>
            ) : (
              <>
                <span className="numeric">{row.payee.taxId}</span>
                <small className="is-missing">{t("wht.payeeNotInMaster")}</small>
              </>
            )}
          </div>
        );
      },
    },
    {
      title: t("wht.incomeType"),
      dataIndex: "incomeType",
      width: 120,
      ellipsis: true,
      render: (value: string) => <ThaiText>{value}</ThaiText>,
    },
    {
      title: t("wht.paymentDate"),
      dataIndex: "paymentDate",
      width: 100,
      render: (value: string) => <span className="date-value">{value}</span>,
    },
    {
      title: t("wht.totalAmount"),
      dataIndex: "totalAmount",
      width: 104,
      align: "right",
      render: (value: number) => <span className="numeric">{formatMoney(value)}</span>,
    },
    {
      title: t("wht.rate"),
      key: "rate",
      width: 84,
      align: "right",
      render: (_, row) => {
        const state = stateOf(row.rowNumber);
        return (
          <span className={`numeric${state?.deviates ? " is-overridden" : ""}`}>
            {formatRate(state?.effectiveRate ?? null)}
          </span>
        );
      },
    },
    {
      title: t("wht.whtAmount"),
      key: "wht",
      width: 104,
      align: "right",
      render: (_, row) => (
        <span className="numeric">{formatMoney(stateOf(row.rowNumber)?.whtAmount ?? null)}</span>
      ),
    },
    {
      title: "",
      key: "actions",
      width: 112,
      render: (_, row) => {
        const state = stateOf(row.rowNumber);
        if (state?.status === "payee_missing") {
          return (
            <Button
              icon={<UserAddOutlined />}
              size="small"
              type="primary"
              onClick={() => openPayeeForm(row.payee.taxId)}
            >
              {t("wht.fillPayee")}
            </Button>
          );
        }
        return (
          <Button size="small" onClick={() => openRowForm(row.rowNumber)}>
            {t("wht.editRow")}
          </Button>
        );
      },
    },
  ];

  const sameTaxIdRows = payeeTaxId
    ? rows.filter((row) => row.payee.taxId === payeeTaxId && !row.payee.payeeId).length
    : 0;
  const editingState = editingRow === null ? null : stateOf(editingRow);

  return (
    // is-wizard 把这一屏切成有界的 flex 列，步骤条与页脚才固定得住（见 finance-ui.css）。
    <section className="workspace-main is-wizard">
      <div className="page-heading">
        <div>
          <h1>
            <span>WHT</span>
            <small>{t("wht.batchWizardTitle")}</small>
          </h1>
          {viewSwitch}
        </div>
        <div className="page-actions">
          <Button icon={<ArrowLeftOutlined />} onClick={onBackToLedger}>
            {t("wht.backToLedger")}
          </Button>
        </div>
      </div>

      {/* tax-wizard-* 是与 TAX INV 共用的向导外壳（纯布局），不是 TAX INV 专属样式。 */}
      <section className="work-surface wht-batch-wizard">
        <div className="tax-wizard-bar">
          <Steps
            className="tax-wizard-steps"
            size="small"
            current={step === "upload" ? 0 : step === "review" ? 1 : 2}
            items={[
              { title: t("wht.stepUpload") },
              { title: t("wht.stepReview") },
              { title: t("wht.stepDone") },
            ]}
          />
        </div>

        {step === "upload" && (
          <div className="tax-wizard-body">
            <main className="tax-wizard-panel">
              {/* 说明文字保持静默：这一步没有任何需要用户当场决策的东西，
                  套上带底色的告警只会让每一屏都在喊。 */}
              <p className="wht-wizard-note is-emphasis">{t("wht.batchImportIntro")}</p>
              <p className="wht-wizard-note">{t("wht.uploadIntro")}</p>
              <h4 className="import-steps-title">{t("common.steps")}</h4>
              <ol className="import-steps">
                <li>{t("wht.batchImportStep1")}</li>
                <li>{t("wht.batchImportStep2")}</li>
                <li>{t("wht.batchImportStep3")}</li>
              </ol>
              <div className="import-actions">
                <Button
                  icon={<FileExcelOutlined />}
                  onClick={() => {
                    void downloadBatchTemplate().catch((downloadError: unknown) => {
                      if (downloadError instanceof Error) {
                        message.error(downloadError.message);
                      }
                    });
                  }}
                >
                  {t("wht.batchTemplate")}
                </Button>
                <Upload
                  accept=".xlsx"
                  beforeUpload={(picked) => {
                    setFile(picked);
                    return false;
                  }}
                  fileList={
                    file ? [{ uid: file.name, name: file.name, status: "done" }] : []
                  }
                  maxCount={1}
                  onRemove={() => setFile(null)}
                >
                  <Button ghost icon={<UploadOutlined />} type="primary">
                    {t("wht.batchImportPick")}
                  </Button>
                </Upload>
              </div>
              <div className="tax-wizard-foot">
                <Button onClick={onBackToLedger}>{t("common.cancel")}</Button>
                <div className="tax-wizard-foot-spacer" />
                <Button
                  disabled={!file}
                  loading={busy}
                  type="primary"
                  onClick={() => void readFile()}
                >
                  {t("wht.toReview")}
                </Button>
              </div>
            </main>
          </div>
        )}

        {step === "review" && (
          <div className="tax-wizard-body">
            <main className="tax-wizard-panel is-wide">
              {/* 汇总用一条与台账同密度的信息条，不是横幅：这一屏最重的是下面那张表。 */}
              <div className="wht-review-summary">
                <strong>{t("wht.taskCount", { count: counts.total })}</strong>
                <span className="wht-review-count">
                  {t("wht.rowReady")} <b>{counts.ready}</b>
                </span>
                <span
                  className={`wht-review-count${counts.missing > 0 ? " is-todo" : ""}`}
                >
                  {t("wht.rowPayeeMissing")} <b>{counts.missing}</b>
                </span>
                <span
                  className={`wht-review-count${counts.invalid > 0 ? " is-todo" : ""}`}
                >
                  {t("wht.rowNeedsInput")} <b>{counts.invalid}</b>
                </span>
                <span className="wht-review-hint">
                  {blocked > 0
                    ? t("wht.reviewBlocked", { count: blocked })
                    : t("wht.reviewAllReady", { total: counts.total })}
                </span>
              </div>
              <p className="wht-wizard-note">{t("wht.reviewIntro")}</p>
              <div className="tax-reconcile-scroll">
                <Table<EditableRow>
                  className="wht-review-table"
                  columns={columns}
                  dataSource={rows}
                  locale={{ emptyText: <Empty description={t("wht.emptyTasks")} /> }}
                  pagination={{ pageSize: 20, hideOnSinglePage: true }}
                  rowKey="rowNumber"
                  rowClassName={(row) => {
                    const state = stateOf(row.rowNumber);
                    return state && state.status !== "ready" ? "is-blocked-row" : "";
                  }}
                  // 各列合计 968 + 展开列 48 = 1016，正好落在核对面板的可用宽度内；
                  // 窗口收到系统下限 1180 时由表格自己横向滚动。
                  scroll={{ x: 1016 }}
                  size="small"
                  tableLayout="fixed"
                  expandable={{
                    // 问题说明放在展开行里而不是挤进单元格：一行可能有多条，
                    // 塞进表格会把每一行都撑高，没问题的行也跟着变难扫。
                    expandedRowRender: (row) => (
                      <ul className="import-error-list">
                        {(stateOf(row.rowNumber)?.issues ?? []).map((issue) => (
                          <li key={issue.code}>{issueText(issue, t)}</li>
                        ))}
                      </ul>
                    ),
                    rowExpandable: (row) =>
                      (stateOf(row.rowNumber)?.issues.length ?? 0) > 0,
                    defaultExpandAllRows: true,
                  }}
                />
              </div>
              <div className="tax-wizard-foot">
                <Button disabled={busy} onClick={restart}>
                  {t("wht.stepUpload")}
                </Button>
                <div className="tax-wizard-foot-spacer" />
                <Button
                  disabled={blocked > 0 || counts.total === 0}
                  loading={busy || pending}
                  type="primary"
                  onClick={() => void commit()}
                >
                  {t("wht.commitBatch", { count: counts.total })}
                </Button>
              </div>
            </main>
          </div>
        )}

        {step === "done" && result && (
          <div className="tax-wizard-body">
            <main className="tax-wizard-panel">
              <div className="wht-wizard-done">
                <CheckCircleFilled />
                <h2>{t("wht.commitDone", { created: result.created })}</h2>
                {result.payeesPending > 0 && (
                  <p>{t("wht.commitDonePayees", { count: result.payeesPending })}</p>
                )}
                <p className="issuance-profile-hint">{t("wht.batchImportStep5")}</p>
              </div>
              <div className="tax-wizard-foot is-center">
                <Button onClick={restart}>{t("wht.importAnother")}</Button>
                <Button type="primary" onClick={onBackToLedger}>
                  {t("wht.backToLedger")}
                </Button>
              </div>
            </main>
          </div>
        )}
      </section>

      <Modal
        destroyOnHidden
        open={payeeTaxId !== null}
        title={t("wht.newPayeeTitle", { taxId: payeeTaxId ?? "" })}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        width={620}
        onCancel={() => setPayeeTaxId(null)}
        onOk={() => void savePayeeProfile()}
      >
        <p className="wht-wizard-note">{t("wht.newPayeeHint")}</p>
        {sameTaxIdRows > 1 && (
          <p className="wht-wizard-note is-emphasis">
            {t("wht.newPayeeAppliesTo", { count: sameTaxIdRows - 1 })}
          </p>
        )}
        <Form className="wht-modal-form" form={payeeForm} layout="vertical">
          <Form.Item
            name="nameTh"
            label={t("wht.payeeNameTh")}
            rules={[{ required: true, whitespace: true }]}
          >
            <Input className="thai-input" maxLength={300} />
          </Form.Item>
          <Form.Item name="nameEn" label={t("wht.payeeNameEn")}>
            <Input maxLength={300} />
          </Form.Item>
          <Form.Item
            name="addressTh"
            label={t("wht.address")}
            rules={[{ required: true, whitespace: true }]}
          >
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} className="thai-input" />
          </Form.Item>
          <Form.Item
            name="whtType"
            label={t("wht.declarationForm")}
            rules={[{ required: true }]}
          >
            <Radio.Group
              options={[
                { value: "PND3", label: "PND3" },
                { value: "PND53", label: "PND53" },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        destroyOnHidden
        open={editingRow !== null}
        title={t("wht.editRowTitle", { row: editingRow ?? "" })}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        onCancel={() => setEditingRow(null)}
        onOk={() => void saveRow()}
      >
        <Form form={rowForm} layout="vertical">
          <Form.Item
            name="whtRate"
            label={t("wht.ratePercent")}
            extra={
              editingState?.statutoryRate == null
                ? undefined
                : t("wht.rateStatutory", {
                    label: "",
                    statutory: formatRate(editingState.statutoryRate),
                  })
            }
            rules={[{ required: true }]}
          >
            <InputNumber max={100} min={0.01} precision={2} suffix="%" />
          </Form.Item>
          {/* 只在真的偏离时才要理由：法定税率下多问一句是纯噪音。 */}
          {editingState?.deviates && (
            <Form.Item
              name="rateReason"
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
    </section>
  );
}
