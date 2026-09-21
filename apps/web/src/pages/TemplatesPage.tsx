import React, { useState, useEffect, useCallback, useMemo } from "react";
import { api, ApiError } from "../lib/api";
import {
  FileText,
  Plus,
  Search,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
  X,
  Loader2,
  RefreshCw,
  Send,
  Radio,
  HelpCircle,
} from "lucide-react";

export interface Template {
  id: string;
  channelId: string;
  providerName: string;
  providerTemplateId?: string | null;
  language: string;
  category: "marketing" | "utility" | "authentication" | string;
  previousCategory?: string | null;
  bodyPreview: string;
  variableCount: number;
  status: "draft" | "submitted" | "approved" | "rejected" | string;
  rejectionReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Channel {
  id: string;
  type: string;
  provider: string;
  wabaId?: string | null;
  phoneNumberId?: string | null;
  phoneNumber?: string | null;
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

export const TemplatesPage: React.FC = () => {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>("all");

  // Per-template action loading & error states
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});

  // Create Template Modal state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [channelId, setChannelId] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [language, setLanguage] = useState<string>("en_US");
  const [category, setCategory] = useState<"marketing" | "utility" | "authentication">("utility");
  const [body, setBody] = useState<string>("");
  const [createLoading, setCreateLoading] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Fetch channels to populate dropdown & match channel info
  const fetchChannels = useCallback(async () => {
    try {
      const data = await api.get<Channel[]>("/api/v1/channels");
      setChannels(data);
    } catch {
      // Non-blocking channel fetch error
    }
  }, []);

