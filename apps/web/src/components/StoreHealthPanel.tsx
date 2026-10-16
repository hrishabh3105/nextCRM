import React, { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

export interface HealthCheckItem {
  key: string;
  status: "ok" | "warn" | "error";
  message: string;
  fix?: string;
}

interface StoreHealthPanelProps {
  storeId: string;
  shopDomain: string;
}

export const StoreHealthPanel: React.FC<StoreHealthPanelProps> = ({
  storeId,
}) => {
  const [checks, setChecks] = useState<HealthCheckItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<boolean>(false);

  const fetchHealth = useCallback(
    async (force = false) => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.get<{ checks: HealthCheckItem[] }>(
          `/api/v1/stores/${storeId}/health${force ? "?force=true" : ""}`
        );
        setChecks(data.checks || []);
      } catch (err: any) {
        setError(err?.message || "Failed to load store health diagnostics.");
      } finally {
        setLoading(false);
      }
    },
    [storeId]
  );

  useEffect(() => {
    fetchHealth(false);
  }, [fetchHealth]);

  const errorCount = checks.filter((c) => c.status === "error").length;
  const warnCount = checks.filter((c) => c.status === "warn").length;
  const okCount = checks.filter((c) => c.status === "ok").length;

  return (
    <div className="border border-crm-border rounded-lg bg-crm-bg/70 overflow-hidden shadow-xs">
      {/* Panel Header */}
      <div className="p-3 bg-white border-b border-crm-border flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-crm-accent" />
          <span className="text-xs font-semibold text-crm-text">
            Store Health &amp; Diagnostics
          </span>
          {!loading && checks.length > 0 && (
            <div className="flex items-center gap-1.5 ml-1">
              {errorCount > 0 && (
                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-red-50 text-red-700 border border-red-200">
                  {errorCount} Error{errorCount > 1 ? "s" : ""}
                </span>
              )}
              {warnCount > 0 && (
                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-amber-50 text-amber-700 border border-amber-200">
                  {warnCount} Warn{warnCount > 1 ? "s" : ""}
                </span>
              )}
              {errorCount === 0 && warnCount === 0 && (
                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  {okCount} OK
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fetchHealth(true)}
            disabled={loading}
            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-crm-text bg-white border border-crm-border rounded hover:bg-crm-elevated transition-colors shadow-xs disabled:opacity-60"
          >
            {loading ? (
              <Loader2 className="w-3 h-3 text-crm-accent animate-spin" />
            ) : (
              <RefreshCw className="w-3 h-3 text-crm-accent" />
            )}
            <span>Re-check</span>
          </button>

          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="p-1 text-crm-textSecondary hover:text-crm-text rounded transition-colors"
            title={collapsed ? "Expand checks" : "Collapse checks"}
          >
            {collapsed ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Panel Body */}
      {!collapsed && (
        <div className="p-3 space-y-2">
          {loading && checks.length === 0 ? (
            <div className="py-4 flex items-center justify-center gap-2 text-xs font-mono text-crm-textSecondary">
              <Loader2 className="w-4 h-4 text-crm-accent animate-spin" />
              <span>Running health checks...</span>
            </div>
          ) : error ? (
            <div className="p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : checks.length === 0 ? (
            <div className="text-xs text-crm-textMuted italic py-2">
              No health checks available.
            </div>
          ) : (
            <div className="space-y-1.5">
              {checks.map((check) => {
                let badgeClass = "bg-emerald-50 text-emerald-800 border-emerald-200";
                let Icon = CheckCircle2;
                let iconColor = "text-emerald-600";

                if (check.status === "warn") {
                  badgeClass = "bg-amber-50 text-amber-800 border-amber-200";
                  Icon = AlertTriangle;
                  iconColor = "text-amber-600";
                } else if (check.status === "error") {
                  badgeClass = "bg-red-50 text-red-800 border-red-200";
                  Icon = AlertCircle;
                  iconColor = "text-red-600";
                }

                return (
                  <div
                    key={check.key}
                    className="p-2 bg-white border border-crm-border/70 rounded-md text-xs space-y-1"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2">
                        <Icon className={`w-4 h-4 ${iconColor} shrink-0 mt-0.5`} />
                        <span className="text-crm-text leading-tight font-medium">
                          {check.message}
                        </span>
                      </div>
                      <span
                        className={`inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-mono uppercase font-bold border ${badgeClass} shrink-0`}
                      >
                        {check.status}
                      </span>
                    </div>

                    {check.fix && (
                      <div className="ml-6 p-1.5 rounded bg-amber-50/80 border border-amber-200/80 text-[11px] text-amber-900 flex items-start gap-1">
                        <span className="font-semibold text-amber-950 shrink-0">Fix:</span>
                        <span>{check.fix}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
