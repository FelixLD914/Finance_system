/**
 * 共用 HTTP 客户端。
 *
 * 会话凭证放在 HttpOnly Cookie 里，JS 读不到也不需要读 —— 同源请求由浏览器
 * 自动带上。这里要做的是另一半：把 CSRF 令牌从非 HttpOnly 的 Cookie 读出来，
 * 放进 X-CSRF-Token 请求头，构成双提交校验。
 *
 * 所有模块都必须走这里，否则漏掉 CSRF 头的写请求会被后端 403 拒绝。
 */

export const apiBase = import.meta.env.VITE_API_BASE_URL ?? "/api";

// 必须与后端 Settings.csrf_cookie_name 保持一致。
const CSRF_COOKIE_NAME = "zwt_csrf";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** 逐条明细。批量导入会一次退回所有出错行，界面要能全部列出来。 */
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** 401：会话缺失或已过期。调用方应当把界面切回登录页，而不是弹一个报错。 */
export class UnauthorizedError extends ApiError {
  constructor(message: string) {
    super(message, 401);
    this.name = "UnauthorizedError";
  }
}

export function readCsrfToken(): string | null {
  // document.cookie 是 "a=1; b=2" 形式；值可能被 URL 编码。
  for (const part of document.cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === CSRF_COOKIE_NAME) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

function buildHeaders(init: RequestInit | undefined): HeadersInit {
  const method = (init?.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = {};

  // FormData 必须让浏览器自己带 multipart 边界，不能手写 Content-Type。
  if (init?.body !== undefined && !(init.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  if (!SAFE_METHODS.has(method)) {
    const csrf = readCsrfToken();
    if (csrf) {
      headers["X-CSRF-Token"] = csrf;
    }
  }

  return { ...headers, ...(init?.headers as Record<string, string> | undefined) };
}

/**
 * 401 回调。AuthProvider 注册它，用于在会话失效时把界面切回登录页。
 *
 * 做成显式回调而不是监听 unhandledrejection：各个组件都会自己 catch 掉
 * ApiError 用来显示错误提示，那些 401 永远不会变成未处理的 rejection。
 */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

type ErrorDetail = string | { message?: string; errors?: string[] };

async function toError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as { detail?: ErrorDetail } | null;
  const raw = body?.detail;
  // FastAPI 的 detail 可以是字符串，也可以是对象；批量导入用的是后者
  // （{message, errors}）。不分开处理会得到一句 "[object Object]"。
  const message =
    (typeof raw === "string" ? raw : raw?.message) ?? `请求失败（${response.status}）`;
  const details = typeof raw === "string" ? [] : (raw?.errors ?? []);
  if (response.status === 401) {
    onUnauthorized?.();
    return new UnauthorizedError(message);
  }
  return new ApiError(message, response.status, details);
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    // 显式声明：会话 Cookie 必须随请求发出。
    credentials: "same-origin",
    headers: buildHeaders(init),
  });
  if (!response.ok) {
    throw await toError(response);
  }
  return response;
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}
