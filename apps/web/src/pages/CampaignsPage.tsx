import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { api, ApiError } from "../lib/api";
import {
  Megaphone,
  Plus,
  Search,
  AlertCircle,
  CheckCircle2,
  Clock,
  X,
  Loader2,
  Play,
  Radio,
  FileText,
} from "lucide-react";

export interface Campaign {
  id: string;
  workspaceId: string;
  templateId: string;
  channelId: string;
  name: string;
  status: "draft" | "queued" | "sending" | "completed" | string;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Template {
  id: string;
  providerName: string;
  status: string;
  category: string;
  language: string;
  channelId: string;
}

export interface Channel {
  id: string;
  type: string;
  provider: string;
  phoneNumber?: string | null;
  phoneNumberId?: string | null;
  status: string;
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

export const CampaignsPage: React.FC = () => {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Search and Filter
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>("all");

  // Per-campaign action state
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});

  // Create Campaign Modal state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [campaignName, setCampaignName] = useState<string>("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [selectedChannelId, setSelectedChannelId] = useState<string>("");
  const [createLoading, setCreateLoading] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | null>(null);

  /**
   * Polling cleanup management:
   * Holds a Map of active setInterval IDs keyed by campaignId.
   * On unmount, all active intervals are cleared and removed.
   * On campaign completion, the corresponding interval is cleared and removed.
   */
  const pollingIntervalsRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  // Stop polling a specific campaign and remove its timer from ref
  const stopPolling = useCallback((campaignId: string) => {
    const existingInterval = pollingIntervalsRef.current.get(campaignId);
    if (existingInterval) {
      clearInterval(existingInterval);
      pollingIntervalsRef.current.delete(campaignId);
    }
  }, []);

  // Poll a single campaign for updated status and recipient counts
  const pollCampaign = useCallback(
    async (campaignId: string) => {
      try {
        const updated = await api.get<Campaign>(`/api/v1/campaigns/${campaignId}`);
        setCampaigns((prev) =>
          prev.map((c) => (c.id === updated.id ? updated : c))
        );

        // Stop polling when campaign reaches terminal status "completed"
        if (updated.status.toLowerCase() === "completed") {
          stopPolling(campaignId);
        }
      } catch {
        // Stop polling on error (e.g., 404 or network loss) to prevent runaway leaks
        stopPolling(campaignId);
      }
    },
    [stopPolling]
  );

  // Start polling a specific campaign every 2 seconds
  const startPolling = useCallback(
    (campaignId: string) => {
      // Do not duplicate if already being polled
      if (pollingIntervalsRef.current.has(campaignId)) {
        return;
      }

      const intervalId = setInterval(() => {
        pollCampaign(campaignId);
      }, 2000);

      pollingIntervalsRef.current.set(campaignId, intervalId);
    },
    [pollCampaign]
  );

  // Clean up ALL active polling intervals when component unmounts
  useEffect(() => {
    const activeMap = pollingIntervalsRef.current;
    return () => {
      activeMap.forEach((intervalId) => {
        clearInterval(intervalId);
      });
      activeMap.clear();
    };
  }, []);

  // Fetch campaigns list
  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<Campaign[]>("/api/v1/campaigns");
      setCampaigns(data);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to load campaigns.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch templates & channels for dropdowns and display
  const fetchPrerequisites = useCallback(async () => {
    try {
      const [tmplData, chanData] = await Promise.all([
        api.get<Template[]>("/api/v1/templates"),
        api.get<Channel[]>("/api/v1/channels"),
      ]);
      setTemplates(tmplData);
      setChannels(chanData);
    } catch {
      // Non-blocking background fetch
    }
  }, []);

  useEffect(() => {
    fetchCampaigns();
    fetchPrerequisites();
  }, [fetchCampaigns, fetchPrerequisites]);

  // Ensure any in-flight campaign (queued or sending) loaded from API is polled until completion
  useEffect(() => {
    campaigns.forEach((c) => {
      const s = c.status.toLowerCase();
      if ((s === "queued" || s === "sending") && !pollingIntervalsRef.current.has(c.id)) {
        startPolling(c.id);
      }
    });
  }, [campaigns, startPolling]);

