import React, { useState, useEffect, useCallback } from "react";
import { api, ApiError } from "../lib/api";
import {
  Radio,
  Plus,
  KeyRound,
  X,
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  ShieldCheck,
  Smartphone,
  PowerOff,
  AlertTriangle,
} from "lucide-react";

export interface Channel {
  id: string;
  type: string;
  provider: string;
  wabaId?: string | null;
  phoneNumberId?: string | null;
  phoneNumber?: string | null;
  status: string;
  createdAt: string;
  verificationWarning?: string;
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

export const ChannelsPage: React.FC = () => {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Connect Channel Modal state
  const [isConnectModalOpen, setIsConnectModalOpen] = useState<boolean>(false);
  const [wabaId, setWabaId] = useState<string>("");
  const [phoneNumberId, setPhoneNumberId] = useState<string>("");
  const [phoneNumber, setPhoneNumber] = useState<string>("");
  const [accessToken, setAccessToken] = useState<string>("");
  const [connectLoading, setConnectLoading] = useState<boolean>(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectWarning, setConnectWarning] = useState<string | null>(null);

  // Replace Token Modal state
  const [replaceTargetChannel, setReplaceTargetChannel] = useState<Channel | null>(null);
  const [newToken, setNewToken] = useState<string>("");
  const [replaceLoading, setReplaceLoading] = useState<boolean>(false);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const [replaceWarning, setReplaceWarning] = useState<string | null>(null);
  const [replaceSuccess, setReplaceSuccess] = useState<string | null>(null);
  const [pageWarning, setPageWarning] = useState<string | null>(null);

  // Disconnect State
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);

