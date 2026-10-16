import React, { useState, useEffect, useCallback, useMemo } from "react";
import { api, ApiError } from "../lib/api";
import {
  ShoppingBag,
  Plus,
  Search,
  AlertCircle,
  CheckCircle2,
  Clock,
  X,
  Loader2,
  RefreshCw,
  AlertTriangle,
  HelpCircle,
  ShieldAlert,
} from "lucide-react";
import { StoreHealthPanel } from "../components/StoreHealthPanel";

export interface StoreConnection {
  id: string;
  workspaceId: string;
  shopDomain: string;
  authMode?: string;
  grantedScopes?: string | null;
  status: "connected" | "pending" | string;
  treatShopifySmsAsWhatsappConsent: boolean;
  consentAttestedAt?: string | null;
  consentAttestedByUserId?: string | null;
  createdAt: string;
  updatedAt: string;
  verificationWarning?: string;
}

export const SHOPIFY_DOMAIN_REGEX = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

/**
 * Normalizes user input for Shopify domain:
 * 1. Trims whitespace and lowercases it.
 * 2. Strips https://, http://, and any trailing slash, path, or query params.
 * 3. Accepts a bare name (e.g. "nexcrm-test") and appends ".myshopify.com".
 */
export function normalizeShopDomain(raw: string): string {
  let domain = raw.trim().toLowerCase();
  domain = domain.replace(/^https?:\/\//, "");
  domain = domain.split("/")[0].split("?")[0].split("#")[0].trim();
  if (domain && !domain.includes(".")) {
    domain = `${domain}.myshopify.com`;
  }
  return domain;
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

export const StoresPage: React.FC = () => {
  const [stores, setStores] = useState<StoreConnection[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Connect Store Modal State
  const [isConnectModalOpen, setIsConnectModalOpen] = useState<boolean>(false);
  const [shopDomainInput, setShopDomainInput] = useState<string>("");
  const [connectLoading, setConnectLoading] = useState<boolean>(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  // In-flight operation states
  const [reconnectingId, setReconnectingId] = useState<string | null>(null);
  const [updatingConsentId, setUpdatingConsentId] = useState<string | null>(null);

  // Consent Confirmation Modal State (required when turning ON)
  const [confirmConsentStore, setConfirmConsentStore] = useState<StoreConnection | null>(null);
  const [confirmWordingChecked, setConfirmWordingChecked] = useState<boolean>(false);
  const [confirmModalError, setConfirmModalError] = useState<string | null>(null);

  // Fetch stores list
  const fetchStores = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<StoreConnection[]>("/api/v1/stores");
      setStores(data);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to load stores.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStores();
  }, [fetchStores]);

  // Open Connect Modal
  const handleOpenConnectModal = () => {
    setShopDomainInput("");
    setConnectError(null);
    setIsConnectModalOpen(true);
  };

  // Submit Connect Store
  const handleConnectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setConnectError(null);

    const normalizedDomain = normalizeShopDomain(shopDomainInput);

    if (!normalizedDomain) {
      setConnectError("Shopify store domain is required.");
      return;
    }

    if (!SHOPIFY_DOMAIN_REGEX.test(normalizedDomain)) {
      setConnectError(
        "Please enter a valid Shopify domain matching [store-name].myshopify.com (e.g. nexcrm-test or nexcrm-test.myshopify.com)."
      );
      return;
    }

    setConnectLoading(true);

    try {
      const newStore = await api.post<StoreConnection>("/api/v1/stores", {
        shopDomain: normalizedDomain,
      });

      setStores((prev) => [newStore, ...prev.filter((s) => s.id !== newStore.id)]);

      if (newStore.verificationWarning) {
        setSuccessMessage(`Store "${normalizedDomain}" connected with warning: ${newStore.verificationWarning}`);
      } else {
        setSuccessMessage(`Shopify store "${normalizedDomain}" connected successfully.`);
      }
      setIsConnectModalOpen(false);
    } catch (err) {
      if (err instanceof ApiError) {
        setConnectError(err.message);
      } else if (err instanceof Error) {
        setConnectError(err.message);
      } else {
        setConnectError("Failed to connect Shopify store.");
      }
    } finally {
      setConnectLoading(false);
    }
  };

  // Reconnect Store
  const handleReconnect = async (store: StoreConnection) => {
    setReconnectingId(store.id);
    setError(null);
    setSuccessMessage(null);

    try {
      const updated = await api.patch<StoreConnection>(`/api/v1/stores/${store.id}/reconnect`);

      setStores((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));

      if (updated.verificationWarning) {
        setSuccessMessage(`Store "${store.shopDomain}" reconnected with warning: ${updated.verificationWarning}`);
      } else {
        setSuccessMessage(`Shopify store "${store.shopDomain}" reconnected and webhooks refreshed.`);
      }
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
          ? err.message
          : "Failed to reconnect store.";
      setError(`Reconnect failed for "${store.shopDomain}": ${msg}`);
    } finally {
      setReconnectingId(null);
    }
  };

  // Toggle Marketing Consent
  const handleToggleConsent = async (store: StoreConnection) => {
    const isCurrentlyOn = store.treatShopifySmsAsWhatsappConsent ?? true;

    if (isCurrentlyOn) {
      // Turning OFF requires no confirmation
      setUpdatingConsentId(store.id);
      setError(null);
      try {
        const updated = await api.patch<StoreConnection>(
          `/api/v1/stores/${store.id}/consent-settings`,
          {
            treatShopifySmsAsWhatsappConsent: false,
          }
        );
        setStores((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
        setSuccessMessage(
          `Updated consent setting for "${store.shopDomain}": Shopify SMS consent will NOT be treated as WhatsApp consent.`
        );
      } catch (err) {
        const msg =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
            ? err.message
            : "Failed to update consent settings.";
        setError(msg);
      } finally {
        setUpdatingConsentId(null);
      }
    } else {
      // Turning ON requires explicit merchant confirmation of checkout/sign-up wording
      setConfirmConsentStore(store);
      setConfirmWordingChecked(false);
      setConfirmModalError(null);
    }
  };

  // Confirm turning consent setting ON
  const handleConfirmConsentEnable = async () => {
    if (!confirmConsentStore) return;

    if (!confirmWordingChecked) {
      setConfirmModalError(
        "You must explicitly confirm that your checkout or sign-up wording discloses WhatsApp marketing to customers."
      );
      return;
    }

    setUpdatingConsentId(confirmConsentStore.id);
    setConfirmModalError(null);

    try {
      const updated = await api.patch<StoreConnection>(
        `/api/v1/stores/${confirmConsentStore.id}/consent-settings`,
        {
          treatShopifySmsAsWhatsappConsent: true,
          confirmWording: true,
        }
      );

      setStores((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      setSuccessMessage(
        `Updated consent setting for "${confirmConsentStore.shopDomain}": Shopify SMS marketing consent is now treated as WhatsApp consent.`
      );
      setConfirmConsentStore(null);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
          ? err.message
          : "Failed to update consent settings.";
      setConfirmModalError(msg);
    } finally {
      setUpdatingConsentId(null);
    }
  };

  // Status Badge Rendering
  const renderStatusBadge = (status: string) => {
    const s = status.toLowerCase();
    if (s === "connected") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-crm-successBg text-crm-success border border-crm-successBorder">
          <span className="w-1.5 h-1.5 rounded-full bg-crm-success" />
          <span>Connected</span>
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-amber-50 text-amber-700 border border-amber-200">
        <Clock className="w-3 h-3 text-amber-600" />
        <span className="capitalize">{status}</span>
      </span>
    );
  };

  // Filtered stores
  const filteredStores = useMemo(() => {
    if (!searchQuery.trim()) return stores;
    const q = searchQuery.toLowerCase().trim();
    return stores.filter((s) => s.shopDomain.toLowerCase().includes(q));
  }, [stores, searchQuery]);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-heading font-semibold text-crm-text flex items-center gap-2.5">
            <ShoppingBag className="w-5 h-5 text-crm-accent" />
            <span>Shopify Stores</span>
          </h1>
          <p className="text-xs text-crm-textSecondary mt-1">
            Connect and manage your Shopify stores for automated abandoned checkout recovery and order notifications.
          </p>
        </div>

        <button
          onClick={handleOpenConnectModal}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-crm-accent hover:bg-crm-accentHover text-xs font-medium text-white shadow-sm transition-colors self-start sm:self-auto"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Connect store</span>
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

      {/* Stores Container */}
      <div className="bg-crm-surface border border-crm-border rounded-xl shadow-sm overflow-hidden">
        {/* Search Bar */}
        <div className="p-4 border-b border-crm-border flex items-center justify-between gap-3 bg-white">
          <div className="relative flex-1 max-w-md">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-crm-textMuted" />
            <input
              type="text"
              placeholder="Search stores by shop domain..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-crm-bg border border-crm-border rounded-md text-xs text-crm-text placeholder-crm-textMuted focus:outline-none focus:border-crm-accent focus:ring-1 focus:ring-crm-accent transition-colors"
            />
          </div>
          <div className="text-xs font-mono text-crm-textSecondary">
            {filteredStores.length} {filteredStores.length === 1 ? "store" : "stores"}
          </div>
        </div>

        {/* Content Body */}
        {loading ? (
          <div className="py-16 flex flex-col items-center justify-center text-center">
            <Loader2 className="w-6 h-6 text-crm-accent animate-spin mb-2" />
            <p className="text-xs font-mono text-crm-textSecondary uppercase tracking-wider">
              Loading stores...
            </p>
          </div>
        ) : stores.length === 0 ? (
          <div className="py-16 px-4 flex flex-col items-center justify-center text-center">
            <div className="w-12 h-12 rounded-xl bg-crm-elevated border border-crm-border flex items-center justify-center mb-3 text-crm-textSecondary">
              <ShoppingBag className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-heading font-semibold text-crm-text">
              No stores connected — connect your Shopify store to start tracking orders and abandoned checkouts.
            </h3>
            <p className="text-xs text-crm-textSecondary mt-1 max-w-md">
              Connect your store using its myshopify.com domain to automatically sync orders and abandoned carts.
            </p>
            <button
              onClick={handleOpenConnectModal}
              className="mt-4 px-3.5 py-1.5 rounded-md bg-crm-accent hover:bg-crm-accentHover text-xs font-medium text-white transition-colors shadow-sm"
            >
              Connect store
            </button>
          </div>
        ) : filteredStores.length === 0 ? (
          <div className="py-12 px-4 text-center">
            <p className="text-xs text-crm-textSecondary">
              No stores match your search query.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-crm-border">
            {filteredStores.map((store) => {
              const smsConsentOn = store.treatShopifySmsAsWhatsappConsent ?? true;
              const isUpdatingThisConsent = updatingConsentId === store.id;
              const isReconnectingThis = reconnectingId === store.id;

              return (
                <div
                  key={store.id}
                  className="p-5 hover:bg-crm-subtle/30 transition-colors space-y-4"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className="text-sm font-mono font-semibold text-crm-text flex items-center gap-1.5">
                          <ShoppingBag className="w-4 h-4 text-crm-accent" />
                          <span>{store.shopDomain}</span>
                        </span>
                        {renderStatusBadge(store.status)}
                      </div>

                      <div className="flex items-center gap-4 text-[11px] font-mono text-crm-textSecondary flex-wrap">
                        <span>Connected: {formatDate(store.createdAt)}</span>
                      </div>

                      {store.verificationWarning && (
                        <div className="mt-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                          <span>{store.verificationWarning}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => handleReconnect(store)}
                        disabled={isReconnectingThis}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-crm-surface hover:bg-crm-elevated border border-crm-border text-xs font-medium text-crm-text shadow-sm transition-colors disabled:opacity-60"
                      >
                        {isReconnectingThis ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 text-crm-accent animate-spin" />
                            <span>Reconnecting...</span>
                          </>
                        ) : (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 text-crm-accent" />
                            <span>Reconnect</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Marketing Consent Setting */}
                  <div className="p-3.5 rounded-lg bg-crm-bg border border-crm-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1 pr-4">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-crm-text">
                          Treat Shopify SMS marketing consent as WhatsApp consent
                        </span>
                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                            smsConsentOn
                              ? "bg-crm-successBg text-crm-success border border-crm-successBorder font-semibold"
                              : "bg-gray-100 text-gray-600 border border-gray-200"
                          }`}
                        >
                          {smsConsentOn ? "ON (DEFAULT)" : "OFF"}
                        </span>
                      </div>
                      <p className="text-[11px] text-crm-textSecondary leading-relaxed">
                        When ON, customers who agreed to SMS marketing in Shopify can receive WhatsApp promotional messages, and the merchant is responsible for the wording they show customers.
                      </p>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {isUpdatingThisConsent && (
                        <Loader2 className="w-3.5 h-3.5 text-crm-accent animate-spin" />
                      )}
                      <button
                        type="button"
                        role="switch"
                        aria-checked={smsConsentOn}
                        disabled={isUpdatingThisConsent}
                        onClick={() => handleToggleConsent(store)}
                        className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-crm-accent focus:ring-offset-1 ${
                          smsConsentOn ? "bg-crm-accent" : "bg-crm-border"
                        } ${isUpdatingThisConsent ? "opacity-50 cursor-not-allowed" : ""}`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            smsConsentOn ? "translate-x-4" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </div>
                  </div>

                  {/* Store Health & Diagnostics Panel */}
                  <StoreHealthPanel storeId={store.id} shopDomain={store.shopDomain} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Connect Shopify Store Modal */}
      {isConnectModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4 select-none">
          <div className="bg-crm-surface border border-crm-border rounded-xl shadow-lg w-full max-w-lg p-6 relative">
            <div className="flex items-center justify-between pb-4 border-b border-crm-border">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-md bg-crm-accentSubtle border border-crm-accentBorder flex items-center justify-center text-crm-accent">
                  <ShoppingBag className="w-4 h-4" />
                </div>
                <h2 className="text-sm font-heading font-semibold text-crm-text">
                  Connect Shopify Store
                </h2>
              </div>
              <button
                onClick={() => setIsConnectModalOpen(false)}
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

            <form onSubmit={handleConnectSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-[11px] font-medium text-crm-textSecondary uppercase tracking-wider mb-1">
                  Shopify store domain <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. nexcrm-test or nexcrm-test.myshopify.com"
                  value={shopDomainInput}
                  onChange={(e) => setShopDomainInput(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-crm-border rounded-md text-xs text-crm-text placeholder-crm-textMuted font-mono focus:outline-none focus:border-crm-accent focus:ring-1 focus:ring-crm-accent transition-colors"
                />
                <p className="mt-1.5 text-[11px] text-crm-textMuted flex items-start gap-1.5">
                  <HelpCircle className="w-3.5 h-3.5 text-crm-textSecondary flex-shrink-0 mt-0.5" />
                  <span>
                    The nextCRM app must be installed on this store first. Then enter your store&apos;s .myshopify.com address.
                  </span>
                </p>
              </div>

              <div className="pt-3 border-t border-crm-border flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsConnectModalOpen(false)}
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
                    <span>Connect Store</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Modal: Treat Shopify SMS as WhatsApp Consent */}
      {confirmConsentStore && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4 select-none">
          <div className="bg-crm-surface border border-crm-border rounded-xl shadow-lg w-full max-w-lg p-6 relative">
            <div className="flex items-center justify-between pb-4 border-b border-crm-border">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-md bg-amber-100 border border-amber-300 flex items-center justify-center text-amber-700">
                  <ShieldAlert className="w-4 h-4" />
                </div>
                <h2 className="text-sm font-heading font-semibold text-crm-text">
                  Confirm Marketing Consent Disclosure
                </h2>
              </div>
              <button
                onClick={() => setConfirmConsentStore(null)}
                className="text-crm-textMuted hover:text-crm-text p-1 rounded transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {confirmModalError && (
              <div className="mt-4 p-2.5 rounded-md bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                <span>{confirmModalError}</span>
              </div>
            )}

            <div className="mt-4 space-y-3 text-xs text-crm-textSecondary leading-relaxed">
              <p>
                You are enabling nextCRM to treat customers who opted into SMS marketing in Shopify as consented to receive WhatsApp promotional messages for store:{" "}
                <span className="font-mono font-semibold text-crm-text">{confirmConsentStore.shopDomain}</span>.
              </p>
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 space-y-1.5">
                <p className="font-semibold text-amber-950">Merchant Compliance Responsibility</p>
                <p>
                  As the merchant, you are strictly responsible for ensuring that your checkout and sign-up wording clearly and conspicuously informs customers that they may receive marketing communications via WhatsApp.
                </p>
              </div>

              <label className="flex items-start gap-2.5 p-3 rounded-lg bg-crm-bg border border-crm-border cursor-pointer hover:bg-crm-elevated transition-colors mt-2">
                <input
                  type="checkbox"
                  checked={confirmWordingChecked}
                  onChange={(e) => setConfirmWordingChecked(e.target.checked)}
                  className="mt-0.5 rounded border-crm-border text-crm-accent focus:ring-crm-accent"
                />
                <span className="text-xs font-medium text-crm-text select-none">
                  I confirm that our store&apos;s checkout and sign-up wording explicitly informs customers they may receive marketing messages via WhatsApp.
                </span>
              </label>
            </div>

            <div className="mt-5 pt-3 border-t border-crm-border flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmConsentStore(null)}
                className="px-3 py-1.5 rounded-md border border-crm-border text-xs font-medium text-crm-textSecondary hover:text-crm-text hover:bg-crm-elevated transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!confirmWordingChecked || updatingConsentId === confirmConsentStore.id}
                onClick={handleConfirmConsentEnable}
                className="px-4 py-1.5 rounded-md bg-crm-accent hover:bg-crm-accentHover text-xs font-medium text-white transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {updatingConsentId === confirmConsentStore.id ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Enabling...</span>
                  </>
                ) : (
                  <span>Confirm &amp; Enable</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
