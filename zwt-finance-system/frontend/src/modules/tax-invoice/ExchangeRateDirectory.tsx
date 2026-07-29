import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import {
  App as AntApp,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
} from "antd";
import type { ColumnsType } from "antd/es/table";

import type { Locale, Translate } from "../../i18n";
import {
  deleteExchangeRate,
  listExchangeRateMonths,
  listExchangeRates,
  restoreExchangeRate,
  saveExchangeRate,
  updateExchangeRate,
} from "./api";
import type {
  ExchangeRate,
  ExchangeRateInput,
  ExchangeRateMonth,
} from "./types";

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

interface ExchangeRateDirectoryProps {
  t: Translate;
  locale: Locale;
  currency: string;
  currencies: string[];
  canWrite: boolean;
  onCurrencyChange: (currency: string) => void;
}

interface RateFormValues {
  currency: string;
  rateDate: string;
  buyingTransfer: number;
  buyingSight?: number | null;
  selling?: number | null;
  midRate?: number | null;
  isActive: boolean;
}

function formatRate(value: string | null): string {
  return value ? Number(value).toFixed(6) : "—";
}

function formatDateTime(value: string, locale: Locale): string {
  return new Date(value).toLocaleString(locale, { hour12: false });
}

function sourceLabel(source: string, t: Translate): string {
  if (source === "bot_api") return "BOT API";
  if (source === "manual") return t("tax.rateSourceManual");
  return "BOT Excel";
}

