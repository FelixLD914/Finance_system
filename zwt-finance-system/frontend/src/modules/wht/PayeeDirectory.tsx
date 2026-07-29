import { useMemo, useState } from "react";
import { EditOutlined, PlusOutlined, SearchOutlined, UploadOutlined } from "@ant-design/icons";
import {
  Alert,
  App as AntApp,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Switch,
  Table,
  Tag,
  Upload,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { UploadProps } from "antd";

import type { Translate } from "../../i18n";
import { ThaiText } from "../../shared/ThaiText";
import type { ImportResult, Payee, PayeeInput } from "./types";

interface PayeeDirectoryProps {
  t: Translate;
  payees: Payee[];
  loading: boolean;
  pending: boolean;
  error: string | null;
  onSave: (input: PayeeInput, payeeId?: string) => Promise<Payee>;
  onImport: (file: File) => Promise<ImportResult>;
}

interface PayeeFormValues {
  taxId: string;
  nameTh: string;
  nameEn?: string;
  addressTh: string;
  whtType: "PND3" | "PND53";
  aliases?: string;
  isActive: boolean;
}

export function PayeeDirectory({
  t,
  payees,
  loading,
  pending,
  error,
  onSave,
  onImport,
}: PayeeDirectoryProps) {
  const { message } = AntApp.useApp();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Payee | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm<PayeeFormValues>();

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return payees;
    return payees.filter((payee) =>
      [payee.taxId, payee.nameTh, payee.nameEn, ...payee.aliases]
        .filter(Boolean)
        .some((value) => value?.toLocaleLowerCase().includes(normalized)),
    );
  }, [payees, query]);

  const openEditor = (payee?: Payee) => {
    setEditing(payee ?? null);
    form.setFieldsValue(
      payee
        ? {
            taxId: payee.taxId,
            nameTh: payee.nameTh,
            nameEn: payee.nameEn ?? undefined,
            addressTh: payee.addressTh,
            whtType: payee.whtType,
            aliases: payee.aliases.join(" / "),
            isActive: payee.isActive,
          }
        : {
            taxId: "",
            nameTh: "",
            nameEn: "",
            addressTh: "",
            whtType: "PND53",
            aliases: "",
            isActive: true,
          },
    );
    setModalOpen(true);
  };

  const save = async () => {
    const values = await form.validateFields();
    await onSave(
      {
        ...values,
        nameEn: values.nameEn || null,
        aliases: (values.aliases ?? "")
          .split(/[\/\n]/)
          .map((value) => value.trim())
          .filter(Boolean),
      },
      editing?.id,
    );
    setModalOpen(false);
    message.success(t("wht.payeeSaved"));
  };

  const customRequest: UploadProps["customRequest"] = async ({
    file,
    onSuccess,
    onError,
  }) => {
    try {
      const result = await onImport(file as File);
      message.success(
        t("wht.importCompleted", {
          created: result.created,
          updated: result.updated,
        }),
      );
      onSuccess?.(result);
    } catch (importError) {
      const resolved =
        importError instanceof Error ? importError : new Error(String(importError));
      message.error(resolved.message);
      onError?.(resolved);
    }
  };

  const columns: ColumnsType<Payee> = [
    {
      title: t("wht.taxId"),
      dataIndex: "taxId",
      width: 150,
      render: (value: string) => <span className="tax-id-value">{value}</span>,
    },
    {
      title: t("wht.payeeNameTh"),
      dataIndex: "nameTh",
      width: 250,
      render: (value: string) => <ThaiText>{value}</ThaiText>,
    },
    {
      title: t("wht.address"),
      dataIndex: "addressTh",
      ellipsis: true,
      render: (value: string) => <ThaiText>{value}</ThaiText>,
    },
    {
      title: t("wht.type"),
      dataIndex: "whtType",
      width: 90,
      render: (value: string) => <Tag className="directory-type-tag">{value}</Tag>,
    },
    {
      title: t("wht.active"),
      dataIndex: "isActive",
      width: 90,
      render: (active: boolean) => (
        <Tag color={active ? "green" : "default"}>
          {active ? t("wht.enabled") : t("wht.disabled")}
        </Tag>
      ),
    },
    {
      title: "",
      key: "edit",
      width: 58,
      render: (_, payee) => (
        <Button
          aria-label={t("common.edit")}
          icon={<EditOutlined />}
          type="text"
          onClick={() => openEditor(payee)}
        />
      ),
    },
  ];

  return (
    <section className="directory-surface">
      {error && <Alert showIcon type="error" title={t("common.loadFailed")} description={error} />}
      <div className="directory-toolbar">
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder={t("wht.payeeSearch")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="directory-toolbar-actions">
          <Upload
            accept=".xlsx"
            customRequest={customRequest}
            disabled={pending}
            maxCount={1}
            showUploadList={false}
          >
            <Button icon={<UploadOutlined />} loading={pending}>
              {t("wht.importSheet2")}
            </Button>
          </Upload>
          <Button icon={<PlusOutlined />} type="primary" onClick={() => openEditor()}>
            {t("wht.newPayee")}
          </Button>
        </div>
      </div>
      <div className="directory-summary">
        {t("wht.payeeCount", { count: filtered.length })}
      </div>
      <Table<Payee>
        columns={columns}
        dataSource={filtered}
        loading={loading}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        rowKey="id"
        scroll={{ x: 900 }}
      />

      <Modal
        destroyOnHidden
        forceRender
        open={modalOpen}
        title={editing ? t("wht.editPayee") : t("wht.newPayee")}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        confirmLoading={pending}
        onCancel={() => setModalOpen(false)}
        onOk={save}
      >
        <Form form={form} layout="vertical">
          <div className="payee-form-grid">
            <Form.Item
              name="taxId"
              label={t("wht.taxId")}
              rules={[
                { required: true },
                { pattern: /^\d{13}$/, message: t("wht.taxIdHint") },
              ]}
            >
              <Input disabled={Boolean(editing)} maxLength={13} />
            </Form.Item>
            <Form.Item name="whtType" label={t("wht.type")} rules={[{ required: true }]}>
              <Select
                options={[
                  { value: "PND3", label: "PND 3" },
                  { value: "PND53", label: "PND 53" },
                ]}
              />
            </Form.Item>
          </div>
          <Form.Item name="nameTh" label={t("wht.payeeNameTh")} rules={[{ required: true }]}>
            <Input className="thai-input" />
          </Form.Item>
          <Form.Item name="nameEn" label={t("wht.payeeNameEn")}>
            <Input />
          </Form.Item>
          <Form.Item name="addressTh" label={t("wht.address")} rules={[{ required: true }]}>
            <Input.TextArea className="thai-input" autoSize={{ minRows: 2, maxRows: 4 }} />
          </Form.Item>
          <Form.Item name="aliases" label={t("wht.aliases")}>
            <Input placeholder={t("wht.aliasHint")} />
          </Form.Item>
          <Form.Item name="isActive" label={t("wht.active")} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </section>
  );
}