  // Approved templates only (client-side filter to prevent dispatch rejections)
  const approvedTemplates = useMemo(() => {
    return templates.filter((t) => t.status.toLowerCase() === "approved");
  }, [templates]);

  // Connected channels only
  const connectedChannels = useMemo(() => {
    return channels.filter((c) => c.status.toLowerCase() === "connected");
  }, [channels]);

  // Template lookup map
  const templateMap = useMemo(() => {
    const map = new Map<string, Template>();
    for (const t of templates) {
      map.set(t.id, t);
    }
    return map;
  }, [templates]);

  // Channel lookup map
  const channelMap = useMemo(() => {
    const map = new Map<string, Channel>();
    for (const c of channels) {
      map.set(c.id, c);
    }
    return map;
  }, [channels]);

  // Open Create Campaign modal
  const handleOpenCreateModal = () => {
    setCreateError(null);
    setCampaignName("");
    setSelectedTemplateId(approvedTemplates[0]?.id || "");
    setSelectedChannelId(connectedChannels[0]?.id || "");
    setIsCreateModalOpen(true);
  };

  // Submit new Campaign
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedName = campaignName.trim();
    if (!trimmedName) {
      setCreateError("Campaign name is required.");
      return;
    }

    if (!selectedTemplateId) {
      setCreateError("Please select an approved template.");
      return;
    }

    if (!selectedChannelId) {
      setCreateError("Please select a connected WhatsApp channel.");
      return;
    }

    setCreateLoading(true);
    setCreateError(null);

