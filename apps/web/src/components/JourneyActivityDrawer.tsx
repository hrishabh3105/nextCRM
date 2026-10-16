import React, { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";
import { formatReasonCode } from "../lib/journeyReasonCodes";
import {
  X,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Send,
  AlertTriangle,
  LogOut,
  Ban,
  Activity,
  ArrowRight,
} from "lucide-react";

export interface JourneyRunSummary {
  id: string;
  journeyId: string;
  journeyVersionId: string;
  contactId: string;
  contactName: string | null;
  contactPhone: string | null;
  currentStepIndex: number;
  status: string;
  exitReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JourneyStepLog {
  id: string;
  stepIndex: number;
  stepId?: string | null;
  stepType: string;
  outcome: "SENT" | "SKIPPED" | "FAILED" | "EXITED" | string;
  reasonCode?: string | null;
  detail?: string | null;
  messageId?: string | null;
  messageStatus?: string | null;
  createdAt: string;
}

export interface JourneyStats {
  days: number;
  runsStarted: number;
  messagesSent: number;
  skippedByReason: Record<string, number>;
  failed: number;
  cartConverted: number;
}

interface JourneyActivityDrawerProps {
  journey: {
    id: string;
    name: string;
    triggerEvent: string;
  } | null;
  onClose: () => void;
}

function formatDateTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return dateStr;
  }
}

