import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api, ApiError } from "../lib/api";
import {
  Users,
  Radio,
  Megaphone,
  GitBranch,
  IndianRupee,
  DollarSign,
  RefreshCw,
  AlertCircle,
  Loader2,
  CheckCircle2,
  Clock,
  XCircle,
  FileText,
  ArrowRight,
  Plus,
  X,
} from "lucide-react";

export interface Contact {
  id: string;
  phone: string;
  name: string | null;
  optedInAt: string | null;
  createdAt: string;
}

export interface Channel {
  id: string;
  type: string;
  provider: string;
  phoneNumber?: string | null;
  status: string;
}

export interface Campaign {
  id: string;
  name: string;
  status: string;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  createdAt: string;
}

export interface Journey {
  id: string;
  name: string;
  status: string;
  triggerEvent: string;
  createdAt: string;
}

export interface UsageCosts {
  totalSpend: string | number;
  messageCount: number;
  currency: string;
  periodStart?: string;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function formatCurrency(amount: number, currency = "INR"): string {
  const hasSubCentFraction = (amount * 100) % 1 !== 0;
  const symbol = currency === "INR" ? "₹" : "$";
  const formattedNumber = new Intl.NumberFormat(
    currency === "INR" ? "en-IN" : "en-US",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: hasSubCentFraction ? 4 : 2,
    }
  ).format(amount);
  return `${symbol}${formattedNumber}`;
}

