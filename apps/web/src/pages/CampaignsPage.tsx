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
  Archive,
  ArchiveRestore,
  Users,
  MoreVertical,
  Pencil,
  Trash2,
  XCircle,
} from "lucide-react";

export interface Campaign {
  id: string;
  workspaceId: string;
  templateId: string;
  channelId: string;
  name: string;
  status: "draft" | "queued" | "sending" | "completed" | "cancelled" | string;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  skippedCount?: number;
  variableMapping?: Record<string, unknown> | null;
  segment?: unknown | null;
  archived?: boolean;
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
  placeholders?: string[] | null;
}

export interface Channel {
  id: string;
  type: string;
  provider: string;
  phoneNumber?: string | null;
  phoneNumberId?: string | null;
  status: string;
}

export interface Contact {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  attributes?: Record<string, unknown> | null;
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
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [attributeKeys, setAttributeKeys] = useState<string[]>([]);

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Search and Filter
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>("all");
  const [showArchived, setShowArchived] = useState<boolean>(false);

  // Per-campaign action state
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});

  // Overflow menu state (tracks open dropdown)
  const [openMenuCampaignId, setOpenMenuCampaignId] = useState<string | null>(null);

  // Delete Campaign state
  const [campaignToDelete, setCampaignToDelete] = useState<Campaign | null>(null);
  const [deleteLoading, setDeleteLoading] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Cancel Campaign state
  const [campaignToCancel, setCampaignToCancel] = useState<Campaign | null>(null);
  const [cancelLoading, setCancelLoading] = useState<boolean>(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Create / Edit Campaign Modal state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [campaignName, setCampaignName] = useState<string>("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [selectedChannelId, setSelectedChannelId] = useState<string>("");
  const [createLoading, setCreateLoading] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Segmentation state
  const [segmentType, setSegmentType] = useState<"all" | "contact_ids" | "filter">("all");
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [contactSearch, setContactSearch] = useState<string>("");
  const [filterAttributeKey, setFilterAttributeKey] = useState<string>("");
  const [filterAttributeValue, setFilterAttributeValue] = useState<string>("");

  // Variable mapping state
  const [variableMappings, setVariableMappings] = useState<
    Record<
      string,
      {
        source: "contact_field" | "fixed";
        field?: "name" | "email" | "phone";
        value?: string;
      }
    >
  >({});

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

        // Stop polling when campaign reaches terminal status "completed" or "cancelled"
        if (
          updated.status.toLowerCase() === "completed" ||
          updated.status.toLowerCase() === "cancelled"
        ) {
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

  // Fetch campaigns list (respecting showArchived)
  const fetchCampaigns = useCallback(
    async (includeArchived: boolean = showArchived) => {
      setLoading(true);
      setError(null);
      try {
        const endpoint = includeArchived
          ? "/api/v1/campaigns?includeArchived=true"
          : "/api/v1/campaigns";
        const data = await api.get<Campaign[]>(endpoint);
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
    },
    [showArchived]
  );

  // Fetch templates, channels, contacts, and attribute keys for dropdowns and segmentation
  const fetchPrerequisites = useCallback(async () => {
    try {
      const [tmplData, chanData, contactsData, keysData] = await Promise.all([
        api.get<Template[]>("/api/v1/templates"),
        api.get<Channel[]>("/api/v1/channels"),
        api.get<Contact[]>("/api/v1/contacts"),
        api.get<{ keys: string[] }>("/api/v1/contacts/attribute-keys"),
      ]);
      setTemplates(tmplData);
      setChannels(chanData);
      setContacts(contactsData);
      if (keysData && Array.isArray(keysData.keys)) {
        setAttributeKeys(keysData.keys);
      }
    } catch {
      // Non-blocking background fetch
    }
  }, []);

  useEffect(() => {
    fetchCampaigns(showArchived);
  }, [showArchived, fetchCampaigns]);

  useEffect(() => {
    fetchPrerequisites();
  }, [fetchPrerequisites]);

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

  // Selected template object
  const selectedTemplate = useMemo(() => {
    return templates.find((t) => t.id === selectedTemplateId) || null;
  }, [templates, selectedTemplateId]);

  // Placeholders for selected template
  const selectedTemplatePlaceholders = useMemo(() => {
    return Array.isArray(selectedTemplate?.placeholders)
      ? (selectedTemplate?.placeholders as string[])
      : [];
  }, [selectedTemplate]);

  // Initialize or update variable mappings whenever selected template placeholders change
  useEffect(() => {
    if (selectedTemplatePlaceholders.length > 0) {
      setVariableMappings((prev) => {
        const next: Record<
          string,
          {
            source: "contact_field" | "fixed";
            field?: "name" | "email" | "phone";
            value?: string;
          }
        > = {};
        for (const p of selectedTemplatePlaceholders) {
          next[p] = prev[p] || { source: "contact_field", field: "name" };
        }
        return next;
      });
    } else {
      setVariableMappings({});
    }
  }, [selectedTemplatePlaceholders]);

  // Filtered contacts for manual selection in segmentation
  const filteredContactList = useMemo(() => {
    const query = contactSearch.trim().toLowerCase();
    if (!query) return contacts;
    return contacts.filter(
      (c) =>
        (c.name && c.name.toLowerCase().includes(query)) ||
        c.phone.toLowerCase().includes(query) ||
        (c.email && c.email.toLowerCase().includes(query))
    );
  }, [contacts, contactSearch]);

  // Open Create Campaign modal with fresh defaults
  const handleOpenCreateModal = () => {
    setEditingCampaign(null);
    setCreateError(null);
    setCampaignName("");
    const initialTmplId = approvedTemplates[0]?.id || "";
    setSelectedTemplateId(initialTmplId);
    setSelectedChannelId(connectedChannels[0]?.id || "");
    setSegmentType("all");
    setSelectedContactIds([]);
    setContactSearch("");
    setFilterAttributeKey(attributeKeys[0] || "");
    setFilterAttributeValue("");
    setVariableMappings({});
    setIsCreateModalOpen(true);
  };

  // Open Edit Campaign modal with pre-filled campaign data
  const handleOpenEditModal = (campaign: Campaign) => {
    setEditingCampaign(campaign);
    setCreateError(null);
    setCampaignName(campaign.name);
    setSelectedTemplateId(campaign.templateId);
    setSelectedChannelId(campaign.channelId);

    // Pre-fill segment
    const seg = campaign.segment as any;
    if (seg && typeof seg === "object") {
      if (seg.type === "contact_ids" && Array.isArray(seg.contactIds)) {
        setSegmentType("contact_ids");
        setSelectedContactIds(seg.contactIds);
        setFilterAttributeKey(attributeKeys[0] || "");
        setFilterAttributeValue("");
      } else if (seg.type === "filter" && Array.isArray(seg.conditions) && seg.conditions[0]) {
        setSegmentType("filter");
        setSelectedContactIds([]);
        setFilterAttributeKey(seg.conditions[0].key || attributeKeys[0] || "");
        setFilterAttributeValue(String(seg.conditions[0].value ?? ""));
      } else {
        setSegmentType("all");
        setSelectedContactIds([]);
        setFilterAttributeKey(attributeKeys[0] || "");
        setFilterAttributeValue("");
      }
    } else {
      setSegmentType("all");
      setSelectedContactIds([]);
      setFilterAttributeKey(attributeKeys[0] || "");
      setFilterAttributeValue("");
    }

    // Pre-fill variable mapping
    const vm = campaign.variableMapping as Record<string, any> | null | undefined;
    if (vm && typeof vm === "object") {
      const mapped: Record<
        string,
        {
          source: "contact_field" | "fixed";
          field?: "name" | "email" | "phone";
          value?: string;
        }
      > = {};
      for (const [key, val] of Object.entries(vm)) {
        if (val && val.source === "fixed") {
          mapped[key] = { source: "fixed", value: val.value || "" };
        } else {
          mapped[key] = { source: "contact_field", field: val?.field || "name" };
        }
      }
      setVariableMappings(mapped);
    } else {
      setVariableMappings({});
    }

    setIsCreateModalOpen(true);
  };

  // Submit Campaign (Create or Edit)
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

    // Build and validate segment object
    let segmentPayload: any = { type: "all" };
    if (segmentType === "contact_ids") {
      if (selectedContactIds.length === 0) {
        setCreateError("Please select at least one contact for this campaign.");
        return;
      }
      segmentPayload = {
        type: "contact_ids",
        contactIds: selectedContactIds,
      };
    } else if (segmentType === "filter") {
      if (!filterAttributeKey.trim()) {
        setCreateError("Please select an attribute key to filter by.");
        return;
      }
      if (!filterAttributeValue.trim()) {
        setCreateError("Please enter a value to match for the selected attribute.");
        return;
      }
      segmentPayload = {
        type: "filter",
        conditions: [
          {
            key: filterAttributeKey.trim(),
            operator: "equals",
            value: filterAttributeValue.trim(),
          },
        ],
      };
    }

    // Build and validate variableMapping object if template has placeholders
    let variableMappingPayload: Record<string, any> | undefined = undefined;
    if (selectedTemplatePlaceholders.length > 0) {
      variableMappingPayload = {};
      for (const p of selectedTemplatePlaceholders) {
        const mapping = variableMappings[p] || {
          source: "contact_field",
          field: "name",
        };

        if (mapping.source === "fixed") {
          const fixedVal = mapping.value?.trim();
          if (!fixedVal) {
            setCreateError(`Please provide a fixed value for placeholder {{${p}}}.`);
            return;
          }
          variableMappingPayload[p] = {
            source: "fixed",
            value: fixedVal,
          };
        } else {
          variableMappingPayload[p] = {
            source: "contact_field",
            field: mapping.field || "name",
          };
        }
      }
    }

    setCreateLoading(true);
    setCreateError(null);

    try {
      if (editingCampaign) {
        const updated = await api.patch<Campaign>(`/api/v1/campaigns/${editingCampaign.id}`, {
          name: trimmedName,
          templateId: selectedTemplateId,
          channelId: selectedChannelId,
          segment: segmentPayload,
          variableMapping: variableMappingPayload,
        });

        setIsCreateModalOpen(false);
        setEditingCampaign(null);
        setSuccessMessage(`Campaign "${trimmedName}" updated successfully.`);
        setCampaigns((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      } else {
        await api.post<Campaign>("/api/v1/campaigns", {
          name: trimmedName,
          templateId: selectedTemplateId,
          channelId: selectedChannelId,
          segment: segmentPayload,
          variableMapping: variableMappingPayload,
        });

        setIsCreateModalOpen(false);
        setSuccessMessage(`Campaign "${trimmedName}" created successfully as draft.`);
        await fetchCampaigns(showArchived);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setCreateError(err.message);
      } else if (err instanceof Error) {
        setCreateError(err.message);
      } else {
        setCreateError(editingCampaign ? "Failed to update campaign." : "Failed to create campaign.");
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

  // Archive campaign
  const handleArchive = async (campaign: Campaign) => {
    setActionLoading((prev) => ({ ...prev, [campaign.id]: true }));
    setActionErrors((prev) => {
      const next = { ...prev };
      delete next[campaign.id];
      return next;
    });

    try {
      const updated = await api.post<Campaign>(`/api/v1/campaigns/${campaign.id}/archive`);
      if (!showArchived) {
        // Remove from visible list if not viewing archived
        setCampaigns((prev) => prev.filter((c) => c.id !== campaign.id));
      } else {
        setCampaigns((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      }
      setSuccessMessage(`Campaign "${campaign.name}" archived.`);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to archive campaign.";
      setActionErrors((prev) => ({ ...prev, [campaign.id]: msg }));
    } finally {
      setActionLoading((prev) => ({ ...prev, [campaign.id]: false }));
    }
  };

  // Unarchive campaign
  const handleUnarchive = async (campaign: Campaign) => {
    setActionLoading((prev) => ({ ...prev, [campaign.id]: true }));
    setActionErrors((prev) => {
      const next = { ...prev };
      delete next[campaign.id];
      return next;
    });

    try {
      const updated = await api.post<Campaign>(`/api/v1/campaigns/${campaign.id}/unarchive`);
      setCampaigns((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setSuccessMessage(`Campaign "${campaign.name}" unarchived.`);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to unarchive campaign.";
      setActionErrors((prev) => ({ ...prev, [campaign.id]: msg }));
    } finally {
      setActionLoading((prev) => ({ ...prev, [campaign.id]: false }));
    }
  };

  // Confirm delete of a draft campaign
  const handleConfirmDelete = async () => {
    if (!campaignToDelete) return;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await api.delete(`/api/v1/campaigns/${campaignToDelete.id}`);
      setCampaigns((prev) => prev.filter((c) => c.id !== campaignToDelete.id));
      setSuccessMessage(`Campaign "${campaignToDelete.name}" deleted.`);
      setCampaignToDelete(null);
    } catch (err) {
      if (err instanceof ApiError) {
        setDeleteError(err.message);
      } else if (err instanceof Error) {
        setDeleteError(err.message);
      } else {
        setDeleteError("Failed to delete campaign.");
      }
    } finally {
      setDeleteLoading(false);
    }
  };

  // Open cancel campaign confirmation modal
  const handleOpenCancelModal = (campaign: Campaign) => {
    setCampaignToCancel(campaign);
    setCancelError(null);
  };

  // Confirm cancel of an in-progress campaign
  const handleConfirmCancel = async () => {
    if (!campaignToCancel) return;
    setCancelLoading(true);
    setCancelError(null);
    try {
      const updated = await api.post<Campaign>(`/api/v1/campaigns/${campaignToCancel.id}/cancel`);
      // Terminal state: stop polling immediately
      stopPolling(campaignToCancel.id);
      // Reflect updated status immediately in UI
      setCampaigns((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setSuccessMessage(`Campaign "${campaignToCancel.name}" has been cancelled.`);
      setCampaignToCancel(null);
    } catch (err) {
      if (err instanceof ApiError) {
        setCancelError(err.message);
      } else if (err instanceof Error) {
        setCancelError(err.message);
      } else {
        setCancelError("Failed to cancel campaign.");
      }
    } finally {
      setCancelLoading(false);
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
  const renderStatusBadge = (status: string, isArchived?: boolean) => {
    const s = status.toLowerCase();

    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        {s === "completed" && (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-crm-successBg text-crm-success border border-crm-successBorder">
            <CheckCircle2 className="w-3 h-3 text-crm-success" />
            <span>Completed</span>
          </span>
        )}

        {s === "sending" && (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-amber-50 text-amber-700 border border-amber-200">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
            </span>
            <span>Sending</span>
          </span>
        )}

        {s === "queued" && (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-blue-50 text-blue-700 border border-blue-200">
            <Clock className="w-3 h-3 text-blue-600 animate-spin" />
            <span>Queued</span>
          </span>
        )}

        {s === "cancelled" && (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-red-50 text-red-700 border border-red-200">
            <XCircle className="w-3 h-3 text-red-600" />
            <span>Cancelled</span>
          </span>
        )}

        {s !== "completed" && s !== "sending" && s !== "queued" && s !== "cancelled" && (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-crm-elevated text-crm-textSecondary border border-crm-border">
            <FileText className="w-3 h-3 text-crm-textMuted" />
            <span>Draft</span>
          </span>
        )}

        {isArchived && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-crm-elevated text-crm-textMuted border border-crm-border">
            <Archive className="w-3 h-3" />
            <span>Archived</span>
          </span>
        )}
      </div>
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
        <div className="p-4 border-b border-crm-border flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-white">
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

          <div className="flex items-center justify-between md:justify-end gap-3 flex-wrap">
            {/* Status Filter Tabs */}
            <div className="flex items-center gap-1 overflow-x-auto pb-1 md:pb-0">
              {["all", "draft", "queued", "sending", "completed", "cancelled"].map((st) => (
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

            {/* Show Archived Toggle */}
            <label className="flex items-center gap-1.5 cursor-pointer text-xs font-mono text-crm-textSecondary hover:text-crm-text select-none border-l border-crm-border pl-3">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="rounded border-crm-border text-crm-accent focus:ring-crm-accent h-3.5 w-3.5"
              />
              <span>Show archived</span>
            </label>
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
              {showArchived
                ? "No campaigns found (including archived)."
                : "No campaigns yet — create one to send your first message blast."}
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
                  className={`p-5 hover:bg-crm-subtle/30 transition-colors space-y-3 ${
                    campaign.archived ? "opacity-75 bg-crm-elevated/20" : ""
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    {/* Left: Metadata */}
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className="text-sm font-mono font-semibold text-crm-text">
                          {campaign.name}
                        </span>
                        {renderStatusBadge(campaign.status, campaign.archived)}
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
                      {statusLower === "draft" && !campaign.archived && (
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
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs font-mono font-medium">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600" />
                            <span>Live updating...</span>
                          </div>
                          {!campaign.archived && (
                            <button
                              onClick={() => handleOpenCancelModal(campaign)}
                              disabled={isActionLoading}
                              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-medium transition-colors shadow-xs"
                              title="Cancel this in-progress campaign"
                            >
                              <XCircle className="w-3.5 h-3.5 text-red-600" />
                              <span>Cancel</span>
                            </button>
                          )}
                        </div>
                      )}

                      {statusLower === "completed" && (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-crm-successBg/60 border border-crm-successBorder text-crm-success text-xs font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Done</span>
                        </div>
                      )}

                      {statusLower === "cancelled" && (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-50 border border-red-200 text-red-700 text-xs font-medium">
                          <XCircle className="w-3.5 h-3.5 text-red-600" />
                          <span>Cancelled</span>
                        </div>
                      )}

                      {/* Archive / Unarchive Button */}
                      {campaign.archived ? (
                        <button
                          onClick={() => handleUnarchive(campaign)}
                          disabled={isActionLoading}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-crm-border bg-crm-surface hover:bg-crm-elevated text-xs font-medium text-crm-textSecondary hover:text-crm-text transition-colors shadow-xs"
                          title="Restore this campaign to active list"
                        >
                          {isActionLoading ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <ArchiveRestore className="w-3.5 h-3.5 text-crm-accent" />
                          )}
                          <span>Unarchive</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => handleArchive(campaign)}
                          disabled={isActionLoading}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-crm-border bg-crm-surface hover:bg-crm-elevated text-xs font-medium text-crm-textSecondary hover:text-red-600 hover:border-red-200 transition-colors shadow-xs"
                          title="Archive this campaign"
                        >
                          {isActionLoading ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Archive className="w-3.5 h-3.5 text-crm-textMuted" />
                          )}
                          <span>Archive</span>
                        </button>
                      )}

                      {/* Overflow Menu ("...") - Strictly for Draft Campaigns Only */}
                      {statusLower === "draft" && (
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() =>
                              setOpenMenuCampaignId(
                                openMenuCampaignId === campaign.id ? null : campaign.id
                              )
                            }
                            className="p-1.5 rounded-md border border-crm-border bg-crm-surface hover:bg-crm-elevated text-crm-textSecondary hover:text-crm-text transition-colors"
                            title="More actions"
                          >
                            <MoreVertical className="w-3.5 h-3.5" />
                          </button>

                          {openMenuCampaignId === campaign.id && (
                            <>
                              <div
                                className="fixed inset-0 z-20"
                                onClick={() => setOpenMenuCampaignId(null)}
                              />
                              <div className="absolute right-0 top-full mt-1 w-32 bg-crm-surface border border-crm-border rounded-lg shadow-lg py-1 z-30 divide-y divide-crm-border text-xs">
                                <div className="py-0.5">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenMenuCampaignId(null);
                                      handleOpenEditModal(campaign);
                                    }}
                                    className="w-full px-3 py-1.5 text-left text-crm-text hover:bg-crm-elevated flex items-center gap-2 transition-colors"
                                  >
                                    <Pencil className="w-3.5 h-3.5 text-crm-textSecondary" />
                                    <span>Edit</span>
                                  </button>
                                </div>
                                <div className="py-0.5">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenMenuCampaignId(null);
                                      setCampaignToDelete(campaign);
                                      setDeleteError(null);
                                    }}
                                    className="w-full px-3 py-1.5 text-left text-red-600 hover:bg-red-50 flex items-center gap-2 transition-colors"
                                  >
                                    <Trash2 className="w-3.5 h-3.5 text-red-600" />
                                    <span>Delete</span>
                                  </button>
                                </div>
                              </div>
                            </>
                          )}
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
                          <span className="font-semibold text-red-800">Error: </span>
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

      {/* Create / Edit Campaign Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4 select-none">
          <div className="bg-crm-surface border border-crm-border rounded-xl shadow-lg w-full max-w-xl p-6 relative max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-crm-border">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-md bg-crm-accentSubtle border border-crm-accentBorder flex items-center justify-center text-crm-accent">
                  <Megaphone className="w-4 h-4" />
                </div>
                <h2 className="text-sm font-heading font-semibold text-crm-text">
                  {editingCampaign ? "Edit Campaign" : "Create Campaign"}
                </h2>
              </div>
              <button
                onClick={() => {
                  setIsCreateModalOpen(false);
                  setEditingCampaign(null);
                }}
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

            <form onSubmit={handleCreateSubmit} className="mt-4 space-y-4">
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

              {/* Audience Segmentation Section */}
              <div className="space-y-2 pt-2 border-t border-crm-border">
                <label className="block text-[11px] font-medium text-crm-textSecondary uppercase tracking-wider">
                  Audience Targeting <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <label
                    className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors text-xs ${
                      segmentType === "all"
                        ? "border-crm-accent bg-crm-accentSubtle/50 text-crm-accent font-medium shadow-xs"
                        : "border-crm-border hover:bg-crm-elevated text-crm-text"
                    }`}
                  >
                    <input
                      type="radio"
                      name="segmentType"
                      value="all"
                      checked={segmentType === "all"}
                      onChange={() => setSegmentType("all")}
                      className="text-crm-accent focus:ring-crm-accent h-3.5 w-3.5"
                    />
                    <span>All contacts</span>
                  </label>

                  <label
                    className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors text-xs ${
                      segmentType === "contact_ids"
                        ? "border-crm-accent bg-crm-accentSubtle/50 text-crm-accent font-medium shadow-xs"
                        : "border-crm-border hover:bg-crm-elevated text-crm-text"
                    }`}
                  >
                    <input
                      type="radio"
                      name="segmentType"
                      value="contact_ids"
                      checked={segmentType === "contact_ids"}
                      onChange={() => setSegmentType("contact_ids")}
                      className="text-crm-accent focus:ring-crm-accent h-3.5 w-3.5"
                    />
                    <span>Specific contacts</span>
                  </label>

                  <label
                    className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors text-xs ${
                      segmentType === "filter"
                        ? "border-crm-accent bg-crm-accentSubtle/50 text-crm-accent font-medium shadow-xs"
                        : "border-crm-border hover:bg-crm-elevated text-crm-text"
                    }`}
                  >
                    <input
                      type="radio"
                      name="segmentType"
                      value="filter"
                      checked={segmentType === "filter"}
                      onChange={() => setSegmentType("filter")}
                      className="text-crm-accent focus:ring-crm-accent h-3.5 w-3.5"
                    />
                    <span>Filter by attribute</span>
                  </label>
                </div>

                {/* Specific Contacts Sub-view */}
                {segmentType === "contact_ids" && (
                  <div className="mt-2 p-3 bg-crm-elevated/40 border border-crm-border rounded-lg space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-crm-text flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-crm-accent" />
                        <span>Select Recipients:</span>
                      </span>
                      <span className="font-mono text-[11px] text-crm-textSecondary">
                        {selectedContactIds.length} {selectedContactIds.length === 1 ? "contact" : "contacts"} selected
                      </span>
                    </div>

                    <div className="relative">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-crm-textMuted" />
                      <input
                        type="text"
                        placeholder="Search contacts by name, phone, or email..."
                        value={contactSearch}
                        onChange={(e) => setContactSearch(e.target.value)}
                        className="w-full pl-8 pr-2.5 py-1 bg-white border border-crm-border rounded-md text-xs text-crm-text placeholder-crm-textMuted focus:outline-none focus:border-crm-accent"
                      />
                    </div>

                    <div className="max-h-40 overflow-y-auto border border-crm-border rounded-md bg-white divide-y divide-crm-border">
                      {contacts.length === 0 ? (
                        <div className="p-3 text-center text-xs text-crm-textMuted">
                          No contacts found in workspace.
                        </div>
                      ) : filteredContactList.length === 0 ? (
                        <div className="p-3 text-center text-xs text-crm-textMuted">
                          No contacts match &ldquo;{contactSearch}&rdquo;
                        </div>
                      ) : (
                        filteredContactList.map((c) => {
                          const isSelected = selectedContactIds.includes(c.id);
                          return (
                            <label
                              key={c.id}
                              className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-crm-subtle/50 cursor-pointer text-xs transition-colors"
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedContactIds((prev) => [...prev, c.id]);
                                  } else {
                                    setSelectedContactIds((prev) => prev.filter((id) => id !== c.id));
                                  }
                                }}
                                className="rounded border-crm-border text-crm-accent focus:ring-crm-accent h-3.5 w-3.5"
                              />
                              <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                                <span className="truncate font-medium text-crm-text">
                                  {c.name || "Unnamed contact"}
                                </span>
                                <span className="font-mono text-crm-textSecondary text-[11px]">
                                  {c.phone}
                                </span>
                              </div>
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}

                {/* Filter by Attribute Sub-view */}
                {segmentType === "filter" && (
                  <div className="mt-2 p-3 bg-crm-elevated/40 border border-crm-border rounded-lg space-y-2.5">
                    <div className="text-xs font-medium text-crm-text">
                      Filter Contacts by Attribute:
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-mono text-crm-textSecondary uppercase tracking-wider mb-1">
                          Attribute Key
                        </label>
                        <select
                          value={filterAttributeKey}
                          onChange={(e) => setFilterAttributeKey(e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-white border border-crm-border rounded-md text-xs font-mono text-crm-text focus:outline-none focus:border-crm-accent"
                        >
                          <option value="">Select attribute key...</option>
                          {attributeKeys.map((k) => (
                            <option key={k} value={k}>
                              {k}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-mono text-crm-textSecondary uppercase tracking-wider mb-1">
                          Matching Value (Equals)
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. VIP, active, 100"
                          value={filterAttributeValue}
                          onChange={(e) => setFilterAttributeValue(e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-white border border-crm-border rounded-md text-xs font-mono text-crm-text placeholder-crm-textMuted focus:outline-none focus:border-crm-accent"
                        />
                      </div>
                    </div>
                    {attributeKeys.length === 0 && (
                      <p className="text-[10px] text-crm-textMuted">
                        No contact attribute keys found in this workspace yet. You can add attributes to contacts on the Contacts page.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Template Placeholders / Variable Mapping Section */}
              {selectedTemplate && selectedTemplatePlaceholders.length > 0 && (
                <div className="space-y-2.5 pt-2 border-t border-crm-border">
                  <div className="flex items-center justify-between">
                    <label className="block text-[11px] font-medium text-crm-textSecondary uppercase tracking-wider">
                      Template Variable Mapping <span className="text-red-500">*</span>
                    </label>
                    <span className="text-[11px] font-mono text-crm-textMuted">
                      {selectedTemplatePlaceholders.length}{" "}
                      {selectedTemplatePlaceholders.length === 1 ? "variable" : "variables"}
                    </span>
                  </div>

                  <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                    {selectedTemplatePlaceholders.map((placeholder) => {
                      const mapping = variableMappings[placeholder] || {
                        source: "contact_field",
                        field: "name",
                      };

                      return (
                        <div
                          key={placeholder}
                          className="p-2.5 bg-crm-elevated/40 border border-crm-border rounded-lg space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold bg-crm-accentSubtle text-crm-accent border border-crm-accentBorder">
                              {"{{"}{placeholder}{"}}"}
                            </span>

                            {/* Source Toggle */}
                            <div className="inline-flex p-0.5 rounded-md bg-crm-surface border border-crm-border text-xs">
                              <button
                                type="button"
                                onClick={() =>
                                  setVariableMappings((prev) => ({
                                    ...prev,
                                    [placeholder]: {
                                      source: "contact_field",
                                      field: mapping.field || "name",
                                    },
                                  }))
                                }
                                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                                  mapping.source === "contact_field"
                                    ? "bg-crm-accent text-white shadow-xs"
                                    : "text-crm-textSecondary hover:text-crm-text"
                                }`}
                              >
                                Contact Field
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setVariableMappings((prev) => ({
                                    ...prev,
                                    [placeholder]: {
                                      source: "fixed",
                                      value: mapping.value || "",
                                    },
                                  }))
                                }
                                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                                  mapping.source === "fixed"
                                    ? "bg-crm-accent text-white shadow-xs"
                                    : "text-crm-textSecondary hover:text-crm-text"
                                }`}
                              >
                                Fixed Value
                              </button>
                            </div>
                          </div>

                          {/* Source Value Input */}
                          {mapping.source === "contact_field" ? (
                            <select
                              value={mapping.field || "name"}
                              onChange={(e) =>
                                setVariableMappings((prev) => ({
                                  ...prev,
                                  [placeholder]: {
                                    source: "contact_field",
                                    field: e.target.value as "name" | "email" | "phone",
                                  },
                                }))
                              }
                              className="w-full px-2.5 py-1.5 bg-white border border-crm-border rounded-md text-xs font-mono text-crm-text focus:outline-none focus:border-crm-accent"
                            >
                              <option value="name">Contact Name (name)</option>
                              <option value="phone">Phone Number (phone)</option>
                              <option value="email">Email Address (email)</option>
                            </select>
                          ) : (
                            <input
                              type="text"
                              placeholder={`Fixed value for {{${placeholder}}}...`}
                              value={mapping.value || ""}
                              onChange={(e) =>
                                setVariableMappings((prev) => ({
                                  ...prev,
                                  [placeholder]: {
                                    source: "fixed",
                                    value: e.target.value,
                                  },
                                }))
                              }
                              className="w-full px-2.5 py-1.5 bg-white border border-crm-border rounded-md text-xs font-mono text-crm-text placeholder-crm-textMuted focus:outline-none focus:border-crm-accent"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="pt-3 border-t border-crm-border flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsCreateModalOpen(false);
                    setEditingCampaign(null);
                  }}
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
                      <span>{editingCampaign ? "Saving..." : "Creating..."}</span>
                    </>
                  ) : (
                    <span>{editingCampaign ? "Save Changes" : "Create Draft Campaign"}</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Campaign Confirmation Modal */}
      {campaignToDelete && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4 select-none">
          <div className="bg-crm-surface border border-crm-border rounded-xl shadow-lg w-full max-w-md p-6 relative">
            <div className="flex items-center justify-between pb-4 border-b border-crm-border">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-md bg-red-50 border border-red-200 flex items-center justify-center text-red-600">
                  <Trash2 className="w-4 h-4" />
                </div>
                <h2 className="text-sm font-heading font-semibold text-crm-text">
                  Delete Campaign
                </h2>
              </div>
              <button
                onClick={() => {
                  setCampaignToDelete(null);
                  setDeleteError(null);
                }}
                className="text-crm-textMuted hover:text-crm-text p-1 rounded transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {deleteError && (
              <div className="mt-4 p-2.5 rounded-md bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                <span>{deleteError}</span>
              </div>
            )}

            <div className="mt-4 space-y-2 text-xs text-crm-textSecondary">
              <p>
                Are you sure you want to permanently delete the draft campaign{" "}
                <strong className="text-crm-text">&quot;{campaignToDelete.name}&quot;</strong>?
              </p>
              <p className="text-[11px] text-crm-textMuted">
                This action cannot be undone. Only draft campaigns with zero recipients can be deleted.
              </p>
            </div>

            <div className="mt-6 pt-3 border-t border-crm-border flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setCampaignToDelete(null);
                  setDeleteError(null);
                }}
                className="px-3 py-1.5 rounded-md border border-crm-border text-xs font-medium text-crm-textSecondary hover:text-crm-text hover:bg-crm-elevated transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteLoading}
                onClick={handleConfirmDelete}
                className="px-4 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-xs font-medium text-white transition-colors shadow-sm disabled:opacity-60 flex items-center gap-1.5"
              >
                {deleteLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <span>Delete Campaign</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Campaign Confirmation Modal */}
      {campaignToCancel && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4 select-none">
          <div className="bg-crm-surface border border-crm-border rounded-xl shadow-lg w-full max-w-md p-6 relative">
            <div className="flex items-center justify-between pb-4 border-b border-crm-border">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-md bg-red-50 border border-red-200 flex items-center justify-center text-red-600">
                  <XCircle className="w-4 h-4" />
                </div>
                <h2 className="text-sm font-heading font-semibold text-crm-text">
                  Cancel Campaign
                </h2>
              </div>
              <button
                onClick={() => {
                  setCampaignToCancel(null);
                  setCancelError(null);
                }}
                className="text-crm-textMuted hover:text-crm-text p-1 rounded transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {cancelError && (
              <div className="mt-4 p-2.5 rounded-md bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                <span>{cancelError}</span>
              </div>
            )}

            <div className="mt-4 space-y-2 text-xs text-crm-textSecondary">
              <p>
                Are you sure you want to cancel the in-progress campaign{" "}
                <strong className="text-crm-text">&quot;{campaignToCancel.name}&quot;</strong>?
              </p>
              <p className="text-[11px] text-crm-textMuted">
                This will immediately stop any further outbound messages. Messages already sent cannot be recalled, and remaining recipients will be skipped.
              </p>
            </div>

            <div className="mt-6 pt-3 border-t border-crm-border flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setCampaignToCancel(null);
                  setCancelError(null);
                }}
                className="px-3 py-1.5 rounded-md border border-crm-border text-xs font-medium text-crm-textSecondary hover:text-crm-text hover:bg-crm-elevated transition-colors"
              >
                Keep running
              </button>
              <button
                type="button"
                disabled={cancelLoading}
                onClick={handleConfirmCancel}
                className="px-4 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-xs font-medium text-white transition-colors shadow-sm disabled:opacity-60 flex items-center gap-1.5"
              >
                {cancelLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Cancelling...</span>
                  </>
                ) : (
                  <span>Cancel Campaign</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
