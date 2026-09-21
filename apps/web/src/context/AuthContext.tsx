import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "../lib/api";

export interface User {
  id: string;
  email?: string;
}

export interface Workspace {
  id: string;
  name: string;
  role?: string;
}

interface AuthContextType {
  user: User | null;
  workspace: Workspace | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, workspaceName: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const checkSession = useCallback(async () => {
    try {
      const data = await api.get<{
        user: { id: string; email: string };
        workspace: { id: string; name: string; role?: string };
      }>("/api/v1/auth/me");

      setUser(data.user);
      setWorkspace(data.workspace);
    } catch {
      setUser(null);
      setWorkspace(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkSession();

    const handleSessionExpired = () => {
      setUser(null);
      setWorkspace(null);
      setIsLoading(false);
    };

    window.addEventListener("nextcrm:session-expired", handleSessionExpired);
    return () => {
      window.removeEventListener("nextcrm:session-expired", handleSessionExpired);
    };
  }, [checkSession]);

  const login = async (email: string, password: string) => {
    const res = await api.post<{
      workspaces: Array<{ id: string; name: string; role: string }>;
    }>("/api/v1/auth/login", { email, password });

    if (res.workspaces && res.workspaces.length > 0) {
      const primaryWorkspace = res.workspaces[0];
      setWorkspace({
        id: primaryWorkspace.id,
        name: primaryWorkspace.name,
        role: primaryWorkspace.role,
      });
      setUser({ id: "current", email });
    }
  };

  const signup = async (email: string, password: string, workspaceName: string) => {
    const res = await api.post<{
      workspace: { id: string; name: string };
    }>("/api/v1/auth/signup", { email, password, workspaceName });

    if (res.workspace) {
      setWorkspace({
        id: res.workspace.id,
        name: res.workspace.name,
        role: "owner",
      });
      setUser({ id: "current", email });
    }
  };

  const logout = async () => {
    try {
      await api.post("/api/v1/auth/logout");
    } catch (err) {
      console.warn("Logout error:", err);
    } finally {
      setUser(null);
      setWorkspace(null);
    }
  };

  const value: AuthContextType = {
    user,
    workspace,
    isLoading,
    isAuthenticated: Boolean(workspace),
    login,
    signup,
    logout,
    refreshSession: checkSession,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
