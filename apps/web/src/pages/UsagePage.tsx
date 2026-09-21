import React, { useState, useEffect, useCallback } from "react";
import { api, ApiError } from "../lib/api";
import {
  DollarSign,
  Send,
  Calendar,
  RefreshCw,
  AlertCircle,
  Loader2,
  TrendingUp,
  ShieldAlert,
  Info,
} from "lucide-react";

export interface UsageCosts {
  totalSpend: string | number;
  messageCount: number;
  currency: string;
  periodStart: string;
}

function formatPeriodStart(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return `Since ${d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    })}`;
  } catch {
    return dateStr;
  }
}

function formatCurrency(amount: number, currency = "USD"): string {
  // If fractional cents exist (e.g. $0.115 or $0.0325), display up to 4 decimal places
  const hasSubCentFraction = (amount * 100) % 1 !== 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: hasSubCentFraction ? 4 : 2,
  }).format(amount);
}

export const UsagePage: React.FC = () => {
  const [data, setData] = useState<UsageCosts | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchUsageCosts = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const response = await api.get<UsageCosts>("/api/v1/usage/costs");
      setData(response);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to load usage costs.");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchUsageCosts();
  }, [fetchUsageCosts]);

  // Ensure totalSpend is safely parsed as float (handles string from Decimal serialization)
  const numericSpend = data
    ? typeof data.totalSpend === "number"
      ? data.totalSpend
      : parseFloat(String(data.totalSpend || "0")) || 0
    : 0;

  const messageCount = data?.messageCount ?? 0;
  const currency = data?.currency || "USD";
  const periodStart = data?.periodStart;

  const avgCostPerMessage = messageCount > 0 ? numericSpend / messageCount : 0;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-xl bg-crm-surface border border-crm-border shadow-sm">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-heading font-semibold text-crm-text tracking-tight">
              Usage & Costs
            </h1>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono text-crm-textSecondary bg-crm-elevated border border-crm-border font-medium">
              <Calendar className="w-3 h-3 text-crm-accent" />
              <span>{periodStart ? formatPeriodStart(periodStart) : "Current Month"}</span>
            </span>
          </div>
          <p className="text-xs text-crm-textSecondary mt-1">
            Month-to-date Meta Cloud API messaging spend and delivery volume.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchUsageCosts(true)}
            disabled={loading || refreshing}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-crm-surface hover:bg-crm-elevated border border-crm-border text-xs font-medium text-crm-text transition-colors disabled:opacity-50 shadow-sm"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 text-crm-accent ${refreshing ? "animate-spin" : ""}`}
            />
            <span>{refreshing ? "Refreshing..." : "Refresh"}</span>
          </button>
        </div>
      </div>

      {/* Global Error Banner */}
      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2.5 text-xs text-red-700">
          <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Loading State */}
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center text-center bg-crm-surface border border-crm-border rounded-xl shadow-sm">
          <Loader2 className="w-6 h-6 text-crm-accent animate-spin mb-2" />
          <p className="text-xs font-mono text-crm-textSecondary uppercase tracking-wider">
            Loading usage data...
          </p>
        </div>
      ) : (
        <>
          {/* Stat Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Total Spend Card */}
            <div className="p-5 rounded-xl bg-crm-surface border border-crm-border space-y-3 shadow-sm">
              <div className="flex items-center justify-between text-crm-textSecondary">
                <span className="text-[11px] font-mono uppercase tracking-wider">
                  Total Spend (MTD)
                </span>
                <div className="w-7 h-7 rounded-md bg-crm-accentSubtle border border-crm-accentBorder flex items-center justify-center text-crm-accent">
                  <DollarSign className="w-4 h-4" />
                </div>
              </div>

              <div>
                <div className="text-2xl font-heading font-bold text-crm-text tracking-tight">
                  {formatCurrency(numericSpend, currency)}
                </div>
                <div className="text-[11px] font-mono text-crm-textSecondary mt-0.5">
                  {periodStart ? formatPeriodStart(periodStart) : "Current billing cycle"}
                </div>
              </div>

              <div className="pt-2 border-t border-crm-border flex items-center justify-between text-[11px]">
                <span className="text-crm-textSecondary">Currency</span>
                <span className="font-mono text-crm-text font-medium uppercase">
                  {currency}
                </span>
              </div>
            </div>

            {/* Total Messages Sent Card */}
            <div className="p-5 rounded-xl bg-crm-surface border border-crm-border space-y-3 shadow-sm">
              <div className="flex items-center justify-between text-crm-textSecondary">
                <span className="text-[11px] font-mono uppercase tracking-wider">
                  Messages Billed
                </span>
                <div className="w-7 h-7 rounded-md bg-crm-accentSubtle border border-crm-accentBorder flex items-center justify-center text-crm-accent">
                  <Send className="w-4 h-4" />
                </div>
              </div>

              <div>
                <div className="text-2xl font-heading font-bold text-crm-text tracking-tight font-mono">
                  {messageCount.toLocaleString()}
                </div>
                <div className="text-[11px] font-mono text-crm-textSecondary mt-0.5">
                  Outbound WhatsApp messages
                </div>
              </div>

              <div className="pt-2 border-t border-crm-border flex items-center justify-between text-[11px]">
                <span className="text-crm-textSecondary">Status</span>
                <span className="font-mono text-crm-success font-medium">
                  {messageCount > 0 ? "Active" : "No Activity"}
                </span>
              </div>
            </div>

            {/* Average Cost per Message Card */}
            <div className="p-5 rounded-xl bg-crm-surface border border-crm-border space-y-3 shadow-sm">
              <div className="flex items-center justify-between text-crm-textSecondary">
                <span className="text-[11px] font-mono uppercase tracking-wider">
                  Avg. Cost / Message
                </span>
                <div className="w-7 h-7 rounded-md bg-crm-accentSubtle border border-crm-accentBorder flex items-center justify-center text-crm-accent">
                  <TrendingUp className="w-4 h-4" />
                </div>
              </div>

              <div>
                <div className="text-2xl font-heading font-bold text-crm-text tracking-tight">
                  {messageCount > 0 ? formatCurrency(avgCostPerMessage, currency) : "—"}
                </div>
                <div className="text-[11px] font-mono text-crm-textSecondary mt-0.5">
                  Blended conversation rate
                </div>
              </div>

              <div className="pt-2 border-t border-crm-border flex items-center justify-between text-[11px]">
                <span className="text-crm-textSecondary">Rate Model</span>
                <span className="font-mono text-crm-text font-medium">Meta Cloud API</span>
              </div>
            </div>
          </div>

          {/* Pricing Info & Guidance Card */}
          <div className="p-5 rounded-xl bg-crm-surface border border-crm-border shadow-sm space-y-3">
            <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-crm-textSecondary font-medium">
              <Info className="w-4 h-4 text-crm-accent" />
              <span>WhatsApp Cloud API Billing Overview</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
              <div className="p-3 bg-crm-elevated/40 rounded-lg border border-crm-border/70 space-y-1">
                <div className="text-xs font-semibold text-crm-text">Marketing</div>
                <p className="text-[11px] text-crm-textSecondary leading-relaxed">
                  Promotions, offers, and brand announcements initiated by your business.
                </p>
              </div>

              <div className="p-3 bg-crm-elevated/40 rounded-lg border border-crm-border/70 space-y-1">
                <div className="text-xs font-semibold text-crm-text">Utility</div>
                <p className="text-[11px] text-crm-textSecondary leading-relaxed">
                  Order updates, transaction confirmations, and post-purchase notifications.
                </p>
              </div>

              <div className="p-3 bg-crm-elevated/40 rounded-lg border border-crm-border/70 space-y-1">
                <div className="text-xs font-semibold text-crm-text">Authentication</div>
                <p className="text-[11px] text-crm-textSecondary leading-relaxed">
                  One-time passcodes (OTP) and account verification codes.
                </p>
              </div>
            </div>

            <div className="pt-2 flex items-center gap-2 text-[11px] text-crm-textMuted">
              <ShieldAlert className="w-3.5 h-3.5 text-crm-accent flex-shrink-0" />
              <span>
                Costs are billed monthly directly by Meta based on recipient country and conversation category.
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
