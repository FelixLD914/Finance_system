import { useState } from "react";
import {
  DownOutlined,
  GlobalOutlined,
  GoogleOutlined,
  LockOutlined,
  SafetyOutlined,
  UserOutlined,
  WindowsFilled,
} from "@ant-design/icons";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Checkbox,
  Divider,
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
 * 只记用户名，不记口令。会话本身是 HttpOnly Cookie，有效期由服务端的
 * session_idle_minutes 决定，前端无法延长，所以这个勾选框只能做到"下次不用
 * 重新打用户名"这一件事 —— 文案也照这个范围写，不要写成"记住我"。
 */
const REMEMBERED_USERNAME_KEY = "zwt.login.username";

function rememberedUsername(): string {
  return window.localStorage.getItem(REMEMBERED_USERNAME_KEY) ?? "";
}

/**
 * 后端只有账号口令一条登录路径（POST /v1/auth/login），没有任何联合登录端点。
 * 这三个入口按设计稿保留位置，但必须保持 disabled：点了没反应的按钮比不画更糟，
 * 禁用态加上 tooltip 至少把"还没开通"说清楚。真接了 SSO 再逐个放开。
 */
const federatedProviders = [
  { key: "windows", label: "Windows", icon: <WindowsFilled /> },
  { key: "google", label: "Google", icon: <GoogleOutlined /> },
  { key: "sso", label: "SSO", icon: <SafetyOutlined /> },
] as const;

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
      // 后端对"用户不存在"和"口令错误"返回同一句话，前端照原样显示，
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
      {/* 装饰底图走独立图层，不参与无障碍树，也方便单独调透明度。 */}
      <div className="login-backdrop" aria-hidden="true" />

      <header className="login-topbar">
        <div className="login-brand">
          <span className="brand-zwt">ZWT</span>
          <span className="brand-finance">Finance</span>
        </div>
        <Button
          aria-label={t("login.switchLanguage")}
          className="login-locale"
          icon={<GlobalOutlined />}
          type="text"
          onClick={onToggleLocale}
        >
          {t("common.language")}
          <DownOutlined className="login-locale-caret" />
        </Button>
      </header>

      <Card className="login-card" variant="borderless">
        {/* 衬线字体只用在品牌标识上，表单标签、按钮和页脚一律 DM Sans。 */}
        <p className="login-wordmark">
          <span className="brand-zwt">ZWT</span>
          <span className="brand-finance">Finance</span>
        </p>
        <p className="login-tagline">{t("login.tagline")}</p>

        {error !== null && (
          <Alert type="error" showIcon title={error} className="login-error" />
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
          {/* 设计稿里输入框只有占位符没有可见标签，标签靠 aria-label 提供。 */}
          <Form.Item
            name="username"
            rules={[{ required: true, message: t("login.usernameRequired") }]}
          >
            <Input
              aria-label={t("login.username")}
              autoComplete="username"
              autoFocus
              placeholder={t("login.usernamePlaceholder")}
              prefix={<UserOutlined />}
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
              prefix={<LockOutlined />}
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
            htmlType="submit"
            loading={submitting}
            size="large"
            type="primary"
          >
            {t("login.submit")}
          </Button>
        </Form>

        <Divider className="login-divider" plain>
          {t("login.altDivider")}
        </Divider>

        {/* Tooltip 挂在外层容器上：disabled 按钮自己收不到 hover 事件。 */}
        <Tooltip title={t("login.ssoDisabled")}>
          <div className="login-federated">
            {federatedProviders.map((provider) => (
              <Button disabled icon={provider.icon} key={provider.key} size="large">
                {provider.label}
              </Button>
            ))}
          </div>
        </Tooltip>
      </Card>

      <footer className="login-footer">
        {/* 设计稿的 Privacy Policy / Terms 在本系统里没有对应页面，换成一句
            成立的内部使用声明，不放指不到任何地方的链接。 */}
        <span>{t("login.copyright", { year: new Date().getFullYear() })}</span>
        <span aria-hidden="true">·</span>
        <span>{t("login.internalOnly")}</span>
      </footer>
    </main>
  );
}