export function ExchangeRateDirectory({
  t,
  locale,
  currency,
  currencies,
  canWrite,
  onCurrencyChange,
}: ExchangeRateDirectoryProps) {
  const { message, modal } = AntApp.useApp();
  const [months, setMonths] = useState<ExchangeRateMonth[]>([]);
  const [rates, setRates] = useState<ExchangeRate[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ExchangeRate | null>(null);
  const [form] = Form.useForm<RateFormValues>();

  const loadMonths = useCallback(async () => {
    setLoading(true);
    try {
      setMonths(await listExchangeRateMonths(currency));
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : t("tax.rateLoadFailed"),
      );
    } finally {
      setLoading(false);
    }
  }, [currency, message, t]);

  const loadDeleted = useCallback(async () => {
    setLoading(true);
    try {
      setRates(await listExchangeRates(currency, { deleted: true }));
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : t("tax.rateLoadFailed"),
      );
    } finally {
      setLoading(false);
    }
  }, [currency, message, t]);

  const loadMonthRates = useCallback(
    async (month: string) => {
      setDetailLoading(true);
      try {
        setRates(await listExchangeRates(currency, { month }));
      } catch (error) {
        message.error(
          error instanceof Error ? error.message : t("tax.rateLoadFailed"),
        );
      } finally {
        setDetailLoading(false);
      }
    },
    [currency, message, t],
  );

  useEffect(() => {
    setDrawerOpen(false);
    setSelectedMonth(null);
    if (showDeleted) void loadDeleted();
    else void loadMonths();
  }, [loadDeleted, loadMonths, showDeleted]);

  const openMonth = (month: ExchangeRateMonth) => {
    setSelectedMonth(month.month);
    setDrawerOpen(true);
    void loadMonthRates(month.month);
  };

  const openEditor = (rate?: ExchangeRate) => {
    setEditing(rate ?? null);
    form.setFieldsValue(
      rate
        ? {
            currency: rate.currency,
            rateDate: rate.rateDate,
            buyingTransfer: Number(rate.buyingTransfer),
            buyingSight:
              rate.buyingSight === null ? null : Number(rate.buyingSight),
            selling: rate.selling === null ? null : Number(rate.selling),
            midRate: rate.midRate === null ? null : Number(rate.midRate),
            isActive: rate.isActive,
          }
        : {
            currency,
            rateDate: selectedMonth
              ? `${selectedMonth}-01`
              : new Date().toISOString().slice(0, 10),
            buyingTransfer: undefined,
            buyingSight: null,
            selling: null,
            midRate: null,
            isActive: true,
          },
    );
    setEditorOpen(true);
  };

  const refreshCurrent = async () => {
    await loadMonths();
    if (drawerOpen && selectedMonth) await loadMonthRates(selectedMonth);
  };

  const submitEditor = async () => {
    try {
      const values = await form.validateFields();
      setPending(true);
      const input: ExchangeRateInput = {
        ...values,
        buyingSight: values.buyingSight ?? null,
        selling: values.selling ?? null,
        midRate: values.midRate ?? null,
      };
      await saveExchangeRate(input, editing?.id);
      message.success(t("tax.rateSaved"));
      setEditorOpen(false);
      setEditing(null);
      await refreshCurrent();
    } catch (error) {
      if (error instanceof Error) message.error(error.message);
    } finally {
      setPending(false);
    }
  };

  const toggleActive = async (rate: ExchangeRate) => {
    try {
      setPending(true);
      await updateExchangeRate(rate.id, { isActive: !rate.isActive });
      message.success(
        rate.isActive ? t("tax.rateDisabled") : t("tax.rateEnabled"),
      );
      await refreshCurrent();
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : t("common.unknownError"),
      );
    } finally {
      setPending(false);
    }
  };

  const removeRate = (rate: ExchangeRate) => {
    modal.confirm({
      title: t("tax.deleteRateTitle"),
      content: t("tax.deleteRateHint", {
        currency: rate.currency,
        date: rate.rateDate,
      }),
      okText: t("common.moveToRecycleBin"),
      cancelText: t("common.cancel"),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          setPending(true);
          await deleteExchangeRate(rate.id);
          message.success(t("tax.rateDeleted"));
          await refreshCurrent();
        } catch (error) {
          message.error(
            error instanceof Error ? error.message : t("common.unknownError"),
          );
          throw error;
        } finally {
          setPending(false);
        }
      },
    });
  };

  const recoverRate = async (rate: ExchangeRate) => {
    try {
      setPending(true);
      await restoreExchangeRate(rate.id);
      message.success(t("tax.rateRestored"));
      await loadDeleted();
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : t("common.unknownError"),
      );
    } finally {
      setPending(false);
    }
  };

  const currencyOptions = useMemo(
    () =>
      CURRENCY_CHOICES.map((code) => ({
        value: code,
        label: currencies.includes(code)
          ? code
          : `${code} · ${t("tax.noData")}`,
      })),
    [currencies, t],
  );

  const monthColumns: ColumnsType<ExchangeRateMonth> = [
    {
      title: t("tax.rateMonth"),
      dataIndex: "month",
      width: 130,
      render: (value: string) => <strong className="numeric-value">{value}</strong>,
    },
    {
      title: t("tax.rateDayCount"),
      dataIndex: "dayCount",
      width: 120,
      render: (value: number) => t("tax.rateDaysValue", { count: value }),
    },
    {
      title: t("tax.rateInactiveCount"),
      dataIndex: "inactiveCount",
      width: 130,
      render: (value: number) =>
        value > 0 ? (
          <Tag color="orange">{t("tax.rateInactiveValue", { count: value })}</Tag>
        ) : (
          "—"
        ),
    },
    {
      title: t("tax.rateRange"),
      key: "range",
      width: 230,
      align: "right",
      render: (_, month) => (
        <span className="numeric-value">
          {formatRate(month.minRate)} – {formatRate(month.maxRate)}
        </span>
      ),
    },
    {
      title: t("tax.latestRateDate"),
      dataIndex: "latestDate",
      width: 140,
    },
    {
      title: t("tax.colUpdatedAt"),
      dataIndex: "updatedAt",
      width: 190,
      render: (value: string) => formatDateTime(value, locale),
    },
    {
      title: "",
      key: "open",
      width: 110,
      render: (_, month) => (
        <Button
          icon={<RightOutlined />}
          size="small"
          onClick={() => openMonth(month)}
        >
          {t("common.open")}
        </Button>
      ),
    },
  ];

  const rateColumns: ColumnsType<ExchangeRate> = [
    { title: t("tax.colCurrency"), dataIndex: "currency", width: 90 },
    { title: t("tax.colRateDay"), dataIndex: "rateDate", width: 120 },
    {
      title: `Buying Transfer · ${t("tax.rateUsedForInvoice")}`,
      dataIndex: "buyingTransfer",
      width: 190,
      align: "right",
      render: (value: string) => (
        <strong className="numeric-value">{formatRate(value)}</strong>
      ),
    },
    {
      title: "Buying Sight",
      dataIndex: "buyingSight",
      width: 130,
      align: "right",
      render: formatRate,
    },
    {
      title: "Selling",
      dataIndex: "selling",
      width: 120,
      align: "right",
      render: formatRate,
    },
    {
      title: "Mid Rate",
      dataIndex: "midRate",
      width: 120,
      align: "right",
      render: formatRate,
    },
    {
      title: t("tax.colSource"),
      dataIndex: "source",
      width: 130,
      render: (value: string) => <Tag>{sourceLabel(value, t)}</Tag>,
    },
    ...(showDeleted
      ? [
          {
            title: t("common.deletedAt"),
            dataIndex: "deletedAt",
            width: 190,
            render: (_: string | null, rate: ExchangeRate) => (
              <div className="audit-cell">
                <span>
                  {rate.deletedAt
                    ? formatDateTime(rate.deletedAt, locale)
                    : "—"}
                </span>
                <small>{rate.deletedByName ?? "—"}</small>
              </div>
            ),
          },
        ]
      : [
          {
            title: t("wht.active"),
            dataIndex: "isActive",
            width: 100,
            render: (value: boolean) => (
              <Tag color={value ? "green" : "default"}>
                {value ? t("wht.enabled") : t("wht.disabled")}
              </Tag>
            ),
          },
        ]),
    {
      title: "",
      key: "actions",
      fixed: "right",
      width: showDeleted ? 110 : 230,
      render: (_, rate) =>
        showDeleted ? (
          <Button
            disabled={!canWrite || pending}
            icon={<UndoOutlined />}
            size="small"
            onClick={() => void recoverRate(rate)}
          >
            {t("common.restore")}
          </Button>
        ) : (
          <Space size={4}>
            <Button
              disabled={!canWrite || pending}
              icon={<EditOutlined />}
              size="small"
              onClick={() => openEditor(rate)}
            >
              {t("common.edit")}
            </Button>
            <Button
              disabled={!canWrite || pending}
              size="small"
              onClick={() => void toggleActive(rate)}
            >
              {rate.isActive ? t("common.disable") : t("common.enable")}
            </Button>
            <Button
              aria-label={t("common.moveToRecycleBin")}
              danger
              disabled={!canWrite || pending}
              icon={<DeleteOutlined />}
              size="small"
              onClick={() => removeRate(rate)}
            />
          </Space>
        ),
    },
  ];

  return (
    <section className="rate-directory">
      <div className="rate-directory-toolbar">
        <label className="rate-currency-field">
          <span>{t("tax.currency")}</span>
          <Select
            options={currencyOptions}
            showSearch
            value={currency}
            onChange={onCurrencyChange}
          />
        </label>
        <nav className="directory-view-switch" aria-label={t("common.dataView")}>
          <button
            className={!showDeleted ? "is-active" : ""}
            type="button"
            onClick={() => setShowDeleted(false)}
          >
            {t("tax.rateMonths")}
          </button>
          <button
            className={showDeleted ? "is-active" : ""}
            type="button"
            onClick={() => setShowDeleted(true)}
          >
            {t("common.recycleBin")}
          </button>
        </nav>
        <div className="rate-directory-actions">
          <Button
            aria-label={t("common.refresh")}
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={() =>
              void (showDeleted ? loadDeleted() : loadMonths())
            }
          />
          {!showDeleted && (
            <Button
              disabled={!canWrite}
              icon={<PlusOutlined />}
              type="primary"
              onClick={() => openEditor()}
            >
              {t("tax.manualRate")}
            </Button>
          )}
        </div>
      </div>

      {showDeleted ? (
        rates.length ? (
          <Table<ExchangeRate>
            columns={rateColumns}
            dataSource={rates}
            loading={loading}
            pagination={{ pageSize: 15, showSizeChanger: false }}
            rowKey="id"
            scroll={{ x: 1250 }}
          />
        ) : (
          <Empty description={t("tax.noDeletedRates")} />
        )
      ) : (
        <Table<ExchangeRateMonth>
          columns={monthColumns}
          dataSource={months}
          loading={loading}
          pagination={{ pageSize: 12, showSizeChanger: false }}
          rowClassName="clickable-row"
          rowKey="month"
          scroll={{ x: 1050 }}
          onRow={(month) => ({ onDoubleClick: () => openMonth(month) })}
        />
      )}

      <Drawer
        destroyOnHidden
        open={drawerOpen}
        title={t("tax.rateMonthDetail", {
          currency,
          month: selectedMonth ?? "",
        })}
        width={1040}
        onClose={() => setDrawerOpen(false)}
        extra={
          canWrite ? (
            <Button
              icon={<PlusOutlined />}
              type="primary"
              onClick={() => openEditor()}
            >
              {t("tax.manualRate")}
            </Button>
          ) : null
        }
      >
        <Table<ExchangeRate>
          columns={rateColumns}
          dataSource={rates}
          loading={detailLoading}
          pagination={{ pageSize: 15, showSizeChanger: false }}
          rowKey="id"
          scroll={{ x: 1250 }}
        />
      </Drawer>

      <Modal
        destroyOnHidden
        forceRender
        cancelText={t("common.cancel")}
        confirmLoading={pending}
        okText={t("common.save")}
        open={editorOpen}
        title={editing ? t("tax.editRate") : t("tax.manualRate")}
        width={720}
        onCancel={() => {
          setEditorOpen(false);
          setEditing(null);
        }}
        onOk={() => void submitEditor()}
      >
        <p className="modal-intro">{t("tax.manualRateHint")}</p>
        <Form form={form} layout="vertical">
          <div className="rate-form-grid">
            <Form.Item
              label={t("tax.currency")}
              name="currency"
              rules={[{ required: true }]}
            >
              <Select disabled options={currencyOptions} showSearch />
            </Form.Item>
            <Form.Item
              label={t("tax.colRateDay")}
              name="rateDate"
              rules={[{ required: true }]}
            >
              <Input disabled={editing !== null} type="date" />
            </Form.Item>
            <Form.Item
              label={`Buying Transfer · ${t("tax.rateUsedForInvoice")}`}
              name="buyingTransfer"
              rules={[{ required: true }]}
            >
              <InputNumber min={0.000001} precision={6} stringMode={false} />
            </Form.Item>
            <Form.Item label="Buying Sight" name="buyingSight">
              <InputNumber min={0.000001} precision={6} stringMode={false} />
            </Form.Item>
            <Form.Item label="Selling" name="selling">
              <InputNumber min={0.000001} precision={6} stringMode={false} />
            </Form.Item>
            <Form.Item label="Mid Rate" name="midRate">
              <InputNumber min={0.000001} precision={6} stringMode={false} />
            </Form.Item>
          </div>
          <Form.Item
            label={t("wht.active")}
            name="isActive"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </section>
  );
}
