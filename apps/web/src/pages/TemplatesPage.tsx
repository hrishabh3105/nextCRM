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
  Trash2,
  ExternalLink,
  Phone,
  CornerDownLeft,
  Smartphone,
  CheckCheck,
  Image as ImageIcon,
  Upload,
} from "lucide-react";

export interface TemplateButton {
  type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER";
  text: string;
  url?: string;
  phoneNumber?: string;
}

export interface Template {
  id: string;
  channelId: string;
  providerName: string;
  providerTemplateId?: string | null;
  language: string;
  category: "marketing" | "utility" | "authentication" | string;
  previousCategory?: string | null;
  headerType?: "TEXT" | "IMAGE" | string | null;
  headerText?: string | null;
  headerMediaHandle?: string | null;
  bodyPreview: string;
  footerText?: string | null;
  buttons?: TemplateButton[] | null;
  variableCount: number;
  placeholders?: string[] | null;
  positionalPlaceholders?: string[] | null;
  examples?: Record<string, string> | null;
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

interface ButtonEditorRow {
  type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER";
  text: string;
  url: string;
  phoneNumber: string;
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
  const [headerType, setHeaderType] = useState<"TEXT" | "IMAGE">("TEXT");
  const [headerText, setHeaderText] = useState<string>("");
  const [headerMediaHandle, setHeaderMediaHandle] = useState<string | null>(null);
  const [headerImageFile, setHeaderImageFile] = useState<File | null>(null);
  const [headerImagePreviewUrl, setHeaderImagePreviewUrl] = useState<string | null>(null);
  const [headerUploadLoading, setHeaderUploadLoading] = useState<boolean>(false);
  const [headerUploadError, setHeaderUploadError] = useState<string | null>(null);
  const [body, setBody] = useState<string>("");
  const [footerText, setFooterText] = useState<string>("");
  const [buttons, setButtons] = useState<ButtonEditorRow[]>([]);
  const [examples, setExamples] = useState<Record<string, string>>({});
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

  // Extract named placeholders in body text
  const detectedPlaceholders = useMemo(() => {
    const matches = body.match(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g) ?? [];
    const seen: string[] = [];
    for (const m of matches) {
      const p = m.slice(2, -2);
      if (!seen.includes(p)) seen.push(p);
    }
    return seen;
  }, [body]);

  // Live preview body text with placeholder tokens replaced by their example values
  const previewBody = useMemo(() => {
    if (!body) return "";
    return body.replace(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g, (_match, placeholderName) => {
      const ex = examples[placeholderName];
      return ex && ex.trim().length > 0 ? ex.trim() : `{{${placeholderName}}}`;
    });
  }, [body, examples]);

  // Open modal and preselect first connected channel if available
  const handleOpenCreateModal = () => {
    setCreateError(null);
    setChannelId(connectedChannels[0]?.id || "");
    setName("");
    setLanguage("en_US");
    setCategory("utility");
    setHeaderType("TEXT");
    setHeaderText("");
    setHeaderMediaHandle(null);
    setHeaderImageFile(null);
    if (headerImagePreviewUrl) {
      URL.revokeObjectURL(headerImagePreviewUrl);
      setHeaderImagePreviewUrl(null);
    }
    setHeaderUploadLoading(false);
    setHeaderUploadError(null);
    setBody("");
    setFooterText("");
    setButtons([]);
    setExamples({});
    setIsCreateModalOpen(true);
  };

  // Immediate upload of header image to Meta Resumable Upload API
  const handleHeaderFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!channelId) {
      setHeaderUploadError("Please select a connected channel above before uploading an image.");
      return;
    }

    if (!["image/jpeg", "image/png"].includes(file.type)) {
      setHeaderUploadError("Invalid file type. Only JPEG and PNG images are supported.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setHeaderUploadError("Image file size exceeds 5MB limit.");
      return;
    }

    setHeaderUploadError(null);
    if (headerImagePreviewUrl) {
      URL.revokeObjectURL(headerImagePreviewUrl);
    }
    const previewUrl = URL.createObjectURL(file);
    setHeaderImagePreviewUrl(previewUrl);
    setHeaderImageFile(file);
    setHeaderUploadLoading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("channelId", channelId);

      const result = await api.post<{ handle: string }>("/api/v1/templates/upload-media", formData);
      setHeaderMediaHandle(result.handle);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
          ? err.message
          : "Failed to upload image to Meta.";
      setHeaderUploadError(msg);
      setHeaderMediaHandle(null);
    } finally {
      setHeaderUploadLoading(false);
    }
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

