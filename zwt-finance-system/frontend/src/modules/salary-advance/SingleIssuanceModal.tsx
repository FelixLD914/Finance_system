import { useEffect, useState } from "react";
import {
  AutoComplete,
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Typography,
  message,
} from "antd";
import dayjs from "dayjs";
import { useI18n } from "../../i18n";
import { createSingleSalaryAdvanceRecord, listEmployees } from "./api";
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
  const [form] = Form.useForm<FormValues>();
  const [loading, setLoading] = useState(false);
  const [employees, setEmployees] = useState<SalaryAdvanceEmployee[]>([]);
  const [selectedEmp, setSelectedEmp] = useState<SalaryAdvanceEmployee | null>(null);

  useEffect(() => {
    if (open) {
      form.resetFields();
      setSelectedEmp(null);
      const currentPeriod = dayjs().format("YYYYMM");
      form.setFieldsValue({
        period: currentPeriod,
        requestDate: dayjs(),
        approvalStatus: "Pending",
      });
      fetchEmployees();
    }
  }, [open, form]);

  const fetchEmployees = async () => {
    try {
      const res = await listEmployees(undefined, true);
      setEmployees(res.items);
    } catch {
      message.error("无法获取员工列表");
    }
  };

  const handleSelectEmployee = (empId: string) => {
    const found = employees.find((e) => e.empId === empId) || null;
    setSelectedEmp(found);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      const payload = {
        empId: values.empId,
        period: values.period,
        requestDate: values.requestDate.format("YYYY-MM-DD"),
        advanceAmount: values.advanceAmount,
        monthlyDeduction: values.monthlyDeduction,
        reason: values.reason,
        approvalStatus: values.approvalStatus,
        remark: values.remark,
      };

      const result = await createSingleSalaryAdvanceRecord(payload);
      message.success(t("salary.createSingleSuccess"));
      onSuccess(result);
      onClose();
    } catch (err: unknown) {
      if (err && typeof err === "object" && "detail" in err) {
        const detail = (err as { detail: string }).detail;
        message.error(detail);
      } else if (err && typeof err === "object" && "message" in err) {
        message.error((err as { message: string }).message);
      }
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
      okText="提交录入"
      cancelText="取消"
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
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
            rules={[{ required: true, message: "请选择申请日期" }]}
          >
            <DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" />
          </Form.Item>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Form.Item
            name="advanceAmount"
            label={t("salary.advanceAmount")}
            rules={[{ required: true, message: "请输入预支金额" }]}
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
              placeholder="默认等于预支金额"
            />
          </Form.Item>
        </div>

        <Form.Item name="reason" label={t("salary.reason")}>
          <Input maxLength={100} placeholder="请输入预支原因" />
        </Form.Item>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Form.Item name="approvalStatus" label={t("salary.approvalStatus")}>
            <Select
              options={[
                { value: "Pending", label: "Pending (待确定)" },
                { value: "Approve", label: "Approve (已批准)" },
                { value: "Not approved", label: "Not approved (未批准)" },
              ]}
            />
          </Form.Item>

          <Form.Item name="remark" label="备注">
            <Input placeholder="可选备注" />
          </Form.Item>
        </div>
      </Form>
    </Modal>
  );
}
