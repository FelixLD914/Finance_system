import { apiRequest } from "../shared/http";

const useDemoApi = import.meta.env.VITE_USE_MOCK_API === "true";

export interface CurrentUser {
  username: string;
  displayName: string;
  role: string;
  permissions: string[];
}

const demoUser: CurrentUser = {
  username: "admin",
  displayName: "系统管理员",
  role: "admin",
  permissions: [
    "wht:read",
    "wht:write",
    "wht:approve",
    "wht:generate",
    "signature:manage",
  ],
};

export function login(username: string, password: string): Promise<CurrentUser> {
  if (useDemoApi) return Promise.resolve({ ...demoUser, username: username || "admin" });
  return apiRequest<CurrentUser>("/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function fetchCurrentUser(): Promise<CurrentUser> {
  if (useDemoApi) return Promise.resolve(demoUser);
  return apiRequest<CurrentUser>("/v1/auth/me");
}

export function logout(): Promise<{ revoked: number }> {
  if (useDemoApi) return Promise.resolve({ revoked: 1 });
  return apiRequest<{ revoked: number }>("/v1/auth/logout", { method: "POST" });
}
