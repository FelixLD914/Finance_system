import { useEffect, useState } from "react";
import {
  CheckCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  StopOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App as AntApp,
  Button,
  Form,
  Input,
  Modal,
  Radio,
  Switch,
  Table,
  Tag,
  Upload,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { UploadFile } from "antd/es/upload/interface";

import type { Translate } from "../../i18n";
import { listSignatures, updateSignature, uploadSignature } from "../wht/api";
import type { SignatureAsset } from "../wht/types";

interface SignatureLibraryProps {
  t: Translate;
}

export function SignatureLibrary({ t }: SignatureLibraryProps) {
  const { message } = AntApp.useApp();
  const [signatures, setSignatures] = useState<SignatureAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [form] = Form.useForm();

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
      width: 150,
      render: (usage: SignatureAsset["usage"]) => (
        <Tag color={usage === "both" ? "purple" : usage === "tax_inv" ? "blue" : "cyan"}>
          {t(`wht.usage.${usage}` as Parameters<typeof t>[0])}
        </Tag>
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
      width: 230,
      render: (_, signature) => (
        <div className="table-row-actions">
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
          initialValues={{ makeDefault: false, usage: "wht" }}
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
            <Radio.Group
              options={[
                { value: "wht", label: t("wht.usage.wht") },
                { value: "tax_inv", label: t("wht.usage.tax_inv") },
                { value: "both", label: t("wht.usage.both") },
              ]}
              optionType="button"
            />
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
    </section>
  );
}
