import { useState } from "react";
import { Alert, Button, Card, Form, Input, Typography } from "antd";

import { ApiError } from "../shared/http";
import { useAuth } from "./AuthContext";

interface LoginFormValues {
  username: string;
  password: string;
}

export function LoginScreen() {
  const { login } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(values: LoginFormValues) {
    setSubmitting(true);
    setError(null);
    try {
      await login(values.username, values.password);
    } catch (cause) {
      // 后端对"用户不存在"和"口令错误"返回同一句话，前端照原样显示，
      // 不要在这里推断或补充更具体的原因。
      setError(cause instanceof ApiError ? cause.message : "登录失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-screen">
      <Card className="login-card" variant="borderless">
        <Typography.Title level={3} className="login-title">
          ZWT 财务系统
        </Typography.Title>
        <Typography.Paragraph type="secondary" className="login-subtitle">
          请使用财务部分配的账号登录
        </Typography.Paragraph>

        {error !== null && (
          <Alert type="error" showIcon message={error} className="login-error" />
        )}

        <Form<LoginFormValues>
          layout="vertical"
          onFinish={handleSubmit}
          requiredMark={false}
          autoComplete="on"
        >
          <Form.Item
            label="用户名"
            name="username"
            rules={[{ required: true, message: "请输入用户名" }]}
          >
            <Input size="large" autoComplete="username" autoFocus />
          </Form.Item>

          <Form.Item
            label="口令"
            name="password"
            rules={[{ required: true, message: "请输入口令" }]}
          >
            <Input.Password size="large" autoComplete="current-password" />
          </Form.Item>

          <Button
            type="primary"
            size="large"
            htmlType="submit"
            block
            loading={submitting}
          >
            登录
          </Button>
        </Form>
      </Card>
    </main>
  );
}