  // Fetch channels list
  const fetchChannels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<Channel[]>("/api/v1/channels");
      setChannels(data);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to load channels.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  // Handle Connect WhatsApp Submit
  const handleConnectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wabaId.trim() || !phoneNumberId.trim() || !phoneNumber.trim() || !accessToken.trim()) {
      setConnectError("All fields are required to connect WhatsApp.");
      return;
    }

    setConnectLoading(true);
    setConnectError(null);
    setConnectWarning(null);

    try {
      const res = await api.post<Channel>("/api/v1/channels", {
        type: "whatsapp",
        provider: "meta",
        wabaId: wabaId.trim(),
        phoneNumberId: phoneNumberId.trim(),
        phoneNumber: phoneNumber.trim(),
        accessToken: accessToken.trim(),
      });

      // Still refresh the channels list in the background either way, so the pending channel appears there too
      await fetchChannels();

      if (res.verificationWarning) {
        // Keep the modal open (do NOT close it) and show warning in modal's warning area
        setConnectWarning(res.verificationWarning);
        setPageWarning(`Channel created, but verification failed: ${res.verificationWarning}`);
      } else {
        // Only auto-close the modal and show generic success flow when verificationWarning is absent
        setIsConnectModalOpen(false);
        setWabaId("");
        setPhoneNumberId("");
        setPhoneNumber("");
        setAccessToken("");
        setPageWarning(null);
        setReplaceSuccess("WhatsApp channel connected successfully.");
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setConnectError(err.message);
      } else if (err instanceof Error) {
        setConnectError(err.message);
      } else {
        setConnectError("Failed to connect WhatsApp channel.");
      }
    } finally {
      setConnectLoading(false);
    }
  };

  // Handle Replace Token Submit
  const handleReplaceTokenSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replaceTargetChannel) return;
    if (!newToken.trim()) {
      setReplaceError("Access token is required.");
      return;
    }

    setReplaceLoading(true);
    setReplaceError(null);
    setReplaceWarning(null);

    try {
      const res = await api.patch<Channel>(
        `/api/v1/channels/${replaceTargetChannel.id}`,
        {
          accessToken: newToken.trim(),
        }
      );

      // Still refresh the channels list in the background either way
      await fetchChannels();

      if (res.verificationWarning) {
        // Show specific warning message instead of generic success, and keep modal open for correction
        const warningMsg = `Token updated, but verification failed: ${res.verificationWarning}`;
        setReplaceWarning(warningMsg);
        setPageWarning(
          `Token updated for ${replaceTargetChannel.phoneNumber || "channel"}, but verification failed: ${res.verificationWarning}`
        );
      } else {
        // Only auto-close and show generic success when verificationWarning is absent
        setPageWarning(null);
        setReplaceSuccess(
          `Token updated for ${replaceTargetChannel.phoneNumber || "channel"}.`
        );
        setReplaceTargetChannel(null);
        setNewToken("");
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setReplaceError(err.message);
      } else if (err instanceof Error) {
        setReplaceError(err.message);
      } else {
        setReplaceError("Failed to update access token.");
      }
    } finally {
      setReplaceLoading(false);
    }
  };

  // Handle Disconnect Channel
  const handleDisconnect = async (channel: Channel) => {
    const confirmed = window.confirm(
      "Disconnect this channel? Existing templates and campaigns will be preserved but this channel can no longer send messages."
    );

    if (!confirmed) return;

    setDisconnectingId(channel.id);
    setError(null);
    setReplaceSuccess(null);
    setPageWarning(null);

    try {
      await api.post<Channel>(`/api/v1/channels/${channel.id}/disconnect`);
      setReplaceSuccess(`Channel ${channel.phoneNumber || ""} disconnected.`);
      await fetchChannels();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to disconnect channel.");
      }
    } finally {
      setDisconnectingId(null);
    }
  };

  const renderStatusBadge = (status: string) => {
    const s = status.toLowerCase();
    if (s === "active" || s === "connected") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-crm-successBg text-crm-success border border-crm-successBorder">
          <span className="w-1.5 h-1.5 rounded-full bg-crm-success" />
          <span className="capitalize">{status}</span>
        </span>
      );
    }

    if (s === "pending") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-amber-50 text-amber-700 border border-amber-200">
          <Clock className="w-3 h-3 text-amber-600" />
          <span className="capitalize">{status}</span>
        </span>
      );
    }

    if (s === "disconnected") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-crm-elevated text-crm-textSecondary border border-crm-border">
          <span className="w-1.5 h-1.5 rounded-full bg-crm-textMuted" />
          <span>Disconnected</span>
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-crm-elevated text-crm-textSecondary border border-crm-border">
        <span className="w-1.5 h-1.5 rounded-full bg-crm-textMuted" />
        <span className="capitalize">{status}</span>
      </span>
    );
  };

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Top Header & Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-heading font-semibold text-crm-text tracking-tight">
              Channels
            </h1>
            <span className="px-2 py-0.5 rounded text-[11px] font-mono text-crm-textSecondary bg-crm-elevated border border-crm-border font-medium">
              {channels.length} {channels.length === 1 ? "channel" : "channels"}
            </span>
          </div>
          <p className="text-xs text-crm-textSecondary mt-0.5">
            Manage WhatsApp Cloud API connections and credentials.
          </p>
        </div>

        <button
          onClick={() => {
            setConnectError(null);
            setConnectWarning(null);
            setIsConnectModalOpen(true);
          }}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-crm-accent hover:bg-crm-accentHover text-xs font-medium text-white shadow-sm transition-colors self-start sm:self-auto"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Connect WhatsApp</span>
        </button>
      </div>

      {/* Global Page Error Banner */}
      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2.5 text-xs text-red-700">
          <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Global Page Warning Banner */}
      {pageWarning && (
        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-between gap-2.5 text-xs text-amber-800 font-medium shadow-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <span>{pageWarning}</span>
          </div>
          <button
            onClick={() => setPageWarning(null)}
            className="text-amber-800 hover:opacity-80 p-0.5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Success Notification Banner */}
      {replaceSuccess && (
        <div className="p-3 rounded-lg bg-crm-successBg border border-crm-successBorder flex items-center justify-between gap-2.5 text-xs text-crm-success font-medium shadow-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span>{replaceSuccess}</span>
          </div>
          <button
            onClick={() => setReplaceSuccess(null)}
            className="text-crm-success hover:opacity-80 p-0.5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Connected Channels List */}
      <div className="bg-crm-surface border border-crm-border rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-crm-border flex items-center justify-between">
          <h2 className="text-xs font-mono uppercase tracking-wider text-crm-textSecondary font-medium">
            Connected Channels
          </h2>
        </div>

        {loading ? (
          <div className="py-16 flex flex-col items-center justify-center text-center">
            <Loader2 className="w-6 h-6 text-crm-accent animate-spin mb-2" />
            <p className="text-xs font-mono text-crm-textSecondary uppercase tracking-wider">
              Loading channels...
            </p>
          </div>
        ) : channels.length === 0 ? (
          <div className="py-16 px-4 flex flex-col items-center justify-center text-center">
            <div className="w-12 h-12 rounded-xl bg-crm-elevated border border-crm-border flex items-center justify-center mb-3">
              <Radio className="w-6 h-6 text-crm-textSecondary" />
            </div>
            <h3 className="text-sm font-heading font-semibold text-crm-text">
              No channels connected
            </h3>
            <p className="text-xs text-crm-textSecondary mt-1 max-w-sm">
              Connect your WhatsApp Business number to start sending messages and templates.
            </p>
            <button
              onClick={() => {
                setConnectError(null);
                setConnectWarning(null);
                setIsConnectModalOpen(true);
              }}
              className="mt-4 px-3.5 py-1.5 rounded-md bg-crm-accent hover:bg-crm-accentHover text-xs font-medium text-white transition-colors shadow-sm"
            >
              Connect WhatsApp
            </button>
          </div>
        ) : (
          <div className="divide-y divide-crm-border">
            {channels.map((channel) => {
              const isDisconnected = channel.status.toLowerCase() === "disconnected";

              return (
                <div
                  key={channel.id}
                  className={`p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-crm-subtle/30 transition-colors ${
                    isDisconnected ? "opacity-75 bg-crm-elevated/20" : ""
                  }`}
                >
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-crm-accentSubtle border border-crm-accentBorder flex items-center justify-center text-crm-accent flex-shrink-0 mt-0.5">
                      <Smartphone className="w-4 h-4" />
                    </div>

                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className="text-sm font-mono font-medium text-crm-text">
                          {channel.phoneNumber || "No phone number"}
                        </span>
                        {renderStatusBadge(channel.status)}
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-crm-textMuted bg-crm-elevated border border-crm-border">
                          {channel.provider} / {channel.type}
                        </span>
                      </div>

                      <div className="flex items-center gap-4 text-[11px] font-mono text-crm-textSecondary flex-wrap">
                        {channel.wabaId && (
                          <span>WABA ID: <span className="text-crm-text">{channel.wabaId}</span></span>
                        )}
                        {channel.phoneNumberId && (
                          <span>Phone ID: <span className="text-crm-text">{channel.phoneNumberId}</span></span>
                        )}
                        <span>Added: {formatDate(channel.createdAt)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 sm:self-center flex-shrink-0 flex-wrap">
                    <button
                      onClick={() => {
                        setReplaceTargetChannel(channel);
                        setNewToken("");
                        setReplaceError(null);
                        setReplaceWarning(null);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-crm-surface hover:bg-crm-elevated border border-crm-border text-xs font-medium text-crm-text shadow-sm transition-colors"
                    >
                      <KeyRound className="w-3.5 h-3.5 text-crm-accent" />
                      <span>{isDisconnected ? "Reconnect" : "Replace token"}</span>
                    </button>

                    {!isDisconnected && (
                      <button
                        onClick={() => handleDisconnect(channel)}
                        disabled={disconnectingId === channel.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-crm-border text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50 disabled:opacity-50 transition-colors shadow-sm"
                      >
                        {disconnectingId === channel.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <PowerOff className="w-3.5 h-3.5" />
                        )}
                        <span>Disconnect</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Connect WhatsApp Modal */}
      {isConnectModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4 select-none">
          <div className="bg-crm-surface border border-crm-border rounded-xl shadow-lg w-full max-w-lg p-6 relative">
            <div className="flex items-center justify-between pb-4 border-b border-crm-border">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-md bg-crm-accentSubtle border border-crm-accentBorder flex items-center justify-center text-crm-accent">
                  <Radio className="w-4 h-4" />
                </div>
                <h2 className="text-sm font-heading font-semibold text-crm-text">
                  Connect WhatsApp Business
                </h2>
              </div>
              <button
                onClick={() => {
                  setIsConnectModalOpen(false);
                  setConnectError(null);
                  setConnectWarning(null);
                }}
                className="text-crm-textMuted hover:text-crm-text p-1 rounded transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {connectError && (
              <div className="mt-4 p-2.5 rounded-md bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                <span>{connectError}</span>
              </div>
            )}

            {connectWarning && (
              <div className="mt-4 p-2.5 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <p className="font-medium text-amber-900">Channel created (unverified)</p>
                  <p className="text-amber-700">{connectWarning}</p>
                </div>
              </div>
            )}

            <form onSubmit={handleConnectSubmit} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-[11px] font-medium text-crm-textSecondary uppercase tracking-wider mb-1">
                  WhatsApp Business Account ID <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 109876543210987"
                  value={wabaId}
                  onChange={(e) => setWabaId(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-crm-border rounded-md text-xs text-crm-text placeholder-crm-textMuted font-mono focus:outline-none focus:border-crm-accent focus:ring-1 focus:ring-crm-accent transition-colors"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-crm-textSecondary uppercase tracking-wider mb-1">
                  Phone Number ID <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 101234567890123"
                  value={phoneNumberId}
                  onChange={(e) => setPhoneNumberId(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-crm-border rounded-md text-xs text-crm-text placeholder-crm-textMuted font-mono focus:outline-none focus:border-crm-accent focus:ring-1 focus:ring-crm-accent transition-colors"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-crm-textSecondary uppercase tracking-wider mb-1">
                  Phone Number <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. +14155552671"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-crm-border rounded-md text-xs text-crm-text placeholder-crm-textMuted font-mono focus:outline-none focus:border-crm-accent focus:ring-1 focus:ring-crm-accent transition-colors"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-crm-textSecondary uppercase tracking-wider mb-1">
                  Access Token <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  required
                  placeholder="••••••••••••••••••••••••••••••••"
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-crm-border rounded-md text-xs text-crm-text placeholder-crm-textMuted font-mono focus:outline-none focus:border-crm-accent focus:ring-1 focus:ring-crm-accent transition-colors"
                />
                <div className="mt-1 flex items-center gap-1.5 text-[10px] text-crm-textMuted">
                  <ShieldCheck className="w-3.5 h-3.5 text-crm-accent flex-shrink-0" />
                  <span>Stored encrypted. Never shown again after saving.</span>
                </div>
              </div>

              <div className="pt-3 border-t border-crm-border flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsConnectModalOpen(false);
                    setConnectError(null);
                    setConnectWarning(null);
                  }}
                  className="px-3 py-1.5 rounded-md border border-crm-border text-xs font-medium text-crm-textSecondary hover:text-crm-text hover:bg-crm-elevated transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={connectLoading}
                  className="px-4 py-1.5 rounded-md bg-crm-accent hover:bg-crm-accentHover text-xs font-medium text-white transition-colors shadow-sm disabled:opacity-60 flex items-center gap-1.5"
                >
                  {connectLoading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Connecting...</span>
                    </>
                  ) : (
                    <span>Save & Connect</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Replace Token Modal */}
      {replaceTargetChannel && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4 select-none">
          <div className="bg-crm-surface border border-crm-border rounded-xl shadow-lg w-full max-w-md p-6 relative">
            <div className="flex items-center justify-between pb-4 border-b border-crm-border">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-md bg-crm-accentSubtle border border-crm-accentBorder flex items-center justify-center text-crm-accent">
                  <KeyRound className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-heading font-semibold text-crm-text">
                    {replaceTargetChannel.status.toLowerCase() === "disconnected"
                      ? "Reconnect Channel"
                      : "Replace Access Token"}
                  </h2>
                  <p className="text-[11px] font-mono text-crm-textSecondary mt-0.5">
                    {replaceTargetChannel.phoneNumber || "Channel"}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setReplaceTargetChannel(null);
                  setReplaceError(null);
                  setReplaceWarning(null);
                }}
                className="text-crm-textMuted hover:text-crm-text p-1 rounded transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {replaceError && (
              <div className="mt-4 p-2.5 rounded-md bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                <span>{replaceError}</span>
              </div>
            )}

            {replaceWarning && (
              <div className="mt-4 p-2.5 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <p className="font-medium text-amber-900">Token updated (unverified)</p>
                  <p className="text-amber-700">{replaceWarning}</p>
                </div>
              </div>
            )}

            <form onSubmit={handleReplaceTokenSubmit} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-[11px] font-medium text-crm-textSecondary uppercase tracking-wider mb-1">
                  Access Token <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  required
                  autoFocus
                  placeholder="••••••••••••••••••••••••••••••••"
                  value={newToken}
                  onChange={(e) => setNewToken(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-crm-border rounded-md text-xs text-crm-text placeholder-crm-textMuted font-mono focus:outline-none focus:border-crm-accent focus:ring-1 focus:ring-crm-accent transition-colors"
                />
                <div className="mt-1 flex items-center gap-1.5 text-[10px] text-crm-textMuted">
                  <ShieldCheck className="w-3.5 h-3.5 text-crm-accent flex-shrink-0" />
                  <span>Stored encrypted. Never shown again after saving.</span>
                </div>
              </div>

              <div className="pt-3 border-t border-crm-border flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setReplaceTargetChannel(null);
                    setReplaceError(null);
                    setReplaceWarning(null);
                  }}
                  className="px-3 py-1.5 rounded-md border border-crm-border text-xs font-medium text-crm-textSecondary hover:text-crm-text hover:bg-crm-elevated transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={replaceLoading}
                  className="px-4 py-1.5 rounded-md bg-crm-accent hover:bg-crm-accentHover text-xs font-medium text-white transition-colors shadow-sm disabled:opacity-60 flex items-center gap-1.5"
                >
                  {replaceLoading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Updating...</span>
                    </>
                  ) : (
                    <span>{replaceTargetChannel.status.toLowerCase() === "disconnected" ? "Reconnect" : "Update Token"}</span>
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
