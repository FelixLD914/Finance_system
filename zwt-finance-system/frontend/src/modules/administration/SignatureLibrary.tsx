import { useCallback, useEffect, useState } from "react";
import {
  CheckCircleOutlined,
  DeleteOutlined,
  EyeOutlined,
  PlusOutlined,
  ReloadOutlined,
  StopOutlined,
  TagsOutlined,
  UndoOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App as AntApp,
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Space,
  Switch,
  Table,
  Tag,
  Upload,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { UploadFile } from "antd/es/upload/interface";

import type { Translate } from "../../i18n";
import {
  deleteSignature,
  listSignatures,
  restoreSignature,
  updateSignature,
  uploadSignature,
} from "../wht/api";
import type { SignatureAsset, SignatureUsage } from "../wht/types";
import { SignaturePreviewModal } from "./SignaturePreviewModal";

interface SignatureLibraryProps {
  t: Translate;
}

const usageColors: Record<SignatureUsage, string> = {
  wht: "cyan",
  tax_inv: "blue",
  salary_advance: "purple",
};

export function SignatureLibrary({ t }: SignatureLibraryProps) {
  const { message, modal } = AntApp.useApp();
  const [signatures, setSignatures] = useState<SignatureAsset[]>([]);
  const [showDeleted, setShowDeleted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [scopeTarget, setScopeTarget] = useState<SignatureAsset | null>(null);
  const [previewTarget, setPreviewTarget] = useState<SignatureAsset | null>(null);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [form] = Form.useForm();
  const [scopeForm] = Form.useForm();

  const usageOptions = [
    { value: "wht", label: t("wht.usage.wht") },
    { value: "tax_inv", label: t("wht.usage.tax_inv") },
    { value: "salary_advance", label: t("wht.usage.salary_advance") },
  ];

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSignatures(await listSignatures(true, undefined, showDeleted));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [showDeleted]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const submitUpload = async () => {
    try {
      const values = await form.validateFields();
      const file = fileList[0]?.originFileObj;
      if (!file) {
        message.error(t("wht.signatureFileRequired"));
        return;
      }
      setPending(true);
      await uploadSignature(
        values.name,
        file,
        Boolean(values.makeDefault),
        values.usage,
      );
      message.success(t("wht.signatureUploaded"));
      setUploadOpen(false);
      setFileList([]);
      form.resetFields();
      await reload();
    } catch (uploadError) {
      if (uploadError instanceof Error) message.error(uploadError.message);
    } finally {
      setPending(false);
    }
  };

  const submitScope = async () => {
    if (!scopeTarget) return;
    try {
      const values = await scopeForm.validateFields();
      setPending(true);
      await updateSignature(scopeTarget.id, { usage: values.usage });
      message.success(t("common.saved"));
      setScopeTarget(null);
      await reload();
    } catch (scopeError) {
      if (scopeError instanceof Error) message.error(scopeError.message);
    } finally {
      setPending(false);
    }
  };

  const mutate = async (
    signature: SignatureAsset,
    input: Partial<Pick<SignatureAsset, "status" | "isDefault">>,
  ) => {
    try {
      setPending(true);
      await updateSignature(signature.id, input);
      message.success(t("common.saved"));
      await reload();
    } catch (mutationError) {
      if (mutationError instanceof Error) message.error(mutationError.message);
    } finally {
      setPending(false);
    }
  };

  const remove = (signature: SignatureAsset) => {
    modal.confirm({
      title: t("wht.deleteSignatureTitle"),
      content: t("wht.deleteSignatureHint", {
        name: signature.name,
        version: signature.version,
      }),
      okText: t("common.moveToRecycleBin"),
      cancelText: t("common.cancel"),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          setPending(true);
          await deleteSignature(signature.id);
          message.success(t("wht.signatureDeleted"));
          await reload();
        } catch (deleteError) {
          message.error(
            deleteError instanceof Error
              ? deleteError.message
              : t("common.unknownError"),
          );
          throw deleteError;
        } finally {
          setPending(false);
        }
      },
    });
  };

  const restore = async (signature: SignatureAsset) => {
    try {
      setPending(true);
      await restoreSignature(signature.id);
      message.success(t("wht.signatureRestored"));
      await reload();
    } catch (restoreError) {
      message.error(
        restoreError instanceof Error
          ? restoreError.message
          : t("common.unknownError"),
      );
    } finally {
      setPending(false);
    }
  };

  const columns: ColumnsType<SignatureAsset> = [
    {
      title: t("wht.signatureName"),
      dataIndex: "name",
      render: (name: string, signature) => (
        <div className="signature-name">
          <strong>{name}</strong>
          <span>
            v{signature.version} · {signature.originalFileName}
          </span>
        </div>
      ),
    },
    {
      title: t("wht.signatureUsage"),
      dataIndex: "usage",
      width: 260,
      // 适用范围是集合：每个模块一枚标签，比拼成一句话更容易扫。
      render: (usage: SignatureAsset["usage"]) => (
        <Space size={4} wrap>
          {usage.map((module) => (
            <Tag color={usageColors[module]} key={module}>
              {t(`wht.usage.${module}` as Parameters<typeof t>[0])}
            </Tag>
          ))}
        </Space>
      ),
    },
    ...(showDeleted
      ? [
          {
            title: t("common.deletedAt"),
            dataIndex: "deletedAt",
            width: 190,
            render: (_: string | null, signature: SignatureAsset) => (
              <div className="audit-cell">
                <span>
                  {signature.deletedAt
                    ? new Date(signature.deletedAt).toLocaleString("zh-CN", {
                        hour12: false,
                      })
                    : "—"}
                </span>
                <small>{signature.deletedByName ?? "—"}</small>
              </div>
            ),
          },
        ]
      : [
          {
            title: t("wht.active"),
            dataIndex: "status",
            width: 110,
            render: (status: SignatureAsset["status"]) => (
              <Tag color={status === "active" ? "green" : "default"}>
                {status === "active" ? t("wht.enabled") : t("wht.disabled")}
              </Tag>
            ),
          },
          {
            title: t("wht.defaultSignature"),
            dataIndex: "isDefault",
            width: 120,
            render: (isDefault: boolean) =>
              isDefault ? (
                <Tag color="gold">{t("wht.defaultSignature")}</Tag>
              ) : (
                "—"
              ),
          },
        ]),
    {
      title: t("wht.updatedAt"),
      dataIndex: "updatedAt",
      width: 180,
      render: (value: string) => new Date(value).toLocaleString("zh-CN", { hour12: false }),
    },
    {
      title: t("common.edit"),
      key: "actions",
      width: showDeleted ? 110 : 380,
      render: (_, signature) =>
        showDeleted ? (
          <Button
            disabled={pending}
            icon={<UndoOutlined />}
            size="small"
            onClick={() => void restore(signature)}
          >
            {t("common.restore")}
          </Button>
        ) : (
          <div className="table-row-actions">
            <Button
              disabled={pending}
              icon={<EyeOutlined />}
              size="small"
              onClick={() => setPreviewTarget(signature)}
            >
              {t("wht.previewSignature") || "预览效果"}
            </Button>
            <Button
              disabled={pending}
              icon={<TagsOutlined />}
              size="small"
              onClick={() => {
                scopeForm.setFieldsValue({ usage: signature.usage });
                setScopeTarget(signature);
              }}
            >
              {t("wht.signatureUsage")}
            </Button>
            {!signature.isDefault && signature.status === "active" && (
              <Button
                disabled={pending}
                icon={<CheckCircleOutlined />}
                size="small"
                onClick={() => void mutate(signature, { isDefault: true })}
              >
                {t("wht.setDefault")}
              </Button>
            )}
            <Button
              disabled={pending}
              icon={
                signature.status === "active" ? (
                  <StopOutlined />
                ) : (
                  <CheckCircleOutlined />
                )
              }
              size="small"
              onClick={() =>
                void mutate(signature, {
                  status:
                    signature.status === "active" ? "inactive" : "active",
                })
              }
            >
              {signature.status === "active"
                ? t("wht.disableSignature")
                : t("wht.enableSignature")}
            </Button>
          <Button
            danger
            disabled={pending}
            icon={<DeleteOutlined />}
            size="small"
            onClick={() => remove(signature)}
          >
            {t("common.delete")}
          </Button>
          </div>
        ),
    },
  ];

  return (
    <section className="directory-surface">
      <nav className="directory-view-switch" aria-label={t("common.dataView")}>
        <button
          className={!showDeleted ? "is-active" : ""}
          type="button"
          onClick={() => setShowDeleted(false)}
        >
          {t("common.activeRecords")}
        </button>
        <button
          className={showDeleted ? "is-active" : ""}
          type="button"
          onClick={() => setShowDeleted(true)}
        >
          {t("common.recycleBin")}
        </button>
      </nav>
      <div className="master-toolbar">
        <div>
          <strong>
            {showDeleted
              ? t("wht.signatureRecycleCount", { count: signatures.length })
              : t("wht.signatureCount", { count: signatures.length })}
          </strong>
          <p>
            {showDeleted
              ? t("wht.signatureRecycleHint")
              : t("wht.signatureHint")}
          </p>
        </div>
        <div className="page-actions">
          <Button
            aria-label={t("common.reload")}
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={() => void reload()}
          />
          {!showDeleted && (
            <Button
              icon={<PlusOutlined />}
              type="primary"
              onClick={() => setUploadOpen(true)}
            >
              {t("wht.uploadSignature")}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <Alert
          showIcon
          type="error"
          title={t("common.loadFailed")}
          description={error}
          action={
            <Button size="small" onClick={() => void reload()}>
              {t("common.retry")}
            </Button>
          }
        />
      )}

      <Table<SignatureAsset>
        columns={columns}
        dataSource={signatures}
        loading={loading}
        pagination={{
          pageSizeOptions: [8, 10, 20, 50, 100],
          showSizeChanger: true,
          defaultPageSize: 8,
        }}
        rowKey="id"
      />

      <Modal
        destroyOnHidden
        forceRender
        open={uploadOpen}
        title={t("wht.uploadSignature")}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        confirmLoading={pending}
        onCancel={() => setUploadOpen(false)}
        onOk={() => void submitUpload()}
      >
        <p className="modal-intro">{t("wht.signatureApprovalHint")}</p>
        <Form
          form={form}
          layout="vertical"
          initialValues={{ makeDefault: false, usage: ["wht"] }}
        >
          <Form.Item
            name="name"
            label={t("wht.signatureName")}
            rules={[{ required: true }]}
          >
            <Input maxLength={160} />
          </Form.Item>
          <Form.Item
            name="usage"
            label={t("wht.signatureUsage")}
            extra={t("wht.signatureUsageHint")}
            rules={[{ required: true }]}
          >
            {/* 一张签名可以同时适用于多个模块，所以是多选而不是单选。 */}
            <Checkbox.Group options={usageOptions} />
          </Form.Item>
          <Form.Item label={t("wht.signatureFile")} required>
            <Upload
              accept=".png,.jpg,.jpeg"
              beforeUpload={() => false}
              fileList={fileList}
              maxCount={1}
              onChange={({ fileList: next }) => setFileList(next)}
            >
              <Button icon={<UploadOutlined />}>{t("wht.selectSignatureFile")}</Button>
            </Upload>
          </Form.Item>
          <Form.Item name="makeDefault" label={t("wht.defaultSignature")} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      {/* 存量签名要能补勾新模块，否则新模块永远拿不到已批准的签名。 */}
      <Modal
        destroyOnHidden
        open={scopeTarget !== null}
        title={`${t("wht.signatureUsage")} · ${scopeTarget?.name ?? ""}`}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        confirmLoading={pending}
        onCancel={() => setScopeTarget(null)}
        onOk={() => void submitScope()}
      >
        <p className="modal-intro">{t("wht.signatureUsageHint")}</p>
        <Form form={scopeForm} layout="vertical">
          <Form.Item
            name="usage"
            label={t("wht.signatureUsage")}
            rules={[{ required: true, message: t("wht.signatureUsageRequired") }]}
          >
            <Checkbox.Group options={usageOptions} />
          </Form.Item>
        </Form>
      </Modal>

      <SignaturePreviewModal
        open={previewTarget !== null}
        signature={previewTarget}
        t={t}
        onClose={() => setPreviewTarget(null)}
        onSaveScale={async (signatureId, scalePercent) => {
          try {
            const updated = await updateSignature(signatureId, { scalePercent });
            message.success(`已成功将签名缩放效果 (${scalePercent}%) 应用保存至系统开票！`);
            setPreviewTarget(updated);
            setSignatures((current) =>
              current.map((item) => (item.id === signatureId ? updated : item)),
            );
            await reload();
          } catch (err) {
            message.error(err instanceof Error ? err.message : String(err));
          }
        }}
      />
    </section>
  );
}