export const DashboardPage: React.FC = () => {
  const { workspace, user } = useAuth();

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [usage, setUsage] = useState<UsageCosts | null>(null);

  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboardData = useCallback(async (isManual = false) => {
    if (isManual) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const [contactsRes, channelsRes, campaignsRes, journeysRes, usageRes] =
        await Promise.all([
          api.get<Contact[]>("/api/v1/contacts"),
          api.get<Channel[]>("/api/v1/channels"),
          api.get<Campaign[]>("/api/v1/campaigns"),
          api.get<Journey[]>("/api/v1/journeys"),
          api.get<UsageCosts>("/api/v1/usage/costs"),
        ]);

      setContacts(contactsRes || []);
      setChannels(channelsRes || []);
      setCampaigns(campaignsRes || []);
      setJourneys(journeysRes || []);
      setUsage(usageRes || null);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to load dashboard metrics.");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  // Derived Metrics
  const totalContacts = contacts.length;
  const optedInCount = contacts.filter((c) => Boolean(c.optedInAt)).length;

  const activeChannels = channels.filter(
    (c) =>
      c.status.toLowerCase() === "connected" ||
      c.status.toLowerCase() === "active"
  );

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const campaignsThisMonth = campaigns.filter((c) => {
    try {
      const d = new Date(c.createdAt);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    } catch {
      return false;
    }
  });

  const totalSentThisMonth = campaignsThisMonth.reduce(
    (sum, c) => sum + (Number(c.sentCount) || 0),
    0
  );
  const totalFailedThisMonth = campaignsThisMonth.reduce(
    (sum, c) => sum + (Number(c.failedCount) || 0),
    0
  );

  const activeJourneys = journeys.filter(
    (j) => j.status.toLowerCase() === "active"
  );

  const numericSpend = usage
    ? typeof usage.totalSpend === "number"
      ? usage.totalSpend
      : parseFloat(String(usage.totalSpend || "0")) || 0
    : 0;
  const currency = usage?.currency || "INR";

  const recentCampaigns = useMemo(() => {
    return [...campaigns]
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
      .slice(0, 5);
  }, [campaigns]);

  const renderStatusBadge = (status: string) => {
    const s = status.toLowerCase();

    if (s === "completed") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-crm-successBg text-crm-success border border-crm-successBorder">
          <CheckCircle2 className="w-3 h-3 text-crm-success" />
          <span>Completed</span>
        </span>
      );
    }

    if (s === "sending") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-amber-50 text-amber-700 border border-amber-200">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
          </span>
          <span>Sending</span>
        </span>
      );
    }

    if (s === "queued") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-blue-50 text-blue-700 border border-blue-200">
          <Clock className="w-3 h-3 text-blue-600 animate-spin" />
          <span>Queued</span>
        </span>
      );
    }

    if (s === "cancelled") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-red-50 text-red-700 border border-red-200">
          <XCircle className="w-3 h-3 text-red-600" />
          <span>Cancelled</span>
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-crm-elevated text-crm-textSecondary border border-crm-border">
        <FileText className="w-3 h-3 text-crm-textMuted" />
        <span>Draft</span>
      </span>
    );
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
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
            <span className="text-crm-text font-mono font-medium">
              {user?.email || "Current User"}
            </span>
            .
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchDashboardData(true)}
            disabled={loading || refreshing}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-crm-surface hover:bg-crm-elevated border border-crm-border text-xs font-medium text-crm-text transition-colors disabled:opacity-50 shadow-sm"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 text-crm-accent ${
                refreshing ? "animate-spin" : ""
              }`}
            />
            <span>{refreshing ? "Refreshing..." : "Refresh"}</span>
          </button>
        </div>
      </div>

      {/* Global Error Banner */}
      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 flex items-start justify-between gap-2.5 text-xs text-red-700">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => setError(null)}
            className="text-red-500 hover:text-red-700 p-0.5"
            aria-label="Dismiss error"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Loading State */}
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center text-center bg-crm-surface border border-crm-border rounded-xl shadow-sm">
          <Loader2 className="w-6 h-6 text-crm-accent animate-spin mb-2" />
          <p className="text-xs font-mono text-crm-textSecondary uppercase tracking-wider">
            Loading dashboard metrics...
          </p>
        </div>
      ) : (
        <>
          {/* 5-Card Metrics Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {/* Total Contacts Card */}
            <div className="p-5 rounded-xl bg-crm-surface border border-crm-border space-y-3 shadow-sm flex flex-col justify-between">
              <div className="flex items-center justify-between text-crm-textSecondary">
                <span className="text-[11px] font-mono uppercase tracking-wider">
                  Total Contacts
                </span>
                <div className="w-7 h-7 rounded-md bg-crm-accentSubtle border border-crm-accentBorder flex items-center justify-center text-crm-accent">
                  <Users className="w-4 h-4" />
                </div>
              </div>

              <div>
                <div className="text-2xl font-heading font-bold text-crm-text tracking-tight font-mono">
                  {totalContacts.toLocaleString()}
                </div>
                <div className="text-[11px] font-mono text-crm-textSecondary mt-0.5">
                  Audience database
                </div>
              </div>

              <div className="pt-2 border-t border-crm-border flex items-center justify-between text-[11px]">
                <span className="text-crm-textSecondary">Opted-in</span>
                <span className="font-mono text-crm-success font-medium">
                  {optedInCount.toLocaleString()} ({totalContacts > 0 ? Math.round((optedInCount / totalContacts) * 100) : 0}%)
                </span>
              </div>
            </div>

            {/* Active Channels Card */}
            <div className="p-5 rounded-xl bg-crm-surface border border-crm-border space-y-3 shadow-sm flex flex-col justify-between">
              <div className="flex items-center justify-between text-crm-textSecondary">
                <span className="text-[11px] font-mono uppercase tracking-wider">
                  Active Channels
                </span>
                <div className="w-7 h-7 rounded-md bg-crm-accentSubtle border border-crm-accentBorder flex items-center justify-center text-crm-accent">
                  <Radio className="w-4 h-4" />
                </div>
              </div>

              <div>
                <div className="text-2xl font-heading font-bold text-crm-text tracking-tight font-mono">
                  {activeChannels.length}
                </div>
                <div className="text-[11px] font-mono text-crm-textSecondary mt-0.5">
                  WhatsApp Cloud API
                </div>
              </div>

              <div className="pt-2 border-t border-crm-border flex items-center justify-between text-[11px]">
                <span className="text-crm-textSecondary">Total</span>
                <span className="font-mono text-crm-text font-medium">
                  {channels.length} {channels.length === 1 ? "channel" : "channels"}
                </span>
              </div>
            </div>

            {/* Campaigns This Month Card */}
            <div className="p-5 rounded-xl bg-crm-surface border border-crm-border space-y-3 shadow-sm flex flex-col justify-between">
              <div className="flex items-center justify-between text-crm-textSecondary">
                <span className="text-[11px] font-mono uppercase tracking-wider">
                  Campaigns (MTD)
                </span>
                <div className="w-7 h-7 rounded-md bg-crm-accentSubtle border border-crm-accentBorder flex items-center justify-center text-crm-accent">
                  <Megaphone className="w-4 h-4" />
                </div>
              </div>

              <div>
                <div className="text-2xl font-heading font-bold text-crm-text tracking-tight font-mono">
                  {campaignsThisMonth.length}
                </div>
                <div className="text-[11px] font-mono text-crm-textSecondary mt-0.5">
                  {totalSentThisMonth.toLocaleString()} sent • {totalFailedThisMonth.toLocaleString()} failed
                </div>
              </div>

              <div className="pt-2 border-t border-crm-border flex items-center justify-between text-[11px]">
                <span className="text-crm-textSecondary">Delivery Rate</span>
                <span className="font-mono text-crm-success font-medium">
                  {totalSentThisMonth + totalFailedThisMonth > 0
                    ? `${Math.round(
                        (totalSentThisMonth /
                          (totalSentThisMonth + totalFailedThisMonth)) *
                          100
                      )}%`
                    : "—"}
                </span>
              </div>
            </div>

            {/* Spend This Month Card */}
            <div className="p-5 rounded-xl bg-crm-surface border border-crm-border space-y-3 shadow-sm flex flex-col justify-between">
              <div className="flex items-center justify-between text-crm-textSecondary">
                <span className="text-[11px] font-mono uppercase tracking-wider">
                  Spend (MTD)
                </span>
                <div className="w-7 h-7 rounded-md bg-crm-accentSubtle border border-crm-accentBorder flex items-center justify-center text-crm-accent">
                  {currency === "INR" ? (
                    <IndianRupee className="w-4 h-4" />
                  ) : (
                    <DollarSign className="w-4 h-4" />
                  )}
                </div>
              </div>

              <div>
                <div className="text-2xl font-heading font-bold text-crm-text tracking-tight">
                  {formatCurrency(numericSpend, currency)}
                </div>
                <div className="text-[11px] font-mono text-crm-textSecondary mt-0.5">
                  {usage?.messageCount?.toLocaleString() ?? 0} messages billed
                </div>
              </div>

              <div className="pt-2 border-t border-crm-border flex items-center justify-between text-[11px]">
                <span className="text-crm-textSecondary">Currency</span>
                <span className="font-mono text-crm-text font-medium uppercase">
                  {currency}
                </span>
              </div>
            </div>

            {/* Active Journeys Card */}
            <div className="p-5 rounded-xl bg-crm-surface border border-crm-border space-y-3 shadow-sm flex flex-col justify-between">
              <div className="flex items-center justify-between text-crm-textSecondary">
                <span className="text-[11px] font-mono uppercase tracking-wider">
                  Active Journeys
                </span>
                <div className="w-7 h-7 rounded-md bg-crm-accentSubtle border border-crm-accentBorder flex items-center justify-center text-crm-accent">
                  <GitBranch className="w-4 h-4" />
                </div>
              </div>

              <div>
                <div className="text-2xl font-heading font-bold text-crm-text tracking-tight font-mono">
                  {activeJourneys.length}
                </div>
                <div className="text-[11px] font-mono text-crm-textSecondary mt-0.5">
                  Automated sequences
                </div>
              </div>

              <div className="pt-2 border-t border-crm-border flex items-center justify-between text-[11px]">
                <span className="text-crm-textSecondary">Total</span>
                <span className="font-mono text-crm-text font-medium">
                  {journeys.length} {journeys.length === 1 ? "journey" : "journeys"}
                </span>
              </div>
            </div>
          </div>

          {/* Recent Campaigns Section */}
          <div className="bg-crm-surface border border-crm-border rounded-xl shadow-sm overflow-hidden">
            <div className="p-4 px-5 border-b border-crm-border flex items-center justify-between">
              <div>
                <h2 className="text-sm font-heading font-semibold text-crm-text tracking-tight flex items-center gap-2">
                  <Megaphone className="w-4 h-4 text-crm-accent" />
                  <span>Recent Campaigns</span>
                </h2>
                <p className="text-xs text-crm-textSecondary mt-0.5">
                  Latest broadcast message campaigns and delivery status.
                </p>
              </div>
              <Link
                to="/campaigns"
                className="text-xs font-medium text-crm-accent hover:text-crm-accentHover flex items-center gap-1 transition-colors"
              >
                <span>View all campaigns</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            {recentCampaigns.length === 0 ? (
              <div className="py-12 px-4 flex flex-col items-center justify-center text-center">
                <div className="w-10 h-10 rounded-xl bg-crm-elevated border border-crm-border flex items-center justify-center mb-2.5">
                  <Megaphone className="w-5 h-5 text-crm-textSecondary" />
                </div>
                <h3 className="text-xs font-heading font-semibold text-crm-text">
                  No campaigns created yet
                </h3>
                <p className="text-[11px] text-crm-textSecondary mt-0.5 max-w-xs">
                  Create and dispatch broadcast campaigns to opted-in contacts from the Campaigns page.
                </p>
                <Link
                  to="/campaigns"
                  className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-crm-accent hover:bg-crm-accentHover text-xs font-medium text-white transition-colors shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Create campaign</span>
                </Link>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-crm-border bg-crm-elevated/40 text-[11px] font-mono uppercase text-crm-textSecondary">
                      <th className="py-2.5 px-5 font-medium">Campaign Name</th>
                      <th className="py-2.5 px-5 font-medium">Status</th>
                      <th className="py-2.5 px-5 font-medium text-right">Sent / Total</th>
                      <th className="py-2.5 px-5 font-medium text-right">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-crm-border text-xs text-crm-text">
                    {recentCampaigns.map((c) => (
                      <tr
                        key={c.id}
                        className="hover:bg-crm-elevated/30 transition-colors"
                      >
                        <td className="py-3 px-5 font-medium text-crm-text">
                          <Link
                            to="/campaigns"
                            className="hover:text-crm-accent transition-colors font-mono"
                          >
                            {c.name}
                          </Link>
                        </td>
                        <td className="py-3 px-5">
                          {renderStatusBadge(c.status)}
                        </td>
                        <td className="py-3 px-5 font-mono text-right text-crm-textSecondary">
                          <span className="font-medium text-crm-text">
                            {(c.sentCount ?? 0).toLocaleString()}
                          </span>
                          <span className="text-crm-textMuted"> / </span>
                          <span>{(c.totalRecipients ?? 0).toLocaleString()}</span>
                        </td>
                        <td className="py-3 px-5 text-right font-mono text-[11px] text-crm-textSecondary">
                          {formatDate(c.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