export const JourneyActivityDrawer: React.FC<JourneyActivityDrawerProps> = ({
  journey,
  onClose,
}) => {
  const [stats, setStats] = useState<JourneyStats | null>(null);
  const [statsLoading, setStatsLoading] = useState<boolean>(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  const [runs, setRuns] = useState<JourneyRunSummary[]>([]);
  const [runsLoading, setRunsLoading] = useState<boolean>(false);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);

  // Expanded run step logs
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [stepLogsMap, setStepLogsMap] = useState<Record<string, JourneyStepLog[]>>({});
  const [loadingLogsRunId, setLoadingLogsRunId] = useState<string | null>(null);
  const [logErrorMap, setLogErrorMap] = useState<Record<string, string>>({});

  const journeyId = journey?.id;

  // Fetch 7-day stats
  const fetchStats = useCallback(async () => {
    if (!journeyId) return;
    setStatsLoading(true);
    setStatsError(null);
    try {
      const data = await api.get<JourneyStats>(`/api/v1/journeys/${journeyId}/stats?days=7`);
      setStats(data);
    } catch (err: any) {
      setStatsError(err?.message || "Failed to load journey statistics.");
    } finally {
      setStatsLoading(false);
    }
  }, [journeyId]);

  // Fetch initial runs
  const fetchRuns = useCallback(async () => {
    if (!journeyId) return;
    setRunsLoading(true);
    setRunsError(null);
    try {
      const data = await api.get<{
        runs: JourneyRunSummary[];
        nextCursor: string | null;
      }>(`/api/v1/journeys/${journeyId}/runs?limit=25`);
      setRuns(data.runs || []);
      setNextCursor(data.nextCursor || null);
    } catch (err: any) {
      setRunsError(err?.message || "Failed to load journey run history.");
    } finally {
      setRunsLoading(false);
    }
  }, [journeyId]);

  useEffect(() => {
    if (journeyId) {
      fetchStats();
      fetchRuns();
    }
  }, [journeyId, fetchStats, fetchRuns]);

  // Load more runs
  const handleLoadMore = async () => {
    if (!journeyId || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await api.get<{
        runs: JourneyRunSummary[];
        nextCursor: string | null;
      }>(`/api/v1/journeys/${journeyId}/runs?limit=25&cursor=${nextCursor}`);
      setRuns((prev) => [...prev, ...(data.runs || [])]);
      setNextCursor(data.nextCursor || null);
    } catch (err: any) {
      setRunsError(err?.message || "Failed to load more runs.");
    } finally {
      setLoadingMore(false);
    }
  };

  // Toggle run row expansion & load step logs
  const handleToggleRun = async (runId: string) => {
    if (expandedRunId === runId) {
      setExpandedRunId(null);
      return;
    }

    setExpandedRunId(runId);

    // If step logs already loaded, don't refetch
    if (stepLogsMap[runId]) return;

    if (!journeyId) return;
    setLoadingLogsRunId(runId);
    setLogErrorMap((prev) => ({ ...prev, [runId]: "" }));

    try {
      const data = await api.get<{
        run: any;
        stepLogs: JourneyStepLog[];
      }>(`/api/v1/journeys/${journeyId}/runs/${runId}`);
      setStepLogsMap((prev) => ({
        ...prev,
        [runId]: data.stepLogs || [],
      }));
    } catch (err: any) {
      setLogErrorMap((prev) => ({
        ...prev,
        [runId]: err?.message || "Failed to load step logs for this run.",
      }));
    } finally {
      setLoadingLogsRunId(null);
    }
  };

  if (!journey) return null;

  const totalSkipped = stats?.skippedByReason
    ? Object.values(stats.skippedByReason).reduce((sum, count) => sum + count, 0)
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/40 backdrop-blur-sm transition-opacity">
      <div className="w-full max-w-3xl h-full bg-crm-surface border-l border-crm-border shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-crm-border flex items-center justify-between gap-3 bg-white">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-crm-accentSubtle border border-crm-accentBorder flex items-center justify-center text-crm-accent shrink-0">
              <Activity className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-heading font-bold text-crm-text truncate">
                {journey.name}
              </h2>
              <p className="text-xs text-crm-textSecondary truncate">
                Run History &amp; Step Execution Logs
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                fetchStats();
                fetchRuns();
              }}
              title="Refresh"
              className="p-1.5 rounded-md border border-crm-border text-crm-textSecondary hover:text-crm-text hover:bg-crm-elevated transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md text-crm-textSecondary hover:text-crm-text hover:bg-crm-elevated transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5 bg-crm-bg">
          {/* Section: 7-Day Summary Chips */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-crm-textSecondary">
                Last 7 Days Activity
              </span>
              {statsLoading && <Loader2 className="w-3.5 h-3.5 text-crm-accent animate-spin" />}
            </div>

            {statsError ? (
              <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-md flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{statsError}</span>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {/* Runs Started */}
                <div className="p-2.5 bg-white border border-crm-border rounded-lg shadow-sm">
                  <div className="text-[10px] font-medium text-crm-textSecondary uppercase">
                    Runs Started
                  </div>
                  <div className="text-lg font-mono font-bold text-crm-text mt-0.5">
                    {stats?.runsStarted ?? 0}
                  </div>
                </div>

                {/* Messages Sent */}
                <div className="p-2.5 bg-emerald-50/50 border border-emerald-200 rounded-lg shadow-sm">
                  <div className="text-[10px] font-medium text-emerald-800 uppercase flex items-center gap-1">
                    <Send className="w-2.5 h-2.5 text-emerald-600" />
                    <span>Sent</span>
                  </div>
                  <div className="text-lg font-mono font-bold text-emerald-700 mt-0.5">
                    {stats?.messagesSent ?? 0}
                  </div>
                </div>

                {/* Skipped */}
                <div className="p-2.5 bg-amber-50/50 border border-amber-200 rounded-lg shadow-sm">
                  <div className="text-[10px] font-medium text-amber-800 uppercase flex items-center gap-1">
                    <Ban className="w-2.5 h-2.5 text-amber-600" />
                    <span>Skipped</span>
                  </div>
                  <div className="text-lg font-mono font-bold text-amber-700 mt-0.5">
                    {totalSkipped}
                  </div>
                </div>

                {/* Exited as Cart Converted */}
                <div className="p-2.5 bg-purple-50/50 border border-purple-200 rounded-lg shadow-sm">
                  <div className="text-[10px] font-medium text-purple-800 uppercase flex items-center gap-1">
                    <CheckCircle2 className="w-2.5 h-2.5 text-purple-600" />
                    <span>Converted</span>
                  </div>
                  <div className="text-lg font-mono font-bold text-purple-700 mt-0.5">
                    {stats?.cartConverted ?? 0}
                  </div>
                </div>

                {/* Failed */}
                <div className="p-2.5 bg-red-50/50 border border-red-200 rounded-lg shadow-sm">
                  <div className="text-[10px] font-medium text-red-800 uppercase flex items-center gap-1">
                    <AlertTriangle className="w-2.5 h-2.5 text-red-600" />
                    <span>Failed</span>
                  </div>
                  <div className="text-lg font-mono font-bold text-red-700 mt-0.5">
                    {stats?.failed ?? 0}
                  </div>
                </div>
              </div>
            )}

            {/* Skipped Breakdown Pills if any */}
            {stats?.skippedByReason && Object.keys(stats.skippedByReason).length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[10px] text-crm-textSecondary uppercase font-medium">
                  Skip reasons:
                </span>
                {Object.entries(stats.skippedByReason).map(([reason, count]) => (
                  <span
                    key={reason}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono bg-white border border-amber-300 text-amber-800"
                  >
                    <span>{formatReasonCode(reason)}</span>
                    <span className="font-bold text-amber-950">({count})</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Section: Runs Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-crm-textSecondary">
                Execution Runs
              </span>
              <span className="text-xs font-mono text-crm-textSecondary">
                {runs.length} loaded
              </span>
            </div>

            {runsLoading ? (
              <div className="py-12 bg-white border border-crm-border rounded-xl flex flex-col items-center justify-center text-center">
                <Loader2 className="w-6 h-6 text-crm-accent animate-spin mb-2" />
                <p className="text-xs font-mono text-crm-textSecondary uppercase">
                  Loading runs...
                </p>
              </div>
            ) : runsError ? (
              <div className="p-4 bg-white border border-red-200 rounded-xl text-center space-y-2">
                <p className="text-xs text-red-700">{runsError}</p>
                <button
                  type="button"
                  onClick={fetchRuns}
                  className="px-3 py-1 text-xs font-medium text-crm-text border border-crm-border rounded-md hover:bg-crm-elevated"
                >
                  Retry
                </button>
              </div>
            ) : runs.length === 0 ? (
              <div className="py-12 px-4 bg-white border border-crm-border rounded-xl text-center">
                <Activity className="w-8 h-8 text-crm-textMuted mx-auto mb-2" />
                <h4 className="text-xs font-semibold text-crm-text">
                  No runs recorded yet
                </h4>
                <p className="text-[11px] text-crm-textSecondary mt-0.5">
                  When matching store events occur, automated runs will appear here.
                </p>
              </div>
            ) : (
              <div className="bg-white border border-crm-border rounded-xl overflow-hidden shadow-sm divide-y divide-crm-border">
                {runs.map((run) => {
                  const isExpanded = expandedRunId === run.id;
                  const logs = stepLogsMap[run.id] || [];
                  const isLoadingLogs = loadingLogsRunId === run.id;
                  const logError = logErrorMap[run.id];

                  // Status badge styling
                  let statusBadgeClass = "bg-gray-100 text-gray-700 border-gray-200";
                  if (run.status === "completed") {
                    statusBadgeClass = "bg-emerald-50 text-emerald-700 border-emerald-200";
                  } else if (run.status === "running") {
                    statusBadgeClass = "bg-blue-50 text-blue-700 border-blue-200";
                  } else if (run.status === "waiting") {
                    statusBadgeClass = "bg-amber-50 text-amber-700 border-amber-200";
                  } else if (run.status === "failed") {
                    statusBadgeClass = "bg-red-50 text-red-700 border-red-200";
                  } else if (run.status === "exited") {
                    statusBadgeClass = "bg-purple-50 text-purple-700 border-purple-200";
                  }

                  return (
                    <div key={run.id} className="transition-colors">
                      {/* Run Summary Row */}
                      <div
                        onClick={() => handleToggleRun(run.id)}
                        className={`p-3 sm:p-3.5 flex items-center justify-between gap-3 cursor-pointer select-none transition-colors ${
                          isExpanded ? "bg-crm-subtle/50" : "hover:bg-crm-subtle/30"
                        }`}
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-semibold text-crm-text truncate">
                              {run.contactName || run.contactPhone || "Anonymous Contact"}
                            </span>
                            {run.contactPhone && run.contactName && (
                              <span className="text-[11px] font-mono text-crm-textMuted">
                                ({run.contactPhone})
                              </span>
                            )}
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${statusBadgeClass}`}
                            >
                              {run.status.toUpperCase()}
                            </span>
                          </div>

                          <div className="flex items-center gap-3 text-[11px] text-crm-textSecondary flex-wrap">
                            <span className="flex items-center gap-1 font-mono">
                              <Clock className="w-3 h-3 text-crm-textMuted" />
                              {formatDateTime(run.createdAt)}
                            </span>
                            {run.exitReason && (
                              <span className="inline-flex items-center gap-1 text-purple-700 font-medium">
                                <LogOut className="w-3 h-3 text-purple-600" />
                                {formatReasonCode(run.exitReason)}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[11px] font-mono text-crm-textMuted hidden sm:inline">
                            {isExpanded ? "Hide steps" : "View steps"}
                          </span>
                          {isExpanded ? (
                            <ChevronUp className="w-4 h-4 text-crm-textSecondary" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-crm-textSecondary" />
                          )}
                        </div>
                      </div>

                      {/* Expanded Step Log Timeline */}
                      {isExpanded && (
                        <div className="px-4 pb-4 pt-2 bg-crm-subtle/30 border-t border-crm-border/60">
                          {isLoadingLogs ? (
                            <div className="py-6 flex items-center justify-center gap-2 text-xs font-mono text-crm-textSecondary">
                              <Loader2 className="w-4 h-4 text-crm-accent animate-spin" />
                              <span>Loading step logs...</span>
                            </div>
                          ) : logError ? (
                            <div className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700 flex items-center gap-2">
                              <AlertCircle className="w-4 h-4 shrink-0" />
                              <span>{logError}</span>
                            </div>
                          ) : logs.length === 0 ? (
                            <div className="py-4 text-center text-xs text-crm-textMuted italic">
                              No step logs recorded for this run.
                            </div>
                          ) : (
                            <div className="space-y-2 pt-1">
                              <div className="text-[10px] font-semibold uppercase tracking-wider text-crm-textSecondary mb-1">
                                Step Execution Trail ({logs.length})
                              </div>
                              <div className="divide-y divide-crm-border/60 border border-crm-border/60 rounded-lg bg-white overflow-hidden">
                                {logs.map((log) => {
                                  // Outcome badge
                                  let outcomeClass = "bg-gray-100 text-gray-700 border-gray-200";
                                  if (log.outcome === "SENT") {
                                    outcomeClass = "bg-emerald-50 text-emerald-800 border-emerald-300 font-bold";
                                  } else if (log.outcome === "SKIPPED") {
                                    outcomeClass = "bg-amber-50 text-amber-800 border-amber-300 font-bold";
                                  } else if (log.outcome === "FAILED") {
                                    outcomeClass = "bg-red-50 text-red-800 border-red-300 font-bold";
                                  } else if (log.outcome === "EXITED") {
                                    outcomeClass = "bg-purple-50 text-purple-800 border-purple-300 font-bold";
                                  }

                                  return (
                                    <div
                                      key={log.id}
                                      className="p-2.5 text-xs flex flex-col sm:flex-row sm:items-start justify-between gap-2"
                                    >
                                      <div className="space-y-1 min-w-0 flex-1">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className="font-mono text-[11px] font-semibold text-crm-text">
                                            Step {log.stepIndex + 1} ({log.stepType})
                                          </span>
                                          <span
                                            className={`inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-mono border ${outcomeClass}`}
                                          >
                                            {log.outcome}
                                          </span>
                                          {log.reasonCode && (
                                            <span className="text-[11px] font-medium text-crm-text">
                                              {formatReasonCode(log.reasonCode)}
                                            </span>
                                          )}
                                        </div>

                                        {log.detail && (
                                          <p className="text-[11px] font-mono text-crm-textSecondary bg-crm-bg p-1.5 rounded border border-crm-border/40 break-words">
                                            {log.detail}
                                          </p>
                                        )}
                                      </div>

                                      <div className="flex sm:flex-col sm:items-end gap-1 text-[10px] font-mono text-crm-textMuted shrink-0">
                                        <span>{formatDateTime(log.createdAt)}</span>
                                        {log.messageStatus && (
                                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-crm-subtle text-crm-text border border-crm-border">
                                            Delivery: {log.messageStatus}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Load More Control */}
            {nextCursor && (
              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="px-4 py-1.5 text-xs font-semibold text-crm-text bg-white border border-crm-border rounded-lg shadow-sm hover:bg-crm-elevated transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {loadingMore ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Loading more...</span>
                    </>
                  ) : (
                    <>
                      <span>Load more runs</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