  // Fetch templates list
  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<Template[]>("/api/v1/templates");
      setTemplates(data);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to load templates.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
    fetchChannels();
  }, [fetchTemplates, fetchChannels]);

  // Filter connected channels only for creation
  const connectedChannels = useMemo(() => {
    return channels.filter((c) => c.status.toLowerCase() === "connected");
  }, [channels]);

  // Channel lookup dictionary
  const channelMap = useMemo(() => {
    const map = new Map<string, Channel>();
    for (const ch of channels) {
      map.set(ch.id, ch);
    }
    return map;
  }, [channels]);

  // Open modal and preselect first connected channel if available
  const handleOpenCreateModal = () => {
    setCreateError(null);
    setChannelId(connectedChannels[0]?.id || "");
    setName("");
    setLanguage("en_US");
    setCategory("utility");
    setBody("");
    setIsCreateModalOpen(true);
  };

  // Submit new template
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!channelId) {
      setCreateError("Please select a connected channel.");
      return;
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      setCreateError("Template name is required.");
      return;
    }

    if (!/^[a-z0-9_]+$/.test(trimmedName)) {
      setCreateError("Template name must be lowercase letters, numbers, and underscores only.");
      return;
    }

    if (!body.trim()) {
      setCreateError("Template body is required.");
      return;
    }

    setCreateLoading(true);
    setCreateError(null);

    try {
      await api.post<Template>("/api/v1/templates", {
        channelId,
        name: trimmedName,
        language: language.trim() || "en_US",
        category,
        body: body.trim(),
      });

      setIsCreateModalOpen(false);
      setSuccessMessage(`Template "${trimmedName}" created successfully as draft.`);
      await fetchTemplates();
    } catch (err) {
      if (err instanceof ApiError) {
        setCreateError(err.message);
      } else if (err instanceof Error) {
        setCreateError(err.message);
      } else {
        setCreateError("Failed to create template.");
      }
    } finally {
      setCreateLoading(false);
    }
  };

  // Submit draft template to Meta
  const handleSubmitToMeta = async (template: Template) => {
    setActionLoading((prev) => ({ ...prev, [template.id]: true }));
    setActionErrors((prev) => {
      const next = { ...prev };
      delete next[template.id];
      return next;
    });

    try {
      const updated = await api.post<Template>(`/api/v1/templates/${template.id}/submit`);
      setTemplates((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      setSuccessMessage(`Template "${template.providerName}" submitted to Meta for approval.`);
    } catch (err) {
      const errorMsg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
          ? err.message
          : "Failed to submit template to Meta.";
      setActionErrors((prev) => ({ ...prev, [template.id]: errorMsg }));
    } finally {
      setActionLoading((prev) => ({ ...prev, [template.id]: false }));
    }
  };

  // Check approval status from Meta
  const handleCheckStatus = async (template: Template) => {
    setActionLoading((prev) => ({ ...prev, [template.id]: true }));
    setActionErrors((prev) => {
      const next = { ...prev };
      delete next[template.id];
      return next;
    });

    try {
      const updated = await api.get<Template>(`/api/v1/templates/${template.id}/status`);
      setTemplates((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      if (updated.status.toLowerCase() === "approved") {
        setSuccessMessage(`Template "${template.providerName}" has been approved by Meta.`);
      } else if (updated.status.toLowerCase() === "rejected") {
        setSuccessMessage(`Template "${template.providerName}" was rejected by Meta.`);
      } else {
        setSuccessMessage(`Template "${template.providerName}" status checked: ${updated.status}.`);
      }
    } catch (err) {
      const errorMsg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
          ? err.message
          : "Failed to check status from Meta.";
      setActionErrors((prev) => ({ ...prev, [template.id]: errorMsg }));
    } finally {
      setActionLoading((prev) => ({ ...prev, [template.id]: false }));
    }
  };

  // Filter templates list
  const filteredTemplates = useMemo(() => {
    return templates.filter((template) => {
      const matchesSearch =
        !searchQuery.trim() ||
        template.providerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        template.bodyPreview.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesStatus =
        selectedStatusFilter === "all" ||
        template.status.toLowerCase() === selectedStatusFilter.toLowerCase();

      return matchesSearch && matchesStatus;
    });
  }, [templates, searchQuery, selectedStatusFilter]);

  const renderStatusBadge = (status: string) => {
    const s = status.toLowerCase();

    if (s === "approved") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-crm-successBg text-crm-success border border-crm-successBorder">
          <CheckCircle2 className="w-3 h-3 text-crm-success" />
          <span>Approved</span>
        </span>
      );
    }

    if (s === "submitted") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-amber-50 text-amber-700 border border-amber-200">
          <Clock className="w-3 h-3 text-amber-600" />
          <span>Submitted</span>
        </span>
      );
    }

    if (s === "rejected") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-red-50 text-red-700 border border-red-200">
          <XCircle className="w-3 h-3 text-red-600" />
          <span>Rejected</span>
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
              Templates
            </h1>
            <span className="px-2 py-0.5 rounded text-[11px] font-mono text-crm-textSecondary bg-crm-elevated border border-crm-border font-medium">
              {templates.length} {templates.length === 1 ? "template" : "templates"}
            </span>
          </div>
          <p className="text-xs text-crm-textSecondary mt-0.5">
            Create, manage, and submit WhatsApp message templates for Meta approval.
          </p>
        </div>

        <button
          onClick={handleOpenCreateModal}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-crm-accent hover:bg-crm-accentHover text-xs font-medium text-white shadow-sm transition-colors self-start sm:self-auto"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Create template</span>
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

      {/* Templates Card Container */}
      <div className="bg-crm-surface border border-crm-border rounded-xl shadow-sm overflow-hidden">
        {/* Search and Filters Bar */}
        <div className="p-4 border-b border-crm-border flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white">
          <div className="relative flex-1 max-w-md">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-crm-textMuted" />
            <input
              type="text"
              placeholder="Search templates by name or body..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-crm-bg border border-crm-border rounded-md text-xs text-crm-text placeholder-crm-textMuted focus:outline-none focus:border-crm-accent focus:ring-1 focus:ring-crm-accent transition-colors"
            />
          </div>

          {/* Status Filter Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
            {["all", "draft", "submitted", "approved", "rejected"].map((st) => (
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
              Loading templates...
            </p>
          </div>
        ) : templates.length === 0 ? (
          <div className="py-16 px-4 flex flex-col items-center justify-center text-center">
            <div className="w-12 h-12 rounded-xl bg-crm-elevated border border-crm-border flex items-center justify-center mb-3">
              <FileText className="w-6 h-6 text-crm-textSecondary" />
            </div>
            <h3 className="text-sm font-heading font-semibold text-crm-text">
              No templates yet — create one to start sending messages.
            </h3>
            <p className="text-xs text-crm-textSecondary mt-1 max-w-sm">
              WhatsApp requires pre-approved templates for business-initiated outbound conversations.
            </p>
            <button
              onClick={handleOpenCreateModal}
              className="mt-4 px-3.5 py-1.5 rounded-md bg-crm-accent hover:bg-crm-accentHover text-xs font-medium text-white transition-colors shadow-sm"
            >
              Create template
            </button>
          </div>
        ) : filteredTemplates.length === 0 ? (
          <div className="py-12 px-4 text-center">
            <p className="text-xs text-crm-textSecondary">
              No templates match your search or filter criteria.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-crm-border">
            {filteredTemplates.map((template) => {
              const channel = channelMap.get(template.channelId);
              const isActionLoading = !!actionLoading[template.id];
              const inlineError = actionErrors[template.id];
              const statusLower = template.status.toLowerCase();

              return (
                <div
                  key={template.id}
                  className="p-5 hover:bg-crm-subtle/30 transition-colors space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    {/* Left: Metadata */}
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className="text-sm font-mono font-semibold text-crm-text">
                          {template.providerName}
                        </span>
                        {renderStatusBadge(template.status)}
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono text-crm-textSecondary bg-crm-elevated border border-crm-border uppercase">
                          {template.category}
                        </span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-crm-textMuted bg-crm-elevated border border-crm-border">
                          {template.language}
                        </span>
                        {template.previousCategory && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-amber-50 text-amber-800 border border-amber-200">
                            <AlertTriangle className="w-3 h-3 text-amber-600 flex-shrink-0" />
                            <span>Recategorized by Meta</span>
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-4 text-[11px] font-mono text-crm-textSecondary flex-wrap">
                        <span className="flex items-center gap-1">
                          <Radio className="w-3 h-3 text-crm-accent" />
                          <span>Channel: </span>
                          <span className="text-crm-text">
                            {channel?.phoneNumber || template.channelId}
                          </span>
                        </span>
                        {template.variableCount > 0 && (
                          <span>
                            Variables: <span className="text-crm-text">{template.variableCount}</span>
                          </span>
                        )}
                        <span>Created: {formatDate(template.createdAt)}</span>
                      </div>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex items-center gap-2 sm:self-start flex-shrink-0">
                      {statusLower === "draft" && (
                        <button
                          onClick={() => handleSubmitToMeta(template)}
                          disabled={isActionLoading}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-crm-accent hover:bg-crm-accentHover disabled:opacity-60 text-xs font-medium text-white shadow-sm transition-colors"
                        >
                          {isActionLoading ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Send className="w-3.5 h-3.5" />
                          )}
                          <span>Submit to Meta</span>
                        </button>
                      )}

                      {statusLower === "submitted" && (
                        <button
                          onClick={() => handleCheckStatus(template)}
                          disabled={isActionLoading}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-crm-surface hover:bg-crm-elevated border border-crm-border disabled:opacity-60 text-xs font-medium text-crm-text shadow-sm transition-colors"
                        >
                          {isActionLoading ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-crm-accent" />
                          ) : (
                            <RefreshCw className="w-3.5 h-3.5 text-crm-accent" />
                          )}
                          <span>Check status</span>
                        </button>
                      )}

                      {statusLower === "approved" && (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-crm-successBg/60 border border-crm-successBorder text-crm-success text-xs font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Ready for campaigns</span>
                        </div>
                      )}

                      {statusLower === "rejected" && (
                        <span className="text-xs text-red-600 font-medium">
                          Review details below
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Body Preview */}
                  <div className="p-3 bg-crm-elevated/40 border border-crm-border/70 rounded-lg">
                    <div className="text-[11px] font-mono text-crm-textSecondary uppercase tracking-wider mb-1">
                      Body Preview
                    </div>
                    <p className="text-xs text-crm-text whitespace-pre-wrap font-sans leading-relaxed line-clamp-3">
                      {template.bodyPreview}
                    </p>
                  </div>

                  {/* Recategorization Warning Note */}
                  {template.previousCategory && (
                    <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                      <span>
                        Recategorized from <strong className="font-mono uppercase">{template.previousCategory}</strong> to{" "}
                        <strong className="font-mono uppercase">{template.category}</strong> by Meta
                      </span>
                    </div>
                  )}

                  {/* Rejection Reason Prominently Shown */}
                  {statusLower === "rejected" && (
                    <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2.5">
                      <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold text-red-800">Rejection Reason: </span>
                        <span>
                          {template.rejectionReason ||
                            "Rejected by Meta. Please check Meta's template guidelines and create a new template."}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Per-Template Inline Meta Submission Error Banner */}
                  {inlineError && (
                    <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-start justify-between gap-2.5">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                        <div>
                          <span className="font-semibold text-red-800">Meta Error: </span>
                          <span className="font-mono text-[11px]">{inlineError}</span>
                        </div>
                      </div>
                      <button
                        onClick={() =>
                          setActionErrors((prev) => {
                            const next = { ...prev };
                            delete next[template.id];
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

      {/* Create Template Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4 select-none">
          <div className="bg-crm-surface border border-crm-border rounded-xl shadow-lg w-full max-w-lg p-6 relative max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-crm-border">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-md bg-crm-accentSubtle border border-crm-accentBorder flex items-center justify-center text-crm-accent">
                  <FileText className="w-4 h-4" />
                </div>
                <h2 className="text-sm font-heading font-semibold text-crm-text">
                  Create WhatsApp Template
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

            {connectedChannels.length === 0 && (
              <div className="mt-4 p-2.5 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">No connected channels available: </span>
                  <span>
                    Templates can only be created for channels with status &quot;connected&quot;. Please
                    connect and verify a channel first.
                  </span>
                </div>
              </div>
            )}

            <form onSubmit={handleCreateSubmit} className="mt-4 space-y-3.5">
              {/* Channel Selector */}
              <div>
                <label className="block text-[11px] font-medium text-crm-textSecondary uppercase tracking-wider mb-1">
                  Channel <span className="text-red-500">*</span>
                </label>
                <select
                  required
                  value={channelId}
                  onChange={(e) => setChannelId(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-crm-border rounded-md text-xs text-crm-text font-mono focus:outline-none focus:border-crm-accent focus:ring-1 focus:ring-crm-accent transition-colors"
                >
                  {connectedChannels.length === 0 ? (
                    <option value="">No connected channels found</option>
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

              {/* Template Name */}
              <div>
                <label className="block text-[11px] font-medium text-crm-textSecondary uppercase tracking-wider mb-1">
                  Template Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. order_shipped_v1"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-crm-border rounded-md text-xs text-crm-text placeholder-crm-textMuted font-mono focus:outline-none focus:border-crm-accent focus:ring-1 focus:ring-crm-accent transition-colors"
                />
                <p className="mt-1 text-[11px] text-crm-textMuted flex items-center gap-1">
                  <HelpCircle className="w-3 h-3 text-crm-textSecondary" />
                  <span>lowercase letters, numbers, underscores only</span>
                </p>
              </div>

              {/* Grid: Language & Category */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-crm-textSecondary uppercase tracking-wider mb-1">
                    Language <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="en_US"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-crm-border rounded-md text-xs text-crm-text placeholder-crm-textMuted font-mono focus:outline-none focus:border-crm-accent focus:ring-1 focus:ring-crm-accent transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-crm-textSecondary uppercase tracking-wider mb-1">
                    Category <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={category}
                    onChange={(e) =>
                      setCategory(e.target.value as "marketing" | "utility" | "authentication")
                    }
                    className="w-full px-3 py-2 bg-white border border-crm-border rounded-md text-xs text-crm-text font-mono focus:outline-none focus:border-crm-accent focus:ring-1 focus:ring-crm-accent transition-colors"
                  >
                    <option value="utility">Utility</option>
                    <option value="marketing">Marketing</option>
                    <option value="authentication">Authentication</option>
                  </select>
                </div>
              </div>

              {/* Template Body */}
              <div>
                <label className="block text-[11px] font-medium text-crm-textSecondary uppercase tracking-wider mb-1">
                  Template Body <span className="text-red-500">*</span>
                </label>
                <textarea
                  required
                  rows={4}
                  placeholder="Hello {{1}}, your order {{2}} has been confirmed and is now being processed."
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-crm-border rounded-md text-xs text-crm-text placeholder-crm-textMuted font-sans focus:outline-none focus:border-crm-accent focus:ring-1 focus:ring-crm-accent transition-colors leading-relaxed"
                />
                <p className="mt-1 text-[11px] text-crm-textMuted">
                  Use placeholders like <code className="font-mono text-crm-text">&#123;&#123;1&#125;&#125;</code>, <code className="font-mono text-crm-text">&#123;&#123;2&#125;&#125;</code> for dynamic parameters.
                </p>
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
                  disabled={createLoading || connectedChannels.length === 0}
                  className="px-4 py-1.5 rounded-md bg-crm-accent hover:bg-crm-accentHover text-xs font-medium text-white transition-colors shadow-sm disabled:opacity-60 flex items-center gap-1.5"
                >
                  {createLoading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Creating...</span>
                    </>
                  ) : (
                    <span>Create Draft</span>
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
