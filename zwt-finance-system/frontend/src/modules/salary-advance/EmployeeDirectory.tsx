import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DeleteOutlined,
  DownloadOutlined,
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
  DatePicker,
  Form,
  Input,
  Modal,
  Switch,
  Table,
  Tag,
  Upload,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { UploadProps } from "antd";
import dayjs from "dayjs";

import type { Translate } from "../../i18n";
import {
  EMPLOYEE_PAGE_LIMIT,
  createEmployee,
  deleteEmployee,
  downloadEmployeeTemplate,
  getEmployeeDeletePreview,
  importEmployees,
  listEmployees,
  restoreEmployee,
  updateEmployee,
} from "./api";
import type { EmployeeInput, SalaryAdvanceEmployee } from "./types";

interface EmployeeDirectoryProps {
  t: Translate;
}

interface EmployeeFormValues {
  empId: string;
  firstName: string;
  surname: string;
  department: string;
  position: string;
  startDate: dayjs.Dayjs;
  enName?: string;
  chineseName?: string;
  isActive: boolean;
}

export function EmployeeDirectory({ t }: EmployeeDirectoryProps) {
  const { message, modal } = AntApp.useApp();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"active" | "deleted">("active");
  const [employees, setEmployees] = useState<SalaryAdvanceEmployee[]>([]);
  const [deletedEmployees, setDeletedEmployees] = useState<SalaryAdvanceEmployee[]>([]);
  const [truncatedTotal, setTruncatedTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [editing, setEditing] = useState<SalaryAdvanceEmployee | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm<EmployeeFormValues>();

  const loadActiveEmployees = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listEmployees(undefined, false, false, 1, EMPLOYEE_PAGE_LIMIT);
      setEmployees(res.items);
      // 搜索框是在已加载的这一页里过滤的，超出一页时不说出来就等于谎报"查无此人"。
      setTruncatedTotal(res.total > res.items.length ? res.total : 0);
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("common.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [message, t]);

  const loadDeletedEmployees = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listEmployees(undefined, false, true, 1, EMPLOYEE_PAGE_LIMIT);
      setDeletedEmployees(res.items);
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("common.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [message, t]);

  useEffect(() => {
    if (view === "active") {
      void loadActiveEmployees();
    } else {
      void loadDeletedEmployees();
    }
  }, [loadActiveEmployees, loadDeletedEmployees, view]);

  const filtered = useMemo(() => {
    const source = view === "deleted" ? deletedEmployees : employees;
    const normalized = query.trim().toLowerCase();
    if (!normalized) return source;
    return source.filter((emp) =>
      [emp.empId, emp.firstName, emp.surname, emp.enName, emp.chineseName, emp.department, emp.position]
        .filter(Boolean)
        .some((val) => val?.toLowerCase().includes(normalized)),
    );
  }, [deletedEmployees, employees, query, view]);

  const openEditor = (employee?: SalaryAdvanceEmployee) => {
    setEditing(employee ?? null);
    form.resetFields();
    if (employee) {
      form.setFieldsValue({
        empId: employee.empId,
        firstName: employee.firstName ?? "",
        surname: employee.surname ?? "",
        enName: employee.enName ?? "",
        chineseName: employee.chineseName ?? "",
        department: employee.department ?? "",
        position: employee.position ?? "",
        // 导入进来的历史记录可能缺这些字段，此处留空，必填规则会逼着补齐后才能保存。
        startDate: employee.startDate ? dayjs(employee.startDate) : undefined,
        isActive: employee.isActive,
      });
    } else {
      form.setFieldsValue({ isActive: true });
    }
    setModalOpen(true);
  };

  const save = async () => {
    let values: EmployeeFormValues;
    try {
      values = await form.validateFields();
    } catch {
      // antd 已把错误标在字段上；再往上抛只会变成一个没人接的 rejection。
      return;
    }
    setPending(true);
    try {
      const payload: EmployeeInput = {
        empId: values.empId.trim(),
        firstName: values.firstName.trim(),
        surname: values.surname.trim(),
        department: values.department.trim(),
        position: values.position.trim(),
        startDate: values.startDate.format("YYYY-MM-DD"),
        enName: values.enName?.trim() || null,
        chineseName: values.chineseName?.trim() || null,
        isActive: values.isActive,
      };

      if (editing) {
        await updateEmployee(editing.id, payload);
        message.success(t("common.saved"));
      } else {
        await createEmployee(payload);
        message.success(t("common.saved"));
      }

      setModalOpen(false);
      void loadActiveEmployees();
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("common.loadFailed"));
    } finally {
      setPending(false);
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      await downloadEmployeeTemplate();
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("common.loadFailed"));
    }
  };

  const uploadProps: UploadProps = {
    accept: ".xlsx",
    showUploadList: false,
    beforeUpload: (file) => {
      setPending(true);
      importEmployees(file)
        .then((res) => {
          message.success(
            t("salary.importEmployeesSuccess", {
              created: res.created,
              updated: res.updated,
            }),
          );
          void loadActiveEmployees();
        })
        .catch((err) => {
          message.error(err instanceof Error ? err.message : t("common.loadFailed"));
        })
        .finally(() => {
          setPending(false);
        });
      return false;
    },
  };

  const confirmDelete = async (employee: SalaryAdvanceEmployee) => {
    setPending(true);
    try {
      const preview = await getEmployeeDeletePreview(employee.id);
      modal.confirm({
        title: t("salary.deleteEmployeeTitle"),
        icon: <DeleteOutlined style={{ color: "#ff4d4f" }} />,
        content: (
          <div style={{ marginTop: 8 }}>
            <p>{t("salary.deleteEmployeeBody")}</p>
            {preview.referencingRecords > 0 && (
              <Alert
                showIcon
                message={t("salary.deleteEmployeeReferencingHint", {
                  count: preview.referencingRecords,
                })}
                style={{ marginTop: 8 }}
                type="info"
              />
            )}
          </div>
        ),
        okText: t("common.moveToRecycleBin"),
        okButtonProps: { danger: true },
        cancelText: t("common.cancel"),
        onOk: async () => {
          try {
            await deleteEmployee(employee.id);
            message.success(t("common.saved"));
            void loadActiveEmployees();
          } catch (err) {
            message.error(err instanceof Error ? err.message : t("common.loadFailed"));
          }
        },
      });
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("common.loadFailed"));
    } finally {
      setPending(false);
    }
  };

  const handleRestore = async (employee: SalaryAdvanceEmployee) => {
    setPending(true);
    try {
      await restoreEmployee(employee.id);
      message.success(t("salary.restoreEmployeeSuccess"));
      void loadDeletedEmployees();
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("common.loadFailed"));
    } finally {
      setPending(false);
    }
  };

  const columns: ColumnsType<SalaryAdvanceEmployee> = [
    {
      title: t("salary.empId"),
      dataIndex: "empId",
      key: "empId",
      render: (text: string) => <strong>{text}</strong>,
    },
    {
      title: t("salary.enName"),
      dataIndex: "enName",
      key: "enName",
      render: (text: string | null, record) =>
        text || [record.firstName, record.surname].filter(Boolean).join(" ") || "—",
    },
    {
      title: t("salary.chineseName"),
      dataIndex: "chineseName",
      key: "chineseName",
      render: (text: string | null) => text || "—",
    },
    {
      title: t("salary.department"),
      dataIndex: "department",
      key: "department",
      render: (text: string | null) => text || "—",
    },
    {
      title: t("salary.position"),
      dataIndex: "position",
      key: "position",
      render: (text: string | null) => text || "—",
    },
    {
      title: t("salary.startDate"),
      dataIndex: "startDate",
      key: "startDate",
      render: (text: string | null) => text || "—",
    },
    {
      title: t("salary.isActive"),
      dataIndex: "isActive",
      key: "isActive",
      render: (active: boolean) => (
        <Tag color={active ? "success" : "default"}>
          {active ? t("salary.statusActive") : t("salary.statusInactive")}
        </Tag>
      ),
    },
    {
      title: t("common.actions"),
      key: "actions",
      render: (_, record) =>
        view === "active" ? (
          <div style={{ display: "flex", gap: 8 }}>
            <Button
              icon={<EditOutlined />}
              size="small"
              type="text"
              onClick={() => openEditor(record)}
            >
              {t("common.edit")}
            </Button>
            <Button
              danger
              icon={<DeleteOutlined />}
              size="small"
              type="text"
              onClick={() => void confirmDelete(record)}
            >
              {t("common.delete")}
            </Button>
          </div>
        ) : (
          <Button
            icon={<UndoOutlined />}
            size="small"
            type="primary"
            onClick={() => void handleRestore(record)}
          >
            {t("common.restore")}
          </Button>
        ),
    },
  ];

  return (
    <div className="employee-directory" style={{ padding: "16px 0" }}>
      <div
        className="toolbar"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Input
            allowClear
            placeholder={t("salary.employeeSearchPlaceholder")}
            prefix={<SearchOutlined />}
            style={{ width: 280 }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button
            type={view === "active" ? "primary" : "default"}
            onClick={() => setView("active")}
          >
            {t("common.activeRecords")}
          </Button>
          <Button
            type={view === "deleted" ? "primary" : "default"}
            onClick={() => setView("deleted")}
          >
            {t("common.recycleBin")}
          </Button>
        </div>

        {view === "active" && (
          <div style={{ display: "flex", gap: 8 }}>
            <Button
              icon={<DownloadOutlined />}
              onClick={() => void handleDownloadTemplate()}
            >
              {t("salary.downloadTemplate")}
            </Button>
            <Upload {...uploadProps}>
              <Button icon={<UploadOutlined />} loading={pending}>
                {t("salary.importEmployees")}
              </Button>
            </Upload>
            <Button
              icon={<PlusOutlined />}
              type="primary"
              onClick={() => openEditor()}
            >
              {t("salary.newEmployee")}
            </Button>
          </div>
        )}
      </div>

      {view === "active" && truncatedTotal > 0 && (
        <Alert
          showIcon
          type="warning"
          style={{ marginBottom: 16 }}
          message={t("salary.employeeListTruncated", {
            total: truncatedTotal,
            shown: employees.length,
          })}
        />
      )}

      <Table
        columns={columns}
        dataSource={filtered}
        loading={loading}
        rowKey="id"
        pagination={{ pageSize: 20 }}
      />

      <Modal
        cancelText={t("common.cancel")}
        confirmLoading={pending}
        okText={t("common.save")}
        open={modalOpen}
        title={editing ? t("salary.editEmployee") : t("salary.newEmployee")}
        onCancel={() => setModalOpen(false)}
        onOk={() => void save()}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            label={t("salary.empId")}
            name="empId"
            rules={[{ required: true, message: t("salary.empId") }]}
          >
            <Input disabled={Boolean(editing)} placeholder="EMP001" />
          </Form.Item>
          <Form.Item label={t("salary.enName")} name="enName">
            <Input placeholder="Somchai Saelim" />
          </Form.Item>

          {/* 这五项是预支单上要印的内容，后端 EmployeeCreate/EmployeeUpdate 同样必填：
              存得下、开不出来的员工记录不该存在，报错要落在这里而不是开具弹窗里。 */}
          <div style={{ display: "flex", gap: 12 }}>
            <Form.Item
              label={t("salary.firstName")}
              name="firstName"
              rules={[{ required: true, message: t("salary.employeeFieldRequired") }]}
              style={{ flex: 1 }}
            >
              <Input placeholder="Somchai" />
            </Form.Item>
            <Form.Item
              label={t("salary.surname")}
              name="surname"
              rules={[{ required: true, message: t("salary.employeeFieldRequired") }]}
              style={{ flex: 1 }}
            >
              <Input placeholder="Saelim" />
            </Form.Item>
          </div>

          <div style={{ display: "flex", gap: 12 }}>
            <Form.Item label={t("salary.chineseName")} name="chineseName" style={{ flex: 1 }}>
              <Input placeholder="宋柴" />
            </Form.Item>
            <Form.Item
              label={t("salary.department")}
              name="department"
              rules={[{ required: true, message: t("salary.employeeFieldRequired") }]}
              style={{ flex: 1 }}
            >
              <Input placeholder="IT" />
            </Form.Item>
          </div>

          <div style={{ display: "flex", gap: 12 }}>
            <Form.Item
              label={t("salary.position")}
              name="position"
              rules={[{ required: true, message: t("salary.employeeFieldRequired") }]}
              style={{ flex: 1 }}
            >
              <Input placeholder="Software Engineer" />
            </Form.Item>
            <Form.Item
              label={t("salary.startDate")}
              name="startDate"
              rules={[{ required: true, message: t("salary.employeeFieldRequired") }]}
              style={{ flex: 1 }}
            >
              <DatePicker style={{ width: "100%" }} />
            </Form.Item>
          </div>

          <Form.Item label={t("salary.isActive")} name="isActive" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
