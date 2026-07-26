import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { setUnauthorizedHandler } from "../shared/http";
import {
  fetchCurrentUser,
  login as loginRequest,
  logout as logoutRequest,
  type CurrentUser,
} from "./api";

interface AuthState {
  user: CurrentUser | null;
  /** 首次挂载时还在确认会话状态。此时不能直接显示登录页，否则刷新页面会闪一下。 */
  initializing: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** 权限判断的唯一入口。后端仍会独立校验，这里只决定 UI 是否显示按钮。 */
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [initializing, setInitializing] = useState(true);

  // 会话在 HttpOnly Cookie 里，JS 读不到，所以只能问后端"我是谁"。
  // 刷新页面后靠这一步恢复登录状态。
  useEffect(() => {
    let cancelled = false;
    fetchCurrentUser()
      .then((current) => {
        if (!cancelled) setUser(current);
      })
      .catch(() => {
        // 401 属于正常情况（未登录或会话过期），不做任何提示。
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setInitializing(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 任何请求返回 401 都意味着会话在服务端已经失效（过期、被吊销、账号停用）。
  // 统一在这里把本地状态清掉，界面自动回到登录页，不必每个调用点各写一遍。
  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    return () => setUnauthorizedHandler(null);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    setUser(await loginRequest(username, password));
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } finally {
      // 即使请求失败也要清本地状态：会话可能已经在服务端消失了。
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthState>(() => {
    const granted = new Set(user?.permissions ?? []);
    return {
      user,
      initializing,
      login,
      logout,
      can: (permission: string) => granted.has(permission),
    };
  }, [user, initializing, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error("useAuth 必须在 AuthProvider 内使用");
  }
  return context;
}
