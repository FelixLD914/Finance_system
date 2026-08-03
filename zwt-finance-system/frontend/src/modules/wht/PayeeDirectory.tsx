import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SearchOutlined,
  UndoOutlined,
  UploadOutlined,
} from "@ant-design/icons";
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
import { getPayeeDeletePreview, listPayees } from "./api";
import { branchLabel, displayPayeeName } from "./branching";
import type { BranchType, ImportResult, Payee, PayeeInput } from "./types";

interface PayeeDirectoryProps {
  t: Translate;
  payees: Payee[];
  loading: boolean;
  pending: boolean;
  error: string | null;
  onSave: (input: PayeeInput, payeeId?: string) => Promise<Payee>;
  onImport: (file: File) => Promise<ImportResult>;
  onDelete: (payeeId: string) => Promise<Payee>;
  onRestore: (payeeId: string) => Promise<Payee>;
}

interface PayeeFormValues {
  taxId: string;
  nameTh: string;
  nameEn?: string;
  addressTh: string;
  whtType: "PND3" | "PND53";
  branchType: BranchType;
  branchNumber?: string;
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
  onDelete,
  onRestore,
}: PayeeDirectoryProps) {
  const { message, modal } = AntApp.useApp();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"active" | "deleted">("active");
  const [deletedPayees, setDeletedPayees] = useState<Payee[]>([]);
  const [recycleLoading, setRecycleLoading] = useState(false);
  const [editing, setEditing] = useState<Payee | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm<PayeeFormValues>();
  const formWhtType = Form.useWatch("whtType", form);
  const formBranchType = Form.useWatch("branchType", form);

  useEffect(() => {
    if (!modalOpen) return;
    if (formWhtType === "PND3") {
      form.setFieldsValue({ branchType: "none", branchNumber: undefined });
    } else if (formWhtType === "PND53" && form.getFieldValue("branchType") === "none") {
      form.setFieldsValue({ branchType: "head_office", branchNumber: undefined });
    }
  }, [form, formWhtType, modalOpen]);

  const loadDeletedPayees = useCallback(async () => {
    setRecycleLoading(true);
    try {
      setDeletedPayees(await listPayees(true));
    } catch (loadError) {
      message.error(
        loadError instanceof Error ? loadError.message : t("common.loadFailed"),
      );
    } finally {
      setRecycleLoading(false);
    }
  }, [message, t]);

  useEffect(() => {
    if (view === "deleted") void loadDeletedPayees();
  }, [loadDeletedPayees, view]);

  const filtered = useMemo(() => {
    const source = view === "deleted" ? deletedPayees : payees;
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return source;
    return source.filter((payee) =>
      [payee.taxId, payee.nameTh, payee.nameEn, ...payee.aliases]
        .filter(Boolean)
        .some((value) => value?.toLocaleLowerCase().includes(normalized)),
    );
  }, [deletedPayees, payees, query, view]);

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
            branchType: payee.branchType,
            branchNumber: payee.branchNumber ?? undefined,
            aliases: payee.aliases.join(" / "),
            isActive: payee.isActive,
          }
        : {
            taxId: "",
            nameTh: "",
            nameEn: "",
            addressTh: "",
            whtType: "PND53",
            branchType: "head_office",
            branchNumber: undefined,
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
        branchType: values.whtType === "PND53" ? values.branchType : "none",
        branchNumber:
          values.whtType === "PND53" && values.branchType === "branch"
            ? values.branchNumber
            : null,
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

  const confirmDelete = async (payee: Payee) => {
    try {
      const preview = await getPayeeDeletePreview(payee.id);
      modal.confirm({
        title: t("wht.deletePayeeTitle"),
        content: (
          <div className="delete-preview">
            <strong>
              <ThaiText>{preview.nameTh}</ThaiText>
            </strong>
            <span className="tax-id-value">{preview.taxId}</span>
            <p>
              {t("wht.deletePayeeImpact", {
                count: preview.referencingTasks,
              })}
            </p>
            <p>{t("wht.recycleNotPermanent")}</p>
          </div>
        ),
        okText: t("common.moveToRecycleBin"),
        cancelText: t("common.cancel"),
        okButtonProps: { danger: true },
        onOk: async () => {
          try {
            const deleted = await onDelete(payee.id);
            setDeletedPayees((current) => [deleted, ...current]);
            message.success(t("wht.payeeDeleted"));
          } catch (deleteError) {
            message.error(
              deleteError instanceof Error
                ? deleteError.message
                : t("common.unknownError"),
            );
            throw deleteError;
          }
        },
      });
    } catch (deleteError) {
      message.error(
        deleteError instanceof Error
          ? deleteError.message
          : t("common.unknownError"),
      );
    }
  };

  const confirmRestore = (payee: Payee) => {
    modal.confirm({
      title: t("wht.restorePayeeTitle"),
      content: t("wht.restorePayeeHint", { taxId: payee.taxId }),
      okText: t("common.restore"),
      cancelText: t("common.cancel"),
      onOk: async () => {
        try {
          await onRestore(payee.id);
          setDeletedPayees((current) =>
            current.filter((item) => item.id !== payee.id),
          );
          message.success(t("wht.payeeRestored"));
        } catch (restoreError) {
          message.error(
            restoreError instanceof Error
              ? restoreError.message
              : t("common.unknownError"),
          );
          throw restoreError;
        }
      },
    });
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
      render: (_value: string, payee) => (
        <ThaiText>
          {displayPayeeName(payee.nameTh, payee.branchType, payee.branchNumber)}
        </ThaiText>
      ),
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
      title: t("wht.branchOffice"),
      key: "branch",
      width: 138,
      render: (_, payee) => (
        <ThaiText>
          {branchLabel(payee.branchType, payee.branchNumber) ?? t("wht.notApplicable")}
        </ThaiText>
      ),
    },
    {
      title: view === "deleted" ? t("common.deletedAt") : t("wht.active"),
      dataIndex: view === "deleted" ? "deletedAt" : "isActive",
      width: view === "deleted" ? 190 : 90,
      render: (value: boolean | string | null, payee) =>
        view === "deleted" ? (
          <div className="audit-cell">
            <span>
              {payee.deletedAt
                ? new Date(payee.deletedAt).toLocaleString("zh-CN", {
                    hour12: false,
                  })
                : "—"}
            </span>
            <small>{payee.deletedByName ?? "—"}</small>
          </div>
        ) : (
          <Tag color={value ? "green" : "default"}>
            {value ? t("wht.enabled") : t("wht.disabled")}
          </Tag>
        ),
    },
    {
      title: "",
      key: "actions",
      width: view === "deleted" ? 110 : 100,
      render: (_, payee) =>
        view === "deleted" ? (
          <Button
            disabled={pending}
            icon={<UndoOutlined />}
            size="small"
            onClick={() => confirmRestore(payee)}
          >
            {t("common.restore")}
          </Button>
        ) : (
          <div className="compact-row-actions">
            <Button
              aria-label={t("common.edit")}
              icon={<EditOutlined />}
              type="text"
              onClick={() => openEditor(payee)}
            />
            <Button
              aria-label={t("common.moveToRecycleBin")}
              danger
              disabled={pending}
              icon={<DeleteOutlined />}
              type="text"
              onClick={() => void confirmDelete(payee)}
            />
          </div>
        ),
    },
  ];

  return (
    <section className="directory-surface">
      {error && <Alert showIcon type="error" title={t("common.loadFailed")} description={error} />}
      <nav className="directory-view-switch" aria-label={t("common.dataView")}>
        <button
          className={view === "active" ? "is-active" : ""}
          type="button"
          onClick={() => setView("active")}
        >
          {t("common.activeRecords")}
        </button>
        <button
          className={view === "deleted" ? "is-active" : ""}
          type="button"
          onClick={() => setView("deleted")}
        >
          {t("common.recycleBin")}
        </button>
      </nav>
      <div className="directory-toolbar">
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder={t("wht.payeeSearch")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {view === "active" && <div className="directory-toolbar-actions">
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
        </div>}
      </div>
      <div className="directory-summary">
        {view === "deleted"
          ? t("wht.payeeRecycleCount", { count: filtered.length })
          : t("wht.payeeCount", { count: filtered.length })}
      </div>
      <Table<Payee>
        columns={columns}
        dataSource={filtered}
        loading={view === "deleted" ? recycleLoading : loading}
        pagination={{
          pageSizeOptions: [10, 20, 50, 100],
          showSizeChanger: true,
          defaultPageSize: 10,
        }}
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
          {formWhtType === "PND53" && (
            <div className="payee-form-grid">
              <Form.Item
                name="branchType"
                label={t("wht.branchOffice")}
                rules={[{ required: true }]}
              >
                <Select
                  options={[
                    { value: "head_office", label: t("wht.headOffice") },
                    { value: "branch", label: t("wht.branch") },
                  ]}
                />
              </Form.Item>
              {formBranchType === "branch" && (
                <Form.Item
                  name="branchNumber"
                  label={t("wht.branchNumber")}
                  rules={[
                    { required: true },
                    { pattern: /^\d{5}$/, message: t("wht.branchNumberHint") },
                  ]}
                >
                  <Input inputMode="numeric" maxLength={5} placeholder="00001" />
                </Form.Item>
              )}
            </div>
          )}
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
