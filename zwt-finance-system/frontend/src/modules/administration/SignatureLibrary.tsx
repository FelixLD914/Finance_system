import { useEffect, useState } from "react";
import {
  CheckCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  StopOutlined,
  TagsOutlined,
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
import { listSignatures, updateSignature, uploadSignature } from "../wht/api";
import type { SignatureAsset, SignatureUsage } from "../wht/types";

interface SignatureLibraryProps {
  t: Translate;
}

const usageColors: Record<SignatureUsage, string> = {
  wht: "cyan",
  tax_inv: "blue",
  salary_advance: "purple",
};

export function SignatureLibrary({ t }: SignatureLibraryProps) {
  const { message } = AntApp.useApp();
  const [signatures, setSignatures] = useState<SignatureAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [scopeTarget, setScopeTarget] = useState<SignatureAsset | null>(null);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [form] = Form.useForm();
  const [scopeForm] = Form.useForm();

  const usageOptions = [
    { value: "wht", label: t("wht.usage.wht") },
    { value: "tax_inv", label: t("wht.usage.tax_inv") },
    { value: "salary_advance", label: t("wht.usage.salary_advance") },
  ];

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      setSignatures(await listSignatures(true));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

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
        isDefault ? <Tag color="gold">{t("wht.defaultSignature")}</Tag> : "—",
    },
    {
      title: t("wht.updatedAt"),
      dataIndex: "updatedAt",
      width: 180,
      render: (value: string) => new Date(value).toLocaleString("zh-CN", { hour12: false }),
    },
    {
      title: t("common.edit"),
      key: "actions",
      width: 330,
      render: (_, signature) => (
        <div className="table-row-actions">
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
            icon={signature.status === "active" ? <StopOutlined /> : <CheckCircleOutlined />}
            size="small"
            onClick={() =>
              void mutate(signature, {
                status: signature.status === "active" ? "inactive" : "active",
              })
            }
          >
            {signature.status === "active" ? t("wht.disableSignature") : t("wht.enableSignature")}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <section className="directory-surface">
      <div className="master-toolbar">
        <div>
          <strong>{t("wht.signatureCount", { count: signatures.length })}</strong>
          <p>{t("wht.signatureHint")}</p>
        </div>
        <div className="page-actions">
          <Button
            aria-label={t("common.reload")}
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={() => void reload()}
          />
          <Button icon={<PlusOutlined />} type="primary" onClick={() => setUploadOpen(true)}>
            {t("wht.uploadSignature")}
          </Button>
        </div>
      </div>

      {error && (
        <Alert
          showIcon
          type="error"
          message={t("common.loadFailed")}
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
        pagination={{ pageSize: 8, hideOnSinglePage: true }}
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
    </section>
  );
}
