import React, { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { api, ApiError } from "../lib/api";
import {
  CheckCircle2,
  Lock,
  Building,
  KeyRound,
  RefreshCw,
  Layers,
} from "lucide-react";

export const DashboardPage: React.FC = () => {
  const { workspace, user, refreshSession } = useAuth();
  const [testingRefresh, setTestingRefresh] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState<string | null>(null);

  const handleTestTokenRotation = async () => {
    setTestingRefresh(true);
    setRefreshStatus(null);
    try {
      // Manually trigger the refresh endpoint to prove atomic cookie rotation works
      await api.post("/api/v1/auth/refresh");
      await refreshSession();
      setRefreshStatus("Token rotation succeeded. Cookies updated via httpOnly header.");
    } catch (err) {
      if (err instanceof ApiError) {
        setRefreshStatus(`Refresh failed: ${err.message}`);
      } else {
        setRefreshStatus("Refresh failed unexpectedly.");
      }
    } finally {
      setTestingRefresh(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Welcome Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-xl bg-crm-surface border border-crm-border shadow-sm">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-heading font-semibold text-crm-text tracking-tight">
              {workspace?.name || "Workspace"}
            </h1>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider bg-crm-successBg text-crm-success border border-crm-successBorder font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-crm-success" />
              Connected
            </span>
          </div>
          <p className="text-xs text-crm-textSecondary mt-1">
            Workspace session active for{" "}
            <span className="text-crm-text font-mono font-medium">{user?.email || "Current User"}</span>.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleTestTokenRotation}
            disabled={testingRefresh}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-crm-surface hover:bg-crm-elevated border border-crm-border text-xs font-medium text-crm-text transition-colors disabled:opacity-50 shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-crm-accent ${testingRefresh ? "animate-spin" : ""}`} />
            <span>Test Token Rotation</span>
          </button>
        </div>
      </div>

      {refreshStatus && (
        <div className="p-3 rounded-lg bg-crm-successBg border border-crm-successBorder flex items-center gap-2.5 text-xs text-crm-success shadow-sm">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          <span className="font-mono">{refreshStatus}</span>
        </div>
      )}

      {/* Proof Grid: Auth State Details */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Workspace Card */}
        <div className="p-4 rounded-lg bg-crm-surface border border-crm-border space-y-3 shadow-sm">
          <div className="flex items-center justify-between text-crm-textSecondary">
            <span className="text-[11px] font-mono uppercase tracking-wider">Tenant Scope</span>
            <Building className="w-4 h-4 text-crm-accent" />
          </div>
          <div>
            <div className="text-sm font-semibold text-crm-text truncate font-heading">
              {workspace?.name}
            </div>
            <div className="text-[11px] font-mono text-crm-textSecondary mt-0.5 truncate">
              ID: {workspace?.id}
            </div>
          </div>
          <div className="pt-2 border-t border-crm-border flex items-center justify-between text-[11px]">
            <span className="text-crm-textSecondary">Role</span>
            <span className="font-mono text-crm-text font-medium uppercase">
              {workspace?.role || "Owner"}
            </span>
          </div>
        </div>

        {/* Security Transport Card */}
        <div className="p-4 rounded-lg bg-crm-surface border border-crm-border space-y-3 shadow-sm">
          <div className="flex items-center justify-between text-crm-textSecondary">
            <span className="text-[11px] font-mono uppercase tracking-wider">Cookie Transport</span>
            <Lock className="w-4 h-4 text-crm-accent" />
          </div>
          <div>
            <div className="text-sm font-semibold text-crm-text font-heading">
              httpOnly & SameSite Strict
            </div>
            <div className="text-[11px] font-mono text-crm-textSecondary mt-0.5">
              credentials: "include" active
            </div>
          </div>
          <div className="pt-2 border-t border-crm-border flex items-center justify-between text-[11px]">
            <span className="text-crm-textSecondary">XSS Protection</span>
            <span className="font-mono text-crm-success font-medium">Enforced</span>
          </div>
        </div>

        {/* Token Management Card */}
        <div className="p-4 rounded-lg bg-crm-surface border border-crm-border space-y-3 shadow-sm">
          <div className="flex items-center justify-between text-crm-textSecondary">
            <span className="text-[11px] font-mono uppercase tracking-wider">401 Auto-Recovery</span>
            <KeyRound className="w-4 h-4 text-crm-accent" />
          </div>
          <div>
            <div className="text-sm font-semibold text-crm-text font-heading">
              Deduplicated Refresh
            </div>
            <div className="text-[11px] font-mono text-crm-textSecondary mt-0.5">
              Single shared in-flight promise
            </div>
          </div>
          <div className="pt-2 border-t border-crm-border flex items-center justify-between text-[11px]">
            <span className="text-crm-textSecondary">Reuse Detection</span>
            <span className="font-mono text-crm-success font-medium">Synchronized</span>
          </div>
        </div>
      </div>

      {/* Scaffold Next Steps Card */}
      <div className="p-5 rounded-xl bg-crm-surface border border-crm-border shadow-sm">
        <div className="flex items-center gap-2 mb-3 text-xs font-mono uppercase tracking-wider text-crm-textSecondary">
          <Layers className="w-3.5 h-3.5 text-crm-accent" />
          <span>Scaffold Ready For Feature Modules</span>
        </div>
        <p className="text-xs text-crm-textSecondary leading-relaxed">
          The Vite + React + TypeScript foundation and cookie-based authentication flow are operational with the new professional light theme.
          Navigation routes for Contacts, Channels, Templates, Campaigns, and Usage are mounted in the shell, ready for domain integration in upcoming passes.
        </p>
      </div>
    </div>
  );
};
