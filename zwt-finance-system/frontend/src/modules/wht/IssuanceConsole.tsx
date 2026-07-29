import { useMemo, useState } from "react";
import { ArrowLeftOutlined } from "@ant-design/icons";
import {
  App as AntApp,
  AutoComplete,
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Radio,
  Select,
  Tag,
} from "antd";

import type { Locale, Translate } from "../../i18n";
import { ThaiText } from "../../shared/ThaiText";
import type {
  IncomeTypeOption,
  Payee,
  WhtTask,
  WhtTaskCreateInput,
  WhtType,
} from "./types";

interface IssuanceConsoleProps {
  t: Translate;
  locale: Locale;
  payees: Payee[];
  incomeTypes: IncomeTypeOption[];
  periodOptions: Array<{ value: string; label: string }>;
  /** 台账当前筛的期数；筛的是「全部」时退回最新一期。 */
  defaultPeriod: string | undefined;
  pending: boolean;
  /** 三个平行视图的页签由 workspace 统一渲染，这里只负责摆位置。 */
  viewSwitch: React.ReactNode;
  onCancel: () => void;
  onCreate: (input: WhtTaskCreateInput) => Promise<WhtTask>;
}

/**
 * 与后端 `_calculated_wht_amount` 对齐：ROUND_HALF_UP 保留两位。
 * 直接 `Math.round(value * 100)` 会把 1.005（浮点里其实是 1.00499…）算成 1.00，
 * 所以先按 12 位有效数字把二进制表示误差抹掉再进位。金额恒为正，不必处理负号。
 */
function roundHalfUp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Number((value * 100).toPrecision(12))) / 100;
}

