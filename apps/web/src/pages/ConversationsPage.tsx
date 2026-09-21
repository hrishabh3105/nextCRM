import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { api, ApiError } from "../lib/api";
import {
  MessageSquare,
  Search,
  Send,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  Loader2,
  Phone,
  User,
} from "lucide-react";

export interface Conversation {
  id: string;
  contactId: string;
  channelId: string;
  lastInboundAt?: string | null;
  windowExpiresAt?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  contactId: string;
  direction: "inbound" | "outbound" | string;
  providerMessageId?: string | null;
  body: string;
  status: string;
  createdAt: string;
}

export interface Contact {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
}

function formatRelativeTime(dateStr?: string | null): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  } catch {
    return dateStr;
  }
}

function formatWindowRemaining(expiresAtStr?: string | null): string {
  if (!expiresAtStr) return "Closed";
  try {
    const expiresAt = new Date(expiresAtStr);
    const now = new Date();
    const diffMs = expiresAt.getTime() - now.getTime();
    if (diffMs <= 0) return "Closed";
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `${hours}h ${mins}m left`;
    return `${mins}m left`;
  } catch {
    return "Closed";
  }
}

function formatMessageTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return dateStr;
  }
}

function isWindowOpen(windowExpiresAt?: string | null): boolean {
  if (!windowExpiresAt) return false;
  return new Date(windowExpiresAt).getTime() > Date.now();
}