    const trimmedHeader = headerText.trim();
    if (headerType === "TEXT" && trimmedHeader) {
      if (trimmedHeader.length > 60) {
        setCreateError("Header must be 60 characters or fewer.");
        return;
      }
      if (/\{\{.*\}\}/.test(trimmedHeader)) {
        setCreateError("Header cannot contain variables in this version.");
        return;
      }
    }

    if (headerType === "IMAGE") {
      if (headerUploadLoading) {
        setCreateError("Please wait for the header image to finish uploading to Meta.");
        return;
      }
      if (!headerMediaHandle) {
        setCreateError("Please select and upload a header image.");
        return;
      }
    }

    if (!body.trim()) {
      setCreateError("Template body is required.");
      return;
    }

    const trimmedFooter = footerText.trim();
    if (trimmedFooter) {
      if (trimmedFooter.length > 60) {
        setCreateError("Footer must be 60 characters or fewer.");
        return;
      }
      if (/\{\{.*\}\}/.test(trimmedFooter)) {
        setCreateError("Footer cannot contain variables.");
        return;
      }
    }

    // Validate placeholder examples if placeholders exist
    if (detectedPlaceholders.length > 0) {
      for (const p of detectedPlaceholders) {
        if (!examples[p] || !examples[p].trim()) {
          setCreateError(`Please provide an example value for placeholder {{${p}}}.`);
          return;
        }
      }
    }

    // Validate buttons
    if (buttons.length > 3) {
      setCreateError("A maximum of 3 buttons is supported in this version.");
      return;
    }