function formatAmount(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * 手工把税率改离目录法定税率时给什么反馈。
 *
 * 业务口径（已确认）：不拦截，但**必须填理由**，理由连同实际税率与法定税率一起
 * 写进建单事件的 note 供事后审计。不硬拦是因为目录只覆盖常见收入类型，真实业务
 * 里确实存在按合同或税务函件走非标准税率的情况，拦死会把人逼回手工开票。
 *
 * 前端这里只负责把话说在前面 —— 是否真的偏离由服务端按同一份目录自行判定
 * （`WhtService._rate_override_note`），直接打 API 的调用方绕不过去。
 */
function describeRate(
  entered: number | null | undefined,
  statutory: number | null,
  label: string | null,
  t: Translate,
): { deviates: boolean; tone: "muted" | "warning"; text: string } | null {
  if (entered == null || statutory == null || label == null) return null;
  const same = roundHalfUp(entered) === roundHalfUp(statutory);
  return {
    deviates: !same,
    tone: same ? "muted" : "warning",
    text: same
      ? t("wht.rateStatutory", { label, statutory: `${statutory}%` })
      : t("wht.rateOverridden", {
          label,
          rate: `${entered}%`,
          statutory: `${statutory}%`,
        }),
  };
}

/** 只读的一行「标签 / 值」。泰文值必须走 ThaiText 才能拿到 Sarabun。 */
function ProfileField({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`issuance-profile-field${wide ? " is-wide" : ""}`}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function IssuanceConsole({
  t,
  locale,
  payees,
  incomeTypes,
  periodOptions,
  defaultPeriod,
  pending,
  viewSwitch,
  onCancel,
  onCreate,
}: IssuanceConsoleProps) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const [statutoryRate, setStatutoryRate] = useState<number | null>(null);
  const [incomeLabel, setIncomeLabel] = useState<string | null>(null);

  const issuanceType = Form.useWatch("issuanceType", form);
  const payeeId = Form.useWatch("payeeId", form);
  const totalAmount = Form.useWatch("totalAmount", form);
  const whtRate = Form.useWatch("whtRate", form);

  const selectedPayee = payees.find((payee) => payee.id === payeeId) ?? null;

  /**
   * 下拉里只放泰文名 + 税号两行，选中后收起来的框只显示泰文名（optionLabelProp）。
   * 完整档案在下面的只读面板里展开——把税号、地址挤进一个标签是原来看不见地址的根因。
   */
  const payeeOptions = useMemo(
    () =>
      payees
        .filter((payee) => payee.isActive)
        .map((payee) => ({
          value: payee.id,
          title: payee.nameTh,
          search: [payee.nameTh, payee.nameEn, payee.taxId, ...payee.aliases]
            .filter(Boolean)
            .join(" ")
            .toLocaleLowerCase(),
          label: (
            <div className="payee-option">
              <ThaiText>{payee.nameTh}</ThaiText>
              <small>
                <span className="numeric">{payee.taxId}</span>
                <Tag>{payee.whtType}</Tag>
                {payee.nameEn && <em>{payee.nameEn}</em>}
              </small>
            </div>
          ),
        })),
    [payees],
  );

  /** 目录按收款方的 PND 类型过滤：同一收入类型在两张表下税率可能不同。 */
  const incomeTypeOptions = useMemo(() => {
    const localized = (option: IncomeTypeOption) =>
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
            <small>{localized(option)}</small>
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

  const applyIncomeType = (value: string) => {
    const option = incomeTypes.find((entry) => entry.labelTh === value);
    const rate = option?.rates.find(
      (entry) => entry.whtType === selectedPayee?.whtType,
    )?.rate;
    if (!option || !rate) {
      setStatutoryRate(null);
      setIncomeLabel(null);
      return;
    }
    const percent = Number(rate) * 100;
    form.setFieldValue("whtRate", percent);
    setStatutoryRate(percent);
    setIncomeLabel(locale === "en-US" ? option.labelEn : option.labelZh);
  };

  const rateNote = describeRate(whtRate, statutoryRate, incomeLabel, t);

  const total = Number.isFinite(Number(totalAmount)) ? Number(totalAmount) : 0;
  const withheld = roundHalfUp((total * (Number(whtRate) || 0)) / 100);
  const netPayable = roundHalfUp(total - withheld);

  const submit = async () => {
    try {
      const values = await form.validateFields();
      const task = await onCreate({
        period: values.period,
        issuanceType: values.issuanceType,
        supplementRun: values.issuanceType === "supplement" ? values.supplementRun : 0,
        payeeId: values.payeeId,
        incomeType: values.incomeType,
        paymentDate: values.paymentDate.format("YYYY-MM-DD"),
        whtRate: values.whtRate / 100,
        totalAmount: values.totalAmount,
        // 字段只在偏离时渲染，没偏离时 values 里根本没有这一项。
        rateOverrideNote: values.rateOverrideNote?.trim() || null,
      });
      message.success(t("wht.createdGoLedger"));
      return task;
    } catch (createError) {
      // validateFields 的 reject 不是 Error，没有 message 就是校验没过，
      // 表单自己已经把错误标在字段上了，不必再弹一条。
      if (createError instanceof Error) message.error(createError.message);
      return null;
    }
  };

  return (
    <section className="workspace-main">
      <div className="page-heading">
        <div>
          <h1>
            <span>WHT</span>
            <small>{t("wht.issuanceConsole")}</small>
          </h1>
          {viewSwitch}
        </div>
        <div className="page-actions">
          <Button icon={<ArrowLeftOutlined />} onClick={onCancel}>
            {t("wht.backToLedger")}
          </Button>
        </div>
      </div>

      <section className="work-surface issuance-console">
        <p className="issuance-intro">{t("wht.numberHint")}</p>
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            period: defaultPeriod,
            issuanceType: "normal",
            supplementRun: 1,
            whtRate: 3,
          }}
        >
          <section className="issuance-block">
            <header className="issuance-block-header">
              <h2>
                <span className="issuance-step">1</span>
                {t("wht.stepPayee")}
              </h2>
            </header>

            <Form.Item
              name="payeeId"
              label={t("wht.payee")}
              rules={[{ required: true }]}
            >
              <Select
                showSearch
                optionLabelProp="title"
                options={payeeOptions}
                placeholder={t("wht.payeeSearchInline")}
                filterOption={(input, option) =>
                  ((option as { search?: string } | undefined)?.search ?? "").includes(
                    input.toLocaleLowerCase(),
                  )
                }
                onChange={() => {
                  // 换收款方就可能换 PND 表，原来选的收入类型未必还适用。
                  form.setFieldValue("incomeType", undefined);
                  setStatutoryRate(null);
                  setIncomeLabel(null);
                }}
              />
            </Form.Item>

            {selectedPayee ? (
              <div className="issuance-profile">
                <div className="issuance-profile-title">
                  <h3>{t("wht.payeeProfile")}</h3>
                  <Tag>{selectedPayee.whtType}</Tag>
                </div>
                <dl className="issuance-profile-grid">
                  <ProfileField label={t("wht.payeeNameTh")} wide>
                    <ThaiText>{selectedPayee.nameTh}</ThaiText>
                  </ProfileField>
                  <ProfileField label={t("wht.payeeNameEn")}>
                    {selectedPayee.nameEn ?? "—"}
                  </ProfileField>
                  <ProfileField label={t("wht.taxId")}>
                    <span className="numeric">{selectedPayee.taxId}</span>
                  </ProfileField>
                  <ProfileField label={t("wht.address")} wide>
                    <ThaiText>{selectedPayee.addressTh}</ThaiText>
                  </ProfileField>
                  <ProfileField label={t("wht.declarationForm")}>
                    {selectedPayee.whtType}
                  </ProfileField>
                  <ProfileField label={t("wht.aliases")}>
                    {selectedPayee.aliases.length > 0
                      ? selectedPayee.aliases.join(" / ")
                      : t("wht.noAliases")}
                  </ProfileField>
                </dl>
                <p className="issuance-profile-hint">{t("wht.payeeProfileHint")}</p>
              </div>
            ) : (
              <div className="issuance-profile is-empty">
                <strong>{t("wht.payeeNotChosen")}</strong>
                <span>{t("wht.payeeNotChosenHint")}</span>
              </div>
            )}
          </section>

          <section className="issuance-block">
            <header className="issuance-block-header">
              <h2>
                <span className="issuance-step">2</span>
                {t("wht.stepIssuance")}
              </h2>
            </header>

            <div className="issuance-grid">
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
              {issuanceType === "supplement" ? (
                <Form.Item
                  name="supplementRun"
                  label={t("wht.supplementRun")}
                  rules={[{ required: true }]}
                >
                  <InputNumber min={1} max={9} precision={0} />
                </Form.Item>
              ) : null}

              <Form.Item
                name="paymentDate"
                label={t("wht.paymentDate")}
                rules={[{ required: true }]}
              >
                <DatePicker format="YYYY-MM-DD" />
              </Form.Item>
              <Form.Item
                className="issuance-span-2"
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
                  disabled={!selectedPayee}
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

              <Form.Item
                name="totalAmount"
                label={t("wht.totalAmount")}
                rules={[{ required: true }]}
              >
                <InputNumber min={0.01} precision={2} />
              </Form.Item>
              <Form.Item
                className="issuance-span-2"
                name="whtRate"
                label={t("wht.ratePercent")}
                extra={
                  rateNote && (
                    <span className={`rate-note is-${rateNote.tone}`}>{rateNote.text}</span>
                  )
                }
                rules={[{ required: true }]}
              >
                <InputNumber min={0.01} max={100} precision={2} suffix="%" />
              </Form.Item>

              {/* 只在真的偏离时才出现：法定税率下多问一句理由是纯噪音。 */}
              {rateNote?.deviates && (
                <Form.Item
                  className="issuance-span-3"
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
            </div>
          </section>

          <section className="issuance-block">
            <header className="issuance-block-header">
              <h2>
                <span className="issuance-step">3</span>
                {t("wht.stepSettlement")}
              </h2>
            </header>

            <div className="issuance-settlement">
              <div className="settlement-cell">
                <span>{t("wht.totalAmount")}</span>
                <strong className="numeric">{formatAmount(total)}</strong>
              </div>
              <div className="settlement-operator" aria-hidden>
                −
              </div>
              <div className="settlement-cell is-withheld">
                <span>{t("wht.whtAmount")}</span>
                <strong className="numeric">{formatAmount(withheld)}</strong>
              </div>
              <div className="settlement-operator" aria-hidden>
                =
              </div>
              <div className="settlement-cell is-net">
                <span>{t("wht.netPayable")}</span>
                <strong className="numeric">{formatAmount(netPayable)}</strong>
              </div>
            </div>
            <p className="issuance-profile-hint">{t("wht.settlementHint")}</p>
          </section>

          <div className="issuance-footer">
            <Button disabled={pending} onClick={onCancel}>
              {t("common.cancel")}
            </Button>
            <Button loading={pending} type="primary" onClick={() => void submit()}>
              {t("common.createDraft")}
            </Button>
          </div>
        </Form>
      </section>
    </section>
  );
}