    try {
      await api.post<Campaign>("/api/v1/campaigns", {
        name: trimmedName,
        templateId: selectedTemplateId,
        channelId: selectedChannelId,
      });

      setIsCreateModalOpen(false);
      setSuccessMessage(`Campaign "${trimmedName}" created successfully as draft.`);
      await fetchCampaigns();
    } catch (err) {
      if (err instanceof ApiError) {
        setCreateError(err.message);
      } else if (err instanceof Error) {
        setCreateError(err.message);
      } else {
        setCreateError("Failed to create campaign.");
      }
    } finally {
      setCreateLoading(false);
    }
  };

  // Dispatch campaign
  const handleDispatch = async (campaign: Campaign) => {
    setActionLoading((prev) => ({ ...prev, [campaign.id]: true }));
    setActionErrors((prev) => {
      const next = { ...prev };
      delete next[campaign.id];
      return next;
    });

    try {
      const updated = await api.post<Campaign>(`/api/v1/campaigns/${campaign.id}/dispatch`);

      // Update row in state immediately to reflect "queued" status
      setCampaigns((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setSuccessMessage(`Campaign "${campaign.name}" dispatched! Polling for progress...`);

      // Start polling every 2 seconds for this campaign
      startPolling(campaign.id);
    } catch (err) {
      const errorMsg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
          ? err.message
          : "Failed to dispatch campaign.";
      setActionErrors((prev) => ({ ...prev, [campaign.id]: errorMsg }));
    } finally {
      setActionLoading((prev) => ({ ...prev, [campaign.id]: false }));
    }
  };

  // Filtered campaigns
  const filteredCampaigns = useMemo(() => {
    return campaigns.filter((c) => {
      const matchesSearch =
        !searchQuery.trim() ||
        c.name.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesStatus =
        selectedStatusFilter === "all" ||
        c.status.toLowerCase() === selectedStatusFilter.toLowerCase();

      return matchesSearch && matchesStatus;
    });
  }, [campaigns, searchQuery, selectedStatusFilter]);

  // Render Status Badge
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

    // Default: draft
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-crm-elevated text-crm-textSecondary border border-crm-border">
        <FileText className="w-3 h-3 text-crm-textMuted" />
        <span>Draft</span>
      </span>
    );
  };

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-heading font-semibold text-crm-text tracking-tight">
              Campaigns
            </h1>
            <span className="px-2 py-0.5 rounded text-[11px] font-mono text-crm-textSecondary bg-crm-elevated border border-crm-border font-medium">
              {campaigns.length} {campaigns.length === 1 ? "campaign" : "campaigns"}
            </span>
          </div>
          <p className="text-xs text-crm-textSecondary mt-0.5">
            Schedule and dispatch broadcast message campaigns to opted-in contacts.
          </p>
        </div>

        <button
          onClick={handleOpenCreateModal}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-crm-accent hover:bg-crm-accentHover text-xs font-medium text-white shadow-sm transition-colors self-start sm:self-auto"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Create campaign</span>
        </button>
      </div>

      {/* Global Page Error Banner */}
      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2.5 text-xs text-red-700">
          <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Success Notification Banner */}
      {successMessage && (
        <div className="p-3 rounded-lg bg-crm-successBg border border-crm-successBorder flex items-center justify-between gap-2.5 text-xs text-crm-success font-medium shadow-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span>{successMessage}</span>
          </div>
          <button
            onClick={() => setSuccessMessage(null)}
            className="text-crm-success hover:opacity-80 p-0.5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Campaigns Card Container */}
      <div className="bg-crm-surface border border-crm-border rounded-xl shadow-sm overflow-hidden">
        {/* Search and Filters Bar */}
        <div className="p-4 border-b border-crm-border flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white">
          <div className="relative flex-1 max-w-md">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-crm-textMuted" />
            <input
              type="text"
              placeholder="Search campaigns by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-crm-bg border border-crm-border rounded-md text-xs text-crm-text placeholder-crm-textMuted focus:outline-none focus:border-crm-accent focus:ring-1 focus:ring-crm-accent transition-colors"
            />
          </div>

          {/* Status Filter Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
            {["all", "draft", "queued", "sending", "completed"].map((st) => (
              <button
                key={st}
                onClick={() => setSelectedStatusFilter(st)}
                className={`px-2.5 py-1 rounded text-[11px] font-mono capitalize transition-colors ${
                  selectedStatusFilter === st
                    ? "bg-crm-accent text-white font-medium shadow-sm"
                    : "text-crm-textSecondary hover:text-crm-text hover:bg-crm-elevated"
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>

        {/* Content Body */}
        {loading ? (
          <div className="py-16 flex flex-col items-center justify-center text-center">
            <Loader2 className="w-6 h-6 text-crm-accent animate-spin mb-2" />
            <p className="text-xs font-mono text-crm-textSecondary uppercase tracking-wider">
              Loading campaigns...
            </p>
          </div>
        ) : campaigns.length === 0 ? (
          <div className="py-16 px-4 flex flex-col items-center justify-center text-center">
            <div className="w-12 h-12 rounded-xl bg-crm-elevated border border-crm-border flex items-center justify-center mb-3">
              <Megaphone className="w-6 h-6 text-crm-textSecondary" />
            </div>
            <h3 className="text-sm font-heading font-semibold text-crm-text">
              No campaigns yet — create one to send your first message blast.
            </h3>
            <p className="text-xs text-crm-textSecondary mt-1 max-w-sm">
              Broadcast campaigns send approved WhatsApp templates to your opted-in contacts with real-time delivery tracking.
            </p>
            <button
              onClick={handleOpenCreateModal}
              className="mt-4 px-3.5 py-1.5 rounded-md bg-crm-accent hover:bg-crm-accentHover text-xs font-medium text-white transition-colors shadow-sm"
            >
              Create campaign
            </button>
          </div>
        ) : filteredCampaigns.length === 0 ? (
          <div className="py-12 px-4 text-center">
            <p className="text-xs text-crm-textSecondary">
              No campaigns match your search or filter criteria.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-crm-border">
            {filteredCampaigns.map((campaign) => {
              const template = templateMap.get(campaign.templateId);
              const channel = channelMap.get(campaign.channelId);
              const isActionLoading = !!actionLoading[campaign.id];
              const inlineError = actionErrors[campaign.id];
              const statusLower = campaign.status.toLowerCase();
              const hasRecipients = campaign.totalRecipients > 0;

              return (
                <div
                  key={campaign.id}
                  className="p-5 hover:bg-crm-subtle/30 transition-colors space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    {/* Left: Metadata */}
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className="text-sm font-mono font-semibold text-crm-text">
                          {campaign.name}
                        </span>
                        {renderStatusBadge(campaign.status)}
                      </div>

                      <div className="flex items-center gap-4 text-[11px] font-mono text-crm-textSecondary flex-wrap">
                        <span className="flex items-center gap-1">
                          <FileText className="w-3 h-3 text-crm-accent" />
                          <span>Template: </span>
                          <span className="text-crm-text font-medium">
                            {template?.providerName || campaign.templateId}
                          </span>
                        </span>

                        <span className="flex items-center gap-1">
                          <Radio className="w-3 h-3 text-crm-accent" />
                          <span>Channel: </span>
                          <span className="text-crm-text font-medium">
                            {channel?.phoneNumber || channel?.phoneNumberId || campaign.channelId}
                          </span>
                        </span>

                        <span>Created: {formatDate(campaign.createdAt)}</span>
                      </div>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex items-center gap-2 sm:self-start flex-shrink-0">
                      {statusLower === "draft" && (
                        <button
                          onClick={() => handleDispatch(campaign)}
                          disabled={isActionLoading}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-crm-accent hover:bg-crm-accentHover disabled:opacity-60 text-xs font-medium text-white shadow-sm transition-colors"
                        >
                          {isActionLoading ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Play className="w-3.5 h-3.5" />
                          )}
                          <span>Dispatch</span>
                        </button>
                      )}

                      {(statusLower === "queued" || statusLower === "sending") && (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs font-mono font-medium">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600" />
                          <span>Live updating...</span>
                        </div>
                      )}

                      {statusLower === "completed" && (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-crm-successBg/60 border border-crm-successBorder text-crm-success text-xs font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Done</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Progress Indicator */}
                  <div className="p-3 bg-crm-elevated/40 border border-crm-border/70 rounded-lg">
                    {hasRecipients ? (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] font-mono">
                          <span className="text-crm-textSecondary">
                            <strong className="text-crm-text">{campaign.sentCount}</strong> sent,{" "}
                            <strong
                              className={
                                campaign.failedCount > 0 ? "text-red-600" : "text-crm-text"
                              }
                            >
                              {campaign.failedCount}
                            </strong>{" "}
                            failed of{" "}
                            <strong className="text-crm-text">{campaign.totalRecipients}</strong>{" "}
                            total
                          </span>
                          <span className="text-crm-textMuted font-mono">
                            {Math.round(
                              ((campaign.sentCount + campaign.failedCount) /
                                campaign.totalRecipients) *
                                100
                            )}
                            %
                          </span>
                        </div>
                        {/* Progress Bar */}
                        <div className="w-full bg-crm-elevated rounded-full h-1.5 overflow-hidden flex border border-crm-border/50">
                          <div
                            className="bg-crm-success transition-all duration-300"
                            style={{
                              width: `${(campaign.sentCount / campaign.totalRecipients) * 100}%`,
                            }}
                          />
                          <div
                            className="bg-red-500 transition-all duration-300"
                            style={{
                              width: `${(campaign.failedCount / campaign.totalRecipients) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="text-[11px] font-mono text-crm-textMuted flex items-center justify-between">
                        <span>Progress: —</span>
                        <span>
                          {statusLower === "draft"
                            ? "Pending dispatch"
                            : "Resolving recipients..."}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Inline Dispatch Error Banner */}
                  {inlineError && (
                    <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-start justify-between gap-2.5">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                        <div>
                          <span className="font-semibold text-red-800">Dispatch Error: </span>
                          <span className="font-mono text-[11px]">{inlineError}</span>
                        </div>
                      </div>
                      <button
                        onClick={() =>
                          setActionErrors((prev) => {
                            const next = { ...prev };
                            delete next[campaign.id];
                            return next;
                          })
                        }
                        className="text-red-500 hover:text-red-700 p-0.5"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Campaign Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4 select-none">
          <div className="bg-crm-surface border border-crm-border rounded-xl shadow-lg w-full max-w-lg p-6 relative max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-crm-border">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-md bg-crm-accentSubtle border border-crm-accentBorder flex items-center justify-center text-crm-accent">
                  <Megaphone className="w-4 h-4" />
                </div>
                <h2 className="text-sm font-heading font-semibold text-crm-text">
                  Create Campaign
                </h2>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="text-crm-textMuted hover:text-crm-text p-1 rounded transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {createError && (
              <div className="mt-4 p-2.5 rounded-md bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                <span>{createError}</span>
              </div>
            )}

            {approvedTemplates.length === 0 && (
              <div className="mt-4 p-2.5 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">No approved templates: </span>
                  <span>
                    WhatsApp campaigns can only be created with templates that have status &quot;approved&quot; by Meta.
                    Please visit the Templates page to create and submit a template first.
                  </span>
                </div>
              </div>
            )}

            {connectedChannels.length === 0 && (
              <div className="mt-4 p-2.5 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">No connected channels: </span>
                  <span>
                    Campaigns require a connected WhatsApp channel with verified credentials.
                  </span>
                </div>
              </div>
            )}

            <form onSubmit={handleCreateSubmit} className="mt-4 space-y-3.5">
              {/* Campaign Name */}
              <div>
                <label className="block text-[11px] font-medium text-crm-textSecondary uppercase tracking-wider mb-1">
                  Campaign Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. October Product Announcement"
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-crm-border rounded-md text-xs text-crm-text placeholder-crm-textMuted font-mono focus:outline-none focus:border-crm-accent focus:ring-1 focus:ring-crm-accent transition-colors"
                />
              </div>

              {/* Template Selector (Approved Only) */}
              <div>
                <label className="block text-[11px] font-medium text-crm-textSecondary uppercase tracking-wider mb-1">
                  Approved Template <span className="text-red-500">*</span>
                </label>
                <select
                  required
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-crm-border rounded-md text-xs text-crm-text font-mono focus:outline-none focus:border-crm-accent focus:ring-1 focus:ring-crm-accent transition-colors"
                >
                  {approvedTemplates.length === 0 ? (
                    <option value="">No approved templates available</option>
                  ) : (
                    <>
                      <option value="">Select an approved template...</option>
                      {approvedTemplates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.providerName} ({t.category} / {t.language})
                        </option>
                      ))}
                    </>
                  )}
                </select>
                <p className="mt-1 text-[10px] text-crm-textMuted">
                  Only Meta-approved templates are listed here.
                </p>
              </div>

              {/* Channel Selector (Connected Only) */}
              <div>
                <label className="block text-[11px] font-medium text-crm-textSecondary uppercase tracking-wider mb-1">
                  WhatsApp Channel <span className="text-red-500">*</span>
                </label>
                <select
                  required
                  value={selectedChannelId}
                  onChange={(e) => setSelectedChannelId(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-crm-border rounded-md text-xs text-crm-text font-mono focus:outline-none focus:border-crm-accent focus:ring-1 focus:ring-crm-accent transition-colors"
                >
                  {connectedChannels.length === 0 ? (
                    <option value="">No connected channels available</option>
                  ) : (
                    <>
                      <option value="">Select a connected channel...</option>
                      {connectedChannels.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.phoneNumber || c.phoneNumberId || c.id} ({c.provider})
                        </option>
                      ))}
                    </>
                  )}
                </select>
              </div>

              <div className="pt-3 border-t border-crm-border flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-3 py-1.5 rounded-md border border-crm-border text-xs font-medium text-crm-textSecondary hover:text-crm-text hover:bg-crm-elevated transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    createLoading ||
                    approvedTemplates.length === 0 ||
                    connectedChannels.length === 0
                  }
                  className="px-4 py-1.5 rounded-md bg-crm-accent hover:bg-crm-accentHover text-xs font-medium text-white transition-colors shadow-sm disabled:opacity-60 flex items-center gap-1.5"
                >
                  {createLoading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Creating...</span>
                    </>
                  ) : (
                    <span>Create Draft Campaign</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
