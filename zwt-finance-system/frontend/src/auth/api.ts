import { apiRequest } from "../shared/http";

export interface CurrentUser {
  username: string;
  displayName: string;
  role: string;
  permissions: string[];
}

export function login(username: string, password: string): Promise<CurrentUser> {
  return apiRequest<CurrentUser>("/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function fetchCurrentUser(): Promise<CurrentUser> {
  return apiRequest<CurrentUser>("/v1/auth/me");
}

export function logout(): Promise<{ revoked: number }> {
  return apiRequest<{ revoked: number }>("/v1/auth/logout", { method: "POST" });
}