    const formattedButtons: TemplateButton[] = [];
    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i];
      const text = btn.text.trim();
      if (!text) {
        setCreateError(`Button #${i + 1} text is required.`);
        return;
      }
      if (text.length > 25) {
        setCreateError(`Button #${i + 1} text must be 25 characters or fewer.`);
        return;
      }

      if (btn.type === "QUICK_REPLY") {
        formattedButtons.push({ type: "QUICK_REPLY", text });
      } else if (btn.type === "URL") {
        const url = btn.url.trim();
        if (!url) {
          setCreateError(`Button #${i + 1} URL is required.`);
          return;
        }
        try {
          new URL(url);
        } catch {
          setCreateError(`Button #${i + 1} URL must be a valid URL (including https://).`);
          return;
        }
        formattedButtons.push({ type: "URL", text, url });
      } else if (btn.type === "PHONE_NUMBER") {
        const phone = btn.phoneNumber.trim();
        if (!phone) {
          setCreateError(`Button #${i + 1} phone number is required.`);
          return;
        }
        formattedButtons.push({ type: "PHONE_NUMBER", text, phoneNumber: phone });
      }
    }

    setCreateLoading(true);
    setCreateError(null);

    try {
      await api.post<Template>("/api/v1/templates", {
        channelId,
        name: trimmedName,
        language: language.trim() || "en_US",
        category,
        headerType,
        headerText: headerType === "TEXT" && trimmedHeader ? trimmedHeader : undefined,
        headerMediaHandle: headerType === "IMAGE" && headerMediaHandle ? headerMediaHandle : undefined,
        body: body.trim(),
        footerText: trimmedFooter || undefined,
        buttons: formattedButtons.length > 0 ? formattedButtons : undefined,
        examples: detectedPlaceholders.length > 0 ? examples : undefined,
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
        template.bodyPreview.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (template.headerText && template.headerText.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (template.footerText && template.footerText.toLowerCase().includes(searchQuery.toLowerCase()));

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
            Create, manage, and submit rich WhatsApp message templates for Meta approval.
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
              placeholder="Search templates by name, body, header, or footer..."
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
              WhatsApp requires pre-approved templates with headers, body text, and interactive buttons for outbound conversations.
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
              const buttonList = Array.isArray(template.buttons) ? (template.buttons as TemplateButton[]) : [];

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

                  {/* Rich Template Content Preview */}
                  <div className="p-3 bg-crm-elevated/40 border border-crm-border/70 rounded-lg space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-mono text-crm-textSecondary uppercase tracking-wider">
                      <span>Message Preview</span>
                      {buttonList.length > 0 && (
                        <span className="text-[10px] text-crm-textMuted font-mono">
                          {buttonList.length} {buttonList.length === 1 ? "button" : "buttons"}
                        </span>
                      )}
                    </div>

                    {template.headerType === "IMAGE" ? (
                      <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono text-purple-700 bg-purple-50 border border-purple-200">
                        <ImageIcon className="w-2.5 h-2.5" />
                        <span>IMAGE HEADER</span>
                      </div>
                    ) : template.headerText ? (
                      <div className="text-xs font-bold text-crm-text leading-tight">
                        {template.headerText}
                      </div>
                    ) : null}

                    <p className="text-xs text-crm-text whitespace-pre-wrap font-sans leading-relaxed line-clamp-3">
                      {template.bodyPreview}
                    </p>

                    {template.footerText && (
                      <div className="text-[10px] text-crm-textMuted pt-1 border-t border-crm-border/40">
                        {template.footerText}
                      </div>
                    )}

                    {buttonList.length > 0 && (
                      <div className="flex items-center gap-1.5 pt-1.5 flex-wrap">
                        {buttonList.map((b, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-white border border-crm-border text-crm-text font-medium shadow-2xs"
                          >
                            {b.type === "QUICK_REPLY" && <CornerDownLeft className="w-2.5 h-2.5 text-[#00A884]" />}
                            {b.type === "URL" && <ExternalLink className="w-2.5 h-2.5 text-[#00A884]" />}
                            {b.type === "PHONE_NUMBER" && <Phone className="w-2.5 h-2.5 text-[#00A884]" />}
                            <span>{b.text}</span>
                          </span>
                        ))}
                      </div>
                    )}
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

      {/* Create Template Modal with Live WhatsApp Message Preview */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4 select-none">
          <div className="bg-crm-surface border border-crm-border rounded-xl shadow-lg w-full max-w-4xl p-6 relative max-h-[92vh] overflow-y-auto">
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

            {/* 2-Column Layout: Form on Left, Live Preview on Right */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-4">
              {/* Form Inputs (7 cols on lg) */}
              <form onSubmit={handleCreateSubmit} className="lg:col-span-7 space-y-3.5">
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

                {/* Header (Text vs Image Toggle) */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-[11px] font-medium text-crm-textSecondary uppercase tracking-wider">
                      Header <span className="text-crm-textMuted font-normal lowercase">(optional)</span>
                    </label>
                    <div className="inline-flex p-0.5 bg-crm-elevated rounded-md border border-crm-border">
                      <button
                        type="button"
                        onClick={() => {
                          setHeaderType("TEXT");
                          setHeaderUploadError(null);
                        }}
                        className={`px-2.5 py-0.5 text-[11px] font-medium rounded transition-colors flex items-center gap-1 ${
                          headerType === "TEXT"
                            ? "bg-white text-crm-text shadow-2xs font-semibold"
                            : "text-crm-textMuted hover:text-crm-text"
                        }`}
                      >
                        <FileText className="w-3 h-3" />
                        <span>Text</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setHeaderType("IMAGE");
                          setHeaderText("");
                        }}
                        className={`px-2.5 py-0.5 text-[11px] font-medium rounded transition-colors flex items-center gap-1 ${
                          headerType === "IMAGE"
                            ? "bg-white text-crm-text shadow-2xs font-semibold"
                            : "text-crm-textMuted hover:text-crm-text"
                        }`}
                      >
                        <ImageIcon className="w-3 h-3" />
                        <span>Image</span>
                      </button>
                    </div>
                  </div>

                  {headerType === "TEXT" ? (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-crm-textMuted">Title appearing in bold at top of message</span>
                        <span className={`text-[10px] font-mono ${headerText.length > 60 ? "text-red-500 font-bold" : "text-crm-textMuted"}`}>
                          {headerText.length}/60
                        </span>
                      </div>
                      <input
                        type="text"
                        maxLength={60}
                        placeholder="e.g. Order Update"
                        value={headerText}
                        onChange={(e) => setHeaderText(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-crm-border rounded-md text-xs text-crm-text placeholder-crm-textMuted font-mono focus:outline-none focus:border-crm-accent focus:ring-1 focus:ring-crm-accent transition-colors"
                      />
                      <p className="mt-1 text-[10px] text-crm-textMuted">
                        Text-only header. Variables are not permitted in header text in this version.
                      </p>
                    </div>
                  ) : (
                    <div className="p-3 bg-crm-elevated/40 border border-crm-border rounded-lg space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-medium text-crm-textSecondary uppercase tracking-wider">
                          Header Image (JPEG / PNG, max 5MB)
                        </span>
                        {headerMediaHandle && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Uploaded to Meta</span>
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3">
                        <label className="relative flex-1 cursor-pointer">
                          <input
                            type="file"
                            accept="image/jpeg,image/png"
                            disabled={headerUploadLoading}
                            onChange={handleHeaderFileSelect}
                            className="sr-only"
                          />
                          <div className="w-full px-3 py-2 bg-white border border-dashed border-crm-border hover:border-crm-accent rounded-md flex items-center justify-center gap-2 text-xs text-crm-textSecondary hover:text-crm-text transition-colors">
                            {headerUploadLoading ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin text-crm-accent" />
                                <span className="text-crm-accent font-medium">Uploading to Meta...</span>
                              </>
                            ) : (
                              <>
                                <Upload className="w-4 h-4" />
                                <span>{headerImageFile ? headerImageFile.name : "Choose JPEG or PNG image..."}</span>
                              </>
                            )}
                          </div>
                        </label>

                        {headerImagePreviewUrl && (
                          <div className="relative group w-12 h-12 rounded-md overflow-hidden border border-crm-border bg-gray-100 flex-shrink-0">
                            <img
                              src={headerImagePreviewUrl}
                              alt="Header thumbnail"
                              className="w-full h-full object-cover"
                            />
                          </div>
                        )}
                      </div>

                      {headerUploadError && (
                        <p className="text-[11px] text-red-600 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3 flex-shrink-0" />
                          <span>{headerUploadError}</span>
                        </p>
                      )}

                      <p className="text-[10px] text-crm-textMuted">
                        Images are uploaded directly to Meta via Resumable Upload API. Media handles expire after ~24 hours.
                      </p>
                    </div>
                  )}
                </div>

                {/* Template Body */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[11px] font-medium text-crm-textSecondary uppercase tracking-wider">
                      Template Body <span className="text-red-500">*</span>
                    </label>
                    <span className={`text-[10px] font-mono ${body.length > 1024 ? "text-red-500 font-bold" : "text-crm-textMuted"}`}>
                      {body.length}/1024
                    </span>
                  </div>
                  <textarea
                    required
                    rows={4}
                    maxLength={1024}
                    placeholder="Hello {{name}}, your order {{order_id}} has been shipped and will arrive shortly."
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-crm-border rounded-md text-xs text-crm-text placeholder-crm-textMuted font-sans focus:outline-none focus:border-crm-accent focus:ring-1 focus:ring-crm-accent transition-colors leading-relaxed"
                  />
                  <p className="mt-1 text-[10px] text-crm-textMuted">
                    Use named placeholders like <code className="font-mono text-crm-text bg-crm-elevated px-1 py-0.5 rounded">&#123;&#123;name&#125;&#125;</code> or <code className="font-mono text-crm-text bg-crm-elevated px-1 py-0.5 rounded">&#123;&#123;order_id&#125;&#125;</code>.
                  </p>
                </div>

                {/* Placeholder Example Values (shown only when placeholders detected in body) */}
                {detectedPlaceholders.length > 0 && (
                  <div className="p-3 bg-crm-elevated/40 border border-crm-border rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-crm-textSecondary uppercase tracking-wider">
                        Placeholder Examples <span className="text-red-500">*</span>
                      </span>
                      <span className="text-[10px] font-mono text-crm-textMuted">Required for Meta Approval</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {detectedPlaceholders.map((p) => (
                        <div key={p}>
                          <label className="block text-[10px] font-mono text-crm-textSecondary mb-0.5">
                            &#123;&#123;{p}&#125;&#125;
                          </label>
                          <input
                            type="text"
                            required
                            placeholder={`e.g. John Doe for ${p}`}
                            value={examples[p] || ""}
                            onChange={(e) =>
                              setExamples((prev) => ({ ...prev, [p]: e.target.value }))
                            }
                            className="w-full px-2.5 py-1.5 bg-white border border-crm-border rounded-md text-xs font-mono text-crm-text placeholder-crm-textMuted focus:outline-none focus:border-crm-accent"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Footer Text (Optional, max 60, no variables) */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[11px] font-medium text-crm-textSecondary uppercase tracking-wider">
                      Footer Text <span className="text-crm-textMuted font-normal lowercase">(optional)</span>
                    </label>
                    <span className={`text-[10px] font-mono ${footerText.length > 60 ? "text-red-500 font-bold" : "text-crm-textMuted"}`}>
                      {footerText.length}/60
                    </span>
                  </div>
                  <input
                    type="text"
                    maxLength={60}
                    placeholder="e.g. Reply STOP to opt out"
                    value={footerText}
                    onChange={(e) => setFooterText(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-crm-border rounded-md text-xs text-crm-text placeholder-crm-textMuted font-mono focus:outline-none focus:border-crm-accent focus:ring-1 focus:ring-crm-accent transition-colors"
                  />
                  <p className="mt-1 text-[10px] text-crm-textMuted">
                    Displayed in subtle small text at the bottom. Variables are not permitted.
                  </p>
                </div>

                {/* Buttons Editor (Max 3) */}
                <div className="space-y-2 pt-2 border-t border-crm-border">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="block text-[11px] font-medium text-crm-textSecondary uppercase tracking-wider">
                        Interactive Buttons <span className="text-crm-textMuted font-normal lowercase">(optional)</span>
                      </label>
                      <p className="text-[10px] text-crm-textMuted">
                        Add Quick Replies, web links, or click-to-call buttons (up to 3).
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={buttons.length >= 3}
                      onClick={() => {
                        if (buttons.length < 3) {
                          setButtons((prev) => [
                            ...prev,
                            { type: "QUICK_REPLY", text: "", url: "", phoneNumber: "" },
                          ]);
                        }
                      }}
                      className="flex items-center gap-1 px-2.5 py-1 rounded bg-crm-surface hover:bg-crm-elevated border border-crm-border text-xs font-medium text-crm-text disabled:opacity-50 transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Add button ({buttons.length}/3)</span>
                    </button>
                  </div>

                  {buttons.length > 0 && (
                    <div className="space-y-2.5">
                      {buttons.map((btn, index) => (
                        <div
                          key={index}
                          className="p-3 bg-crm-elevated/40 border border-crm-border rounded-lg space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-mono font-medium text-crm-textSecondary">
                              Button #{index + 1}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setButtons((prev) => prev.filter((_, i) => i !== index));
                              }}
                              className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50 transition-colors"
                              title="Remove button"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[10px] font-mono text-crm-textSecondary uppercase tracking-wider mb-0.5">
                                Type
                              </label>
                              <select
                                value={btn.type}
                                onChange={(e) => {
                                  const newType = e.target.value as "QUICK_REPLY" | "URL" | "PHONE_NUMBER";
                                  setButtons((prev) =>
                                    prev.map((b, i) => (i === index ? { ...b, type: newType } : b))
                                  );
                                }}
                                className="w-full px-2.5 py-1.5 bg-white border border-crm-border rounded-md text-xs font-mono text-crm-text focus:outline-none focus:border-crm-accent"
                              >
                                <option value="QUICK_REPLY">Quick Reply</option>
                                <option value="URL">URL / Web Link</option>
                                <option value="PHONE_NUMBER">Phone Number</option>
                              </select>
                            </div>

                            <div>
                              <div className="flex items-center justify-between mb-0.5">
                                <label className="block text-[10px] font-mono text-crm-textSecondary uppercase tracking-wider">
                                  Button Text <span className="text-red-500">*</span>
                                </label>
                                <span className={`text-[9px] font-mono ${btn.text.length > 25 ? "text-red-500 font-bold" : "text-crm-textMuted"}`}>
                                  {btn.text.length}/25
                                </span>
                              </div>
                              <input
                                type="text"
                                required
                                maxLength={25}
                                placeholder={
                                  btn.type === "QUICK_REPLY"
                                    ? "e.g. Yes / Confirm"
                                    : btn.type === "URL"
                                    ? "e.g. Track Package"
                                    : "e.g. Call Support"
                                }
                                value={btn.text}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setButtons((prev) =>
                                    prev.map((b, i) => (i === index ? { ...b, text: val } : b))
                                  );
                                }}
                                className="w-full px-2.5 py-1.5 bg-white border border-crm-border rounded-md text-xs font-mono text-crm-text placeholder-crm-textMuted focus:outline-none focus:border-crm-accent"
                              />
                            </div>
                          </div>

                          {btn.type === "URL" && (
                            <div>
                              <label className="block text-[10px] font-mono text-crm-textSecondary uppercase tracking-wider mb-0.5">
                                Target Web URL <span className="text-red-500">*</span>
                              </label>
                              <input
                                type="url"
                                required
                                placeholder="https://example.com/tracking"
                                value={btn.url}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setButtons((prev) =>
                                    prev.map((b, i) => (i === index ? { ...b, url: val } : b))
                                  );
                                }}
                                className="w-full px-2.5 py-1.5 bg-white border border-crm-border rounded-md text-xs font-mono text-crm-text placeholder-crm-textMuted focus:outline-none focus:border-crm-accent"
                              />
                            </div>
                          )}

                          {btn.type === "PHONE_NUMBER" && (
                            <div>
                              <label className="block text-[10px] font-mono text-crm-textSecondary uppercase tracking-wider mb-0.5">
                                Phone Number (with country code) <span className="text-red-500">*</span>
                              </label>
                              <input
                                type="tel"
                                required
                                placeholder="+1234567890"
                                value={btn.phoneNumber}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setButtons((prev) =>
                                    prev.map((b, i) => (i === index ? { ...b, phoneNumber: val } : b))
                                  );
                                }}
                                className="w-full px-2.5 py-1.5 bg-white border border-crm-border rounded-md text-xs font-mono text-crm-text placeholder-crm-textMuted focus:outline-none focus:border-crm-accent"
                              />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
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

              {/* Right: Live WhatsApp Message Preview (5 cols on lg) */}
              <div className="lg:col-span-5">
                <div className="flex flex-col h-full bg-[#EFEAE2]/60 rounded-xl p-4 border border-crm-border sticky top-0">
                  <div className="flex items-center justify-between pb-2 mb-3 border-b border-crm-border/60">
                    <div className="flex items-center gap-1.5">
                      <Smartphone className="w-3.5 h-3.5 text-crm-textSecondary" />
                      <span className="text-xs font-mono font-medium text-crm-text">
                        Customer Message Preview
                      </span>
                    </div>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-crm-textSecondary bg-white border border-crm-border/70">
                      Live Preview
                    </span>
                  </div>

                  <div className="flex-1 flex flex-col justify-start max-w-sm w-full mx-auto py-2">
                    {/* WhatsApp Message Bubble */}
                    <div className="bg-white rounded-lg shadow-sm border border-gray-200/70 overflow-hidden text-crm-text relative">
                      {/* Header Image Preview (At the top of the bubble, above header text) */}
                      {headerType === "IMAGE" && headerImagePreviewUrl && (
                        <div className="w-full h-36 bg-gray-100 border-b border-gray-100 relative">
                          <img
                            src={headerImagePreviewUrl}
                            alt="Header Preview"
                            className="w-full h-full object-cover"
                          />
                        </div>
                      )}

                      <div className="p-3.5 space-y-2">
                        {/* Header Text (Bold at top if present) */}
                        {headerType === "TEXT" && headerText.trim() && (
                          <div className="font-bold text-xs text-crm-text leading-tight pb-1 border-b border-gray-100">
                            {headerText.trim()}
                          </div>
                        )}

                      {/* Body text with {{placeholder}} replaced by example values */}
                      <div className="text-xs whitespace-pre-wrap leading-relaxed">
                        {previewBody.trim() ? (
                          previewBody
                        ) : (
                          <span className="text-crm-textMuted italic">
                            Enter template body to see live preview...
                          </span>
                        )}
                      </div>

                      {/* Footer text in small gray at bottom if present */}
                      {footerText.trim() && (
                        <div className="text-[10px] text-gray-500 pt-1 border-t border-gray-100 leading-tight">
                          {footerText.trim()}
                        </div>
                      )}

                      {/* Timestamp & read receipt */}
                      <div className="flex items-center justify-end gap-1 text-[9px] text-gray-400 select-none pt-0.5">
                        <span>10:42 AM</span>
                        <CheckCheck className="w-3 h-3 text-[#53bdeb]" />
                      </div>
                    </div>
                  </div>

                    {/* Buttons rendered as separate tappable-looking rows below the bubble */}
                    {buttons.length > 0 && (
                      <div className="mt-1.5 space-y-1.5">
                        {buttons.map((btn, idx) => (
                          <div
                            key={idx}
                            className="w-full py-2 px-3 bg-white rounded-lg border border-gray-200/80 shadow-xs flex items-center justify-center gap-1.5 text-xs text-[#00A884] font-medium select-none cursor-pointer hover:bg-gray-50 transition-colors"
                          >
                            {btn.type === "QUICK_REPLY" && (
                              <CornerDownLeft className="w-3 h-3 text-[#00A884]" />
                            )}
                            {btn.type === "URL" && (
                              <ExternalLink className="w-3 h-3 text-[#00A884]" />
                            )}
                            {btn.type === "PHONE_NUMBER" && (
                              <Phone className="w-3 h-3 text-[#00A884]" />
                            )}
                            <span className="truncate">
                              {btn.text.trim() || `Button ${idx + 1}`}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
