import { useState } from "react";
import {
  LockOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  Tooltip,
} from "antd";

import type { Translate } from "../i18n";
import { ApiError } from "../shared/http";
import { useAuth } from "./AuthContext";

interface LoginFormValues {
  username: string;
  password: string;
  rememberUsername: boolean;
}

/**
 * 只记用户名，不记密码。会话本身是 HttpOnly Cookie，有效期由服务端的
 * session_idle_minutes 决定，前端无法延长，所以这个勾选框只能做到"下次不用
 * 重新打用户名"这一件事 —— 文案也照这个范围写，不要写成"记住我"。
 */
const REMEMBERED_USERNAME_KEY = "zwt.login.username";

function rememberedUsername(): string {
  return window.localStorage.getItem(REMEMBERED_USERNAME_KEY) ?? "";
}

interface LoginScreenProps {
  onToggleLocale: () => void;
  t: Translate;
}

export function LoginScreen({ onToggleLocale, t }: LoginScreenProps) {
  const { login } = useAuth();
  const { modal } = AntApp.useApp();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [initialUsername] = useState(rememberedUsername);

  async function handleSubmit(values: LoginFormValues) {
    setSubmitting(true);
    setError(null);
    try {
      await login(values.username, values.password);
      // 只在登录成功后才写：登录失败的用户名多半是打错了，没必要带到下一次。
      if (values.rememberUsername) {
        window.localStorage.setItem(REMEMBERED_USERNAME_KEY, values.username);
      } else {
        window.localStorage.removeItem(REMEMBERED_USERNAME_KEY);
      }
    } catch (cause) {
      // 后端对"用户不存在"和"密码错误"返回同一句话，前端照原样显示，
      // 不要在这里推断或补充更具体的原因。
      setError(cause instanceof ApiError ? cause.message : t("login.failed"));
    } finally {
      setSubmitting(false);
    }
  }

  // 系统没有自助重置通道，点进来只能告诉用户该找谁 —— 但这比一个点不动的
  // 链接有用，所以入口保留。
  function showPasswordResetPath() {
    modal.info({
      title: t("login.forgotPasswordTitle"),
      content: t("login.forgotPasswordBody"),
      okText: t("common.close"),
    });
  }

  return (
    <main className="login-screen">
      {/* 装饰底图走独立图层 */}
      <div className="login-backdrop" aria-hidden="true" />

      <Card className="login-card" variant="borderless">
        <div className="login-card-header">
          <Button
            aria-label={t("login.switchLanguage")}
            className="login-locale-btn"
            type="text"
            onClick={onToggleLocale}
          >
            EN / 中文
          </Button>
        </div>

        <h1 className="login-wordmark">ZWT Finance</h1>
        <p className="login-tagline">{t("login.tagline")}</p>

        {error !== null && (
          <Alert type="error" showIcon message={error} className="login-error" />
        )}

        <Form<LoginFormValues>
          autoComplete="on"
          initialValues={{
            username: initialUsername,
            rememberUsername: initialUsername !== "",
          }}
          layout="vertical"
          requiredMark={false}
          onFinish={handleSubmit}
        >
          <Form.Item
            name="username"
            rules={[{ required: true, message: t("login.usernameRequired") }]}
          >
            <Input
              aria-label={t("login.username")}
              autoComplete="username"
              autoFocus
              placeholder={t("login.usernamePlaceholder")}
              prefix={<UserOutlined className="input-icon" />}
              size="large"
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: t("login.passwordRequired") }]}
          >
            <Input.Password
              aria-label={t("login.password")}
              autoComplete="current-password"
              placeholder={t("login.passwordPlaceholder")}
              prefix={<LockOutlined className="input-icon" />}
              size="large"
            />
          </Form.Item>

          <div className="login-options">
            <Form.Item name="rememberUsername" valuePropName="checked" noStyle>
              <Checkbox>
                <Tooltip title={t("login.rememberUsernameHint")}>
                  <span>{t("login.rememberUsername")}</span>
                </Tooltip>
              </Checkbox>
            </Form.Item>
            <Button
              className="login-forgot"
              type="link"
              onClick={showPasswordResetPath}
            >
              {t("login.forgotPassword")}
            </Button>
          </div>

          <Button
            block
            className="login-submit-btn"
            htmlType="submit"
            loading={submitting}
            size="large"
            type="primary"
          >
            {t("login.submit")}
          </Button>
        </Form>
      </Card>
    </main>
  );
}