export const ConversationsPage: React.FC = () => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Search filter
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Selected conversation & messages
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState<boolean>(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  // Reply state
  const [replyText, setReplyText] = useState<string>("");
  const [sendLoading, setSendLoading] = useState<boolean>(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Fetch conversations list
  const fetchConversations = useCallback(async (isManual = false) => {
    if (isManual) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const [convData, contactData] = await Promise.all([
        api.get<Conversation[]>("/api/v1/conversations"),
        api.get<Contact[]>("/api/v1/contacts"),
      ]);
      setConversations(convData);
      setContacts(contactData);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to load conversations.");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Fetch messages for a specific conversation
  const fetchMessages = useCallback(async (conversationId: string) => {
    setMessagesLoading(true);
    setMessagesError(null);
    setSendError(null);

    try {
      const data = await api.get<Message[]>(`/api/v1/conversations/${conversationId}/messages`);
      setMessages(data);
    } catch (err) {
      if (err instanceof ApiError) {
        setMessagesError(err.message);
      } else if (err instanceof Error) {
        setMessagesError(err.message);
      } else {
        setMessagesError("Failed to load messages.");
      }
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  // When selection changes, load messages
  useEffect(() => {
    if (selectedId) {
      fetchMessages(selectedId);
    } else {
      setMessages([]);
    }
  }, [selectedId, fetchMessages]);

  // Contact lookup map
  const contactMap = useMemo(() => {
    const map = new Map<string, Contact>();
    for (const c of contacts) {
      map.set(c.id, c);
    }
    return map;
  }, [contacts]);

  // Sort and filter conversations
  const filteredConversations = useMemo(() => {
    const sorted = [...conversations].sort((a, b) => {
      const timeA = new Date(a.lastInboundAt || a.updatedAt || a.createdAt).getTime();
      const timeB = new Date(b.lastInboundAt || b.updatedAt || b.createdAt).getTime();
      return timeB - timeA;
    });

    if (!searchQuery.trim()) {
      return sorted;
    }

    const q = searchQuery.toLowerCase();
    return sorted.filter((conv) => {
      const contact = contactMap.get(conv.contactId);
      const nameMatch = contact?.name?.toLowerCase().includes(q);
      const phoneMatch = contact?.phone?.toLowerCase().includes(q);
      return nameMatch || phoneMatch;
    });
  }, [conversations, contactMap, searchQuery]);

  // Find currently selected conversation
  const selectedConversation = useMemo(() => {
    if (!selectedId) return null;
    return conversations.find((c) => c.id === selectedId) || null;
  }, [conversations, selectedId]);

  const selectedContact = useMemo(() => {
    if (!selectedConversation) return null;
    return contactMap.get(selectedConversation.contactId);
  }, [selectedConversation, contactMap]);

  const windowActive = selectedConversation ? isWindowOpen(selectedConversation.windowExpiresAt) : false;

  // Handle Send Reply
  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedConversation) return;

    // Strict client-side check to prevent submit if closed
    if (!windowActive) {
      setSendError(
        "Cannot send a free-form message: the 24-hour conversation window is closed. Free-form replies aren't allowed — the customer needs to message first to reopen it."
      );
      return;
    }

    const text = replyText.trim();
    if (!text) return;

    setSendLoading(true);
    setSendError(null);

    try {
      const createdMessage = await api.post<Message>(
        `/api/v1/conversations/${selectedConversation.id}/messages`,
        { body: text }
      );

      // Append new message immediately
      setMessages((prev) => [...prev, createdMessage]);
      setReplyText("");

      // Update conversation in list to reflect latest activity
      fetchConversations(false);
    } catch (err) {
      if (err instanceof ApiError) {
        setSendError(err.message);
      } else if (err instanceof Error) {
        setSendError(err.message);
      } else {
        setSendError("Failed to send message.");
      }
    } finally {
      setSendLoading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-heading font-semibold text-crm-text tracking-tight">
              Conversations
            </h1>
            <span className="px-2 py-0.5 rounded text-[11px] font-mono text-crm-textSecondary bg-crm-elevated border border-crm-border font-medium">
              {conversations.length} {conversations.length === 1 ? "thread" : "threads"}
            </span>
          </div>
          <p className="text-xs text-crm-textSecondary mt-0.5">
            Real-time two-way WhatsApp messaging and customer support inbox.
          </p>
        </div>

        <button
          onClick={() => fetchConversations(true)}
          disabled={loading || refreshing}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-crm-surface hover:bg-crm-elevated border border-crm-border text-xs font-medium text-crm-text transition-colors disabled:opacity-50 shadow-sm self-start sm:self-auto"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 text-crm-accent ${refreshing ? "animate-spin" : ""}`}
          />
          <span>{refreshing ? "Refreshing..." : "Refresh"}</span>
        </button>
      </div>

      {/* Global Page Error Banner */}
      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2.5 text-xs text-red-700">
          <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Two-Panel Inbox Container */}
      <div className="bg-crm-surface border border-crm-border rounded-xl shadow-sm overflow-hidden flex h-[calc(100vh-13.5rem)] min-h-[540px]">
        {/* ========================================================= */}
        {/* LEFT PANEL: Conversation Threads List                     */}
        {/* ========================================================= */}
        <div className="w-80 sm:w-96 flex-shrink-0 border-r border-crm-border flex flex-col bg-crm-surface">
          {/* Search bar */}
          <div className="p-3.5 border-b border-crm-border bg-white">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-crm-textMuted" />
              <input
                type="text"
                placeholder="Search contact or phone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-crm-bg border border-crm-border rounded-md text-xs text-crm-text placeholder-crm-textMuted focus:outline-none focus:border-crm-accent focus:ring-1 focus:ring-crm-accent transition-colors"
              />
            </div>
          </div>

          {/* Conversations List */}
          <div className="flex-1 overflow-y-auto divide-y divide-crm-border">
            {loading ? (
              <div className="py-20 flex flex-col items-center justify-center text-center">
                <Loader2 className="w-5 h-5 text-crm-accent animate-spin mb-2" />
                <p className="text-xs font-mono text-crm-textSecondary uppercase tracking-wider">
                  Loading conversations...
                </p>
              </div>
            ) : conversations.length === 0 ? (
              <div className="py-16 px-4 flex flex-col items-center justify-center text-center">
                <div className="w-10 h-10 rounded-xl bg-crm-elevated border border-crm-border flex items-center justify-center mb-2.5">
                  <MessageSquare className="w-5 h-5 text-crm-textSecondary" />
                </div>
                <h3 className="text-xs font-heading font-semibold text-crm-text">
                  No conversations yet
                </h3>
                <p className="text-[11px] text-crm-textSecondary mt-1 max-w-[200px] leading-relaxed">
                  They&apos;ll appear here once a customer messages you.
                </p>
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="p-6 text-center text-xs text-crm-textSecondary">
                No matching conversations found.
              </div>
            ) : (
              filteredConversations.map((conv) => {
                const contact = contactMap.get(conv.contactId);
                const isSelected = conv.id === selectedId;
                const open = isWindowOpen(conv.windowExpiresAt);
                const timeStr = formatRelativeTime(conv.lastInboundAt || conv.updatedAt || conv.createdAt);

                return (
                  <button
                    key={conv.id}
                    onClick={() => setSelectedId(conv.id)}
                    className={`w-full text-left p-3.5 transition-colors flex items-start gap-3 relative ${
                      isSelected
                        ? "bg-crm-elevated/70 border-l-[3px] border-l-crm-accent"
                        : "hover:bg-crm-subtle/40 border-l-[3px] border-l-transparent"
                    }`}
                  >
                    {/* Contact Avatar Circle */}
                    <div className="w-8 h-8 rounded-full bg-crm-accentSubtle border border-crm-accentBorder flex items-center justify-center text-crm-accent flex-shrink-0 font-heading font-semibold text-xs mt-0.5">
                      {contact?.name ? contact.name.charAt(0).toUpperCase() : <User className="w-3.5 h-3.5" />}
                    </div>

                    {/* Metadata */}
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-semibold text-crm-text truncate">
                          {contact?.name || contact?.phone || "Customer"}
                        </span>
                        <span className="text-[10px] font-mono text-crm-textMuted flex-shrink-0">
                          {timeStr}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-mono text-crm-textSecondary truncate">
                          {contact?.phone || "No phone"}
                        </span>

                        {/* 24-Hour Window Indicator */}
                        <div className="flex items-center gap-1.5 flex-shrink-0" title={open ? "24h Window Open" : "24h Window Closed"}>
                          <span
                            className={`w-2 h-2 rounded-full ${
                              open ? "bg-crm-success" : "bg-crm-textMuted/60"
                            }`}
                          />
                          <span className="text-[10px] font-mono text-crm-textMuted">
                            {open ? "Open" : "Closed"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* ========================================================= */}
        {/* RIGHT PANEL: Message Thread & Reply Box                   */}
        {/* ========================================================= */}
        <div className="flex-1 flex flex-col bg-crm-bg/30 min-w-0">
          {selectedConversation ? (
            <>
              {/* Thread Header */}
              <div className="p-3.5 px-5 border-b border-crm-border bg-white flex items-center justify-between gap-4 flex-shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-crm-accentSubtle border border-crm-accentBorder flex items-center justify-center text-crm-accent font-semibold text-xs font-heading flex-shrink-0">
                    {selectedContact?.name
                      ? selectedContact.name.charAt(0).toUpperCase()
                      : <User className="w-4 h-4" />}
                  </div>

                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-crm-text font-heading truncate">
                      {selectedContact?.name || selectedContact?.phone || "Customer"}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] font-mono text-crm-textSecondary mt-0.5">
                      <span className="flex items-center gap-1">
                        <Phone className="w-3 h-3 text-crm-accent" />
                        <span>{selectedContact?.phone || "No phone number"}</span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* 24-Hour Window Indicator Badge */}
                <div className="flex-shrink-0">
                  {windowActive ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono font-medium bg-crm-successBg text-crm-success border border-crm-successBorder">
                      <span className="w-1.5 h-1.5 rounded-full bg-crm-success" />
                      <span>
                        Window Open ({formatWindowRemaining(selectedConversation.windowExpiresAt)})
                      </span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono font-medium bg-crm-elevated text-crm-textSecondary border border-crm-border">
                      <span className="w-1.5 h-1.5 rounded-full bg-crm-textMuted" />
                      <span>24h Window Closed</span>
                    </span>
                  )}
                </div>
              </div>

              {/* Thread Messages Body */}
              <div className="flex-1 overflow-y-auto p-5 space-y-3">
                {messagesLoading ? (
                  <div className="py-20 flex flex-col items-center justify-center text-center">
                    <Loader2 className="w-5 h-5 text-crm-accent animate-spin mb-2" />
                    <p className="text-xs font-mono text-crm-textSecondary uppercase tracking-wider">
                      Loading messages...
                    </p>
                  </div>
                ) : messagesError ? (
                  <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                    <span>{messagesError}</span>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="py-16 text-center text-xs text-crm-textSecondary">
                    No messages in this conversation yet.
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isInbound = msg.direction.toLowerCase() === "inbound";

                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${isInbound ? "items-start" : "items-end"}`}
                      >
                        {/* Bubble */}
                        <div
                          className={`px-4 py-2.5 rounded-2xl text-xs leading-relaxed max-w-[80%] break-words shadow-xs ${
                            isInbound
                              ? "bg-white text-crm-text border border-crm-border rounded-tl-xs"
                              : "bg-crm-accent text-white rounded-tr-xs"
                          }`}
                        >
                          <p className="whitespace-pre-wrap font-sans">{msg.body}</p>
                        </div>

                        {/* Timestamp & Meta */}
                        <div className="flex items-center gap-1.5 mt-1 px-1 text-[10px] font-mono text-crm-textMuted">
                          <span>{isInbound ? selectedContact?.name || "Customer" : "You"}</span>
                          <span>•</span>
                          <span>{formatMessageTime(msg.createdAt)}</span>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Thread Reply Area */}
              <div className="p-4 border-t border-crm-border bg-white flex-shrink-0 space-y-2">
                {/* Send Error Alert */}
                {sendError && (
                  <div className="p-2.5 rounded-md bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                    <span>{sendError}</span>
                  </div>
                )}

                {/* Closed Window Warning Banner */}
                {!windowActive ? (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-amber-900">
                        24-Hour Conversation Window Closed
                      </p>
                      <p className="mt-0.5 text-amber-700 leading-relaxed">
                        This conversation&apos;s 24-hour window has closed. Free-form replies aren&apos;t allowed — the customer needs to message first to reopen it.
                      </p>
                    </div>
                  </div>
                ) : null}

                {/* Input form */}
                <form onSubmit={handleSendReply} className="flex items-center gap-2">
                  <input
                    type="text"
                    disabled={!windowActive || sendLoading}
                    placeholder={
                      windowActive
                        ? "Type a reply to this customer..."
                        : "Replies disabled: window is closed"
                    }
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    className="flex-1 px-3.5 py-2 bg-crm-bg border border-crm-border rounded-lg text-xs text-crm-text placeholder-crm-textMuted focus:outline-none focus:border-crm-accent focus:ring-1 focus:ring-crm-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-sans"
                  />

                  <button
                    type="submit"
                    disabled={!windowActive || sendLoading || !replyText.trim()}
                    className="px-4 py-2 rounded-lg bg-crm-accent hover:bg-crm-accentHover text-xs font-medium text-white transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 flex-shrink-0"
                  >
                    {sendLoading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5" />
                    )}
                    <span>Send</span>
                  </button>
                </form>
              </div>
            </>
          ) : (
            /* Empty state when no conversation is selected */
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-crm-bg/20">
              <div className="w-12 h-12 rounded-xl bg-crm-elevated border border-crm-border flex items-center justify-center mb-3">
                <MessageSquare className="w-6 h-6 text-crm-textSecondary" />
              </div>
              <h3 className="text-sm font-heading font-semibold text-crm-text">
                Select a conversation to view messages
              </h3>
              <p className="text-xs text-crm-textSecondary mt-1 max-w-sm">
                Choose a customer thread from the left panel to review past messages or send a real-time reply.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
