import { useEffect, useState } from "react";
import {
  Alert,
  App as AntApp,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Typography,
} from "antd";
import dayjs from "dayjs";
import { useI18n } from "../../i18n";
import {
  EMPLOYEE_PAGE_LIMIT,
  createSingleSalaryAdvanceRecord,
  listEmployees,
} from "./api";
import type { SalaryAdvanceBatchDetail, SalaryAdvanceEmployee } from "./types";

const { Text } = Typography;

interface SingleIssuanceModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (batchDetail: SalaryAdvanceBatchDetail) => void;
}

interface FormValues {
  empId: string;
  period: string;
  requestDate: dayjs.Dayjs;
  advanceAmount: number;
  monthlyDeduction?: number;
  reason?: string;
  approvalStatus: "Approve" | "Not approved" | "Pending";
  remark?: string;
}

export function SingleIssuanceModal({
  open,
  onClose,
  onSuccess,
}: SingleIssuanceModalProps) {
  const { t } = useI18n();
  const { message } = AntApp.useApp();
  const [form] = Form.useForm<FormValues>();
  const [loading, setLoading] = useState(false);
  const [employees, setEmployees] = useState<SalaryAdvanceEmployee[]>([]);
  const [truncatedTotal, setTruncatedTotal] = useState(0);
  const [selectedEmp, setSelectedEmp] = useState<SalaryAdvanceEmployee | null>(null);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    setSelectedEmp(null);
    form.setFieldsValue({
      period: dayjs().format("YYYYMM"),
      requestDate: dayjs(),
      approvalStatus: "Pending",
    });

    const fetchEmployees = async () => {
      try {
        const res = await listEmployees(undefined, true, false, 1, EMPLOYEE_PAGE_LIMIT);
        setEmployees(res.items);
        // 人数超过一页时必须说出来：下拉里选不到的人和"这个人不存在"长得一模一样。
        setTruncatedTotal(res.total > res.items.length ? res.total : 0);
      } catch (err) {
        setTruncatedTotal(0);
        message.error(
          err instanceof Error ? err.message : t("salary.employeeListLoadFailed"),
        );
      }
    };
    void fetchEmployees();
  }, [open, form, message, t]);

  const handleSelectEmployee = (empId: string) => {
    setSelectedEmp(employees.find((e) => e.empId === empId) ?? null);
  };

  const handleSubmit = async () => {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      // antd 已经把错误标在字段上了，这里不用再弹一次。
      return;
    }

    setLoading(true);
    try {
      const result = await createSingleSalaryAdvanceRecord({
        empId: values.empId,
        period: values.period,
        requestDate: values.requestDate.format("YYYY-MM-DD"),
        advanceAmount: values.advanceAmount,
        monthlyDeduction: values.monthlyDeduction,
        reason: values.reason,
        approvalStatus: values.approvalStatus,
        remark: values.remark,
      });
      message.success(t("salary.createSingleSuccess"));
      onSuccess(result);
      onClose();
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const employeeOptions = employees.map((emp) => {
    const name = emp.enName || emp.chineseName || `${emp.firstName || ""} ${emp.surname || ""}`.trim();
    return {
      value: emp.empId,
      label: `${emp.empId} - ${name} (${emp.department || "-"})`,
    };
  });

  return (
    <Modal
      title={t("salary.singleIssuanceModalTitle")}
      open={open}
      onCancel={onClose}
      onOk={handleSubmit}
      confirmLoading={loading}
      width={650}
      okText={t("salary.singleIssuanceSubmit")}
      cancelText={t("common.cancel")}
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        {truncatedTotal > 0 && (
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

        <Form.Item
          name="empId"
          label={t("salary.selectEmployee")}
          rules={[{ required: true, message: t("salary.selectEmployeeRequired") }]}
        >
          <Select
            showSearch
            placeholder={t("salary.selectEmployeePlaceholder")}
            options={employeeOptions}
            onChange={handleSelectEmployee}
            filterOption={(input, option) =>
              (option?.label ?? "").toLowerCase().includes(input.toLowerCase())
            }
          />
        </Form.Item>

        {selectedEmp && (
          <div
            style={{
              background: "#fafafa",
              padding: "12px 16px",
              borderRadius: 6,
              marginBottom: 16,
              border: "1px solid #f0f0f0",
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <Text type="secondary">{t("salary.applicant")}: </Text>
                <Text strong>
                  {selectedEmp.enName ||
                    selectedEmp.chineseName ||
                    `${selectedEmp.firstName || ""} ${selectedEmp.surname || ""}`}
                </Text>
              </div>
              <div>
                <Text type="secondary">{t("salary.department")}: </Text>
                <Text>{selectedEmp.department || "-"}</Text>
              </div>
              <div>
                <Text type="secondary">{t("salary.position")}: </Text>
                <Text>{selectedEmp.position || "-"}</Text>
              </div>
              <div>
                <Text type="secondary">{t("salary.startDate")}: </Text>
                <Text>{selectedEmp.startDate || "-"}</Text>
              </div>
            </div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Form.Item
            name="period"
            label={t("salary.importPeriod")}
            rules={[
              { required: true, message: t("salary.importPeriodRequired") },
              { pattern: /^\d{6}$/, message: t("salary.importPeriodFormat") },
            ]}
          >
            <Input placeholder="YYYYMM" maxLength={6} />
          </Form.Item>

          <Form.Item
            name="requestDate"
            label={t("salary.requestDate")}
            rules={[{ required: true, message: t("salary.requestDateRequired") }]}
          >
            <DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" />
          </Form.Item>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Form.Item
            name="advanceAmount"
            label={t("salary.advanceAmount")}
            rules={[{ required: true, message: t("salary.advanceAmountRequired") }]}
          >
            <InputNumber
              id="advanceAmount"
              style={{ width: "100%" }}
              min={0.01}
              precision={2}
              placeholder="0.00"
            />
          </Form.Item>

          <Form.Item name="monthlyDeduction" label={t("salary.monthlyDeduction")}>
            <InputNumber
              style={{ width: "100%" }}
              min={0.01}
              precision={2}
              placeholder={t("salary.monthlyDeductionPlaceholder")}
            />
          </Form.Item>
        </div>

        <Form.Item name="reason" label={t("salary.reason")}>
          <Input maxLength={100} placeholder={t("salary.reasonPlaceholder")} />
        </Form.Item>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Form.Item name="approvalStatus" label={t("salary.approvalStatus")}>
            <Select
              options={[
                { value: "Pending", label: t("salary.approvalPending") },
                { value: "Approve", label: t("salary.approvalApprove") },
                { value: "Not approved", label: t("salary.approvalNotApproved") },
              ]}
            />
          </Form.Item>

          <Form.Item name="remark" label={t("salary.remark")}>
            <Input placeholder={t("salary.remarkPlaceholder")} />
          </Form.Item>
        </div>
      </Form>
    </Modal>
  );
}
