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
  ShieldCheck,
  RefreshCw,
  AlertTriangle,
  HelpCircle,
} from "lucide-react";

export interface StoreConnection {
  id: string;
  workspaceId: string;
  shopDomain: string;
  status: "connected" | "pending" | string;
  createdAt: string;
  updatedAt: string;
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

export const StoresPage: React.FC = () => {
  const [stores, setStores] = useState<StoreConnection[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Connect Store Modal State
  const [isConnectModalOpen, setIsConnectModalOpen] = useState<boolean>(false);
  const [shopDomain, setShopDomain] = useState<string>("");
  const [accessToken, setAccessToken] = useState<string>("");
  const [apiSecretKey, setApiSecretKey] = useState<string>("");
  const [connectLoading, setConnectLoading] = useState<boolean>(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectWarning, setConnectWarning] = useState<string | null>(null);

  // Reconnect Store Modal State
  const [storeToReconnect, setStoreToReconnect] = useState<StoreConnection | null>(null);
  const [reconnectAccessToken, setReconnectAccessToken] = useState<string>("");
  const [reconnectApiSecretKey, setReconnectApiSecretKey] = useState<string>("");
  const [reconnectLoading, setReconnectLoading] = useState<boolean>(false);
  const [reconnectError, setReconnectError] = useState<string | null>(null);

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
    setShopDomain("");
    setAccessToken("");
    setApiSecretKey("");
    setConnectError(null);
    setConnectWarning(null);
    setIsConnectModalOpen(true);
  };

  // Submit Connect Store
  const handleConnectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedDomain = shopDomain.trim().toLowerCase();
    const trimmedToken = accessToken.trim();
    const trimmedSecret = apiSecretKey.trim();

    if (!trimmedDomain || !trimmedToken || !trimmedSecret) {
      setConnectError("All fields are required to connect your Shopify store.");
      return;
    }

    if (!/^[a-z0-9-]+\.myshopify\.com$/.test(trimmedDomain)) {
      setConnectError("Shop domain must be a valid myshopify.com domain (e.g. your-store.myshopify.com).");
      return;
    }

    setConnectLoading(true);
    setConnectError(null);
    setConnectWarning(null);

    try {
      const newStore = await api.post<StoreConnection>("/api/v1/stores", {
        shopDomain: trimmedDomain,
        accessToken: trimmedToken,
        apiSecretKey: trimmedSecret,
      });

      setStores((prev) => [newStore, ...prev.filter((s) => s.id !== newStore.id)]);

      if (newStore.verificationWarning) {
        setConnectWarning(newStore.verificationWarning);
      } else {
        setSuccessMessage(`Shopify store "${trimmedDomain}" connected and webhooks registered.`);
        setIsConnectModalOpen(false);
      }
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

  // Open Reconnect Modal
  const handleOpenReconnectModal = (store: StoreConnection) => {
    setStoreToReconnect(store);
    setReconnectAccessToken("");
    setReconnectApiSecretKey("");
    setReconnectError(null);
  };

  // Submit Reconnect Store
  const handleReconnectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeToReconnect) return;

    setReconnectLoading(true);
    setReconnectError(null);

    try {
      const payload: { accessToken?: string; apiSecretKey?: string } = {};
      if (reconnectAccessToken.trim()) {
        payload.accessToken = reconnectAccessToken.trim();
      }
      if (reconnectApiSecretKey.trim()) {
        payload.apiSecretKey = reconnectApiSecretKey.trim();
      }

      const updated = await api.patch<StoreConnection>(
        `/api/v1/stores/${storeToReconnect.id}/reconnect`,
        payload
      );

      setStores((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));

      if (updated.verificationWarning) {
        setSuccessMessage(`Store reconnected with warning: ${updated.verificationWarning}`);
      } else {
        setSuccessMessage(`Shopify store "${storeToReconnect.shopDomain}" reconnected and webhooks refreshed.`);
      }

      setStoreToReconnect(null);
    } catch (err) {
      if (err instanceof ApiError) {
        setReconnectError(err.message);
      } else if (err instanceof Error) {
        setReconnectError(err.message);
      } else {
        setReconnectError("Failed to reconnect store.");
      }
    } finally {
      setReconnectLoading(false);
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
    <div className="p-8 max-w-7xl mx-auto space-y-6">
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
              No stores connected — connect your Shopify store to start tracking orders and abandoned carts.
            </h3>
            <p className="text-xs text-crm-textSecondary mt-1 max-w-md">
              Connect your Shopify custom app using your *.myshopify.com domain and Admin API credentials to automatically sync orders and abandoned checkouts.
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
            {filteredStores.map((store) => (
              <div
                key={store.id}
                className="p-5 hover:bg-crm-subtle/30 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
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

                <div className="flex flex-col sm:items-end gap-1 flex-shrink-0">
                  <button
                    onClick={() => handleOpenReconnectModal(store)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-crm-surface hover:bg-crm-elevated border border-crm-border text-xs font-medium text-crm-text shadow-sm transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-crm-accent" />
                    <span>Reconnect</span>
                  </button>
                  <span className="text-[10px] text-crm-textMuted">
                    Refresh webhooks / credentials
                  </span>
                </div>
              </div>
            ))}
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

            {connectWarning && (
              <div className="mt-4 p-2.5 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <span>{connectWarning}</span>
              </div>
            )}

            <form onSubmit={handleConnectSubmit} className="mt-4 space-y-4">
              {/* Shop Domain */}
              <div>
                <label className="block text-[11px] font-medium text-crm-textSecondary uppercase tracking-wider mb-1">
                  Shop Domain <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. your-store.myshopify.com"
                  value={shopDomain}
                  onChange={(e) => setShopDomain(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-crm-border rounded-md text-xs text-crm-text placeholder-crm-textMuted font-mono focus:outline-none focus:border-crm-accent focus:ring-1 focus:ring-crm-accent transition-colors"
                />
                <p className="mt-1 text-[11px] text-crm-textMuted flex items-center gap-1">
                  <HelpCircle className="w-3 h-3 text-crm-textSecondary" />
                  <span>Must be your primary myshopify.com domain (e.g. your-store.myshopify.com).</span>
                </p>
              </div>

              {/* Admin API Access Token */}
              <div>
                <label className="block text-[11px] font-medium text-crm-textSecondary uppercase tracking-wider mb-1">
                  Admin API Access Token <span className="text-red-500">*</span>
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

              {/* API Secret Key */}
              <div>
                <label className="block text-[11px] font-medium text-crm-textSecondary uppercase tracking-wider mb-1">
                  API Secret Key <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  required
                  placeholder="••••••••••••••••••••••••••••••••"
                  value={apiSecretKey}
                  onChange={(e) => setApiSecretKey(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-crm-border rounded-md text-xs text-crm-text placeholder-crm-textMuted font-mono focus:outline-none focus:border-crm-accent focus:ring-1 focus:ring-crm-accent transition-colors"
                />
                <div className="mt-1 flex items-center gap-1.5 text-[10px] text-crm-textMuted">
                  <ShieldCheck className="w-3.5 h-3.5 text-crm-accent flex-shrink-0" />
                  <span>Stored encrypted. Never shown again after saving.</span>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-crm-elevated/40 border border-crm-border text-xs text-crm-textSecondary">
                <p>
                  Connecting will automatically register webhook listeners for orders (<code className="font-mono text-crm-text">orders/create</code>, <code className="font-mono text-crm-text">orders/updated</code>) and checkouts (<code className="font-mono text-crm-text">checkouts/create</code>, <code className="font-mono text-crm-text">checkouts/update</code>).
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

      {/* Reconnect Shopify Store Modal */}
      {storeToReconnect && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4 select-none">
          <div className="bg-crm-surface border border-crm-border rounded-xl shadow-lg w-full max-w-lg p-6 relative">
            <div className="flex items-center justify-between pb-4 border-b border-crm-border">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-md bg-crm-accentSubtle border border-crm-accentBorder flex items-center justify-center text-crm-accent">
                  <RefreshCw className="w-4 h-4" />
                </div>
                <h2 className="text-sm font-heading font-semibold text-crm-text">
                  Reconnect Shopify Store
                </h2>
              </div>
              <button
                onClick={() => setStoreToReconnect(null)}
                className="text-crm-textMuted hover:text-crm-text p-1 rounded transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {reconnectError && (
              <div className="mt-4 p-2.5 rounded-md bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                <span>{reconnectError}</span>
              </div>
            )}

            {/* Explanatory note per prompt requirement */}
            <div className="mt-4 p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-800 space-y-1">
              <p className="font-semibold">Reconnect &amp; Refresh Webhooks</p>
              <p>
                Use this if your server&apos;s address has changed, or to update your Shopify credentials. Both credential fields below are optional — leave them blank to keep using your existing stored credentials.
              </p>
            </div>

            <form onSubmit={handleReconnectSubmit} className="mt-4 space-y-4">
              {/* Shop Domain (Read only) */}
              <div>
                <label className="block text-[11px] font-medium text-crm-textSecondary uppercase tracking-wider mb-1">
                  Shop Domain
                </label>
                <input
                  type="text"
                  disabled
                  value={storeToReconnect.shopDomain}
                  className="w-full px-3 py-2 bg-crm-elevated border border-crm-border rounded-md text-xs text-crm-textSecondary font-mono cursor-not-allowed select-none"
                />
              </div>

              {/* Optional New Admin API Access Token */}
              <div>
                <label className="block text-[11px] font-medium text-crm-textSecondary uppercase tracking-wider mb-1">
                  New Admin API Access Token <span className="text-crm-textMuted font-normal lowercase">(optional)</span>
                </label>
                <input
                  type="password"
                  placeholder="Leave blank to keep existing token"
                  value={reconnectAccessToken}
                  onChange={(e) => setReconnectAccessToken(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-crm-border rounded-md text-xs text-crm-text placeholder-crm-textMuted font-mono focus:outline-none focus:border-crm-accent focus:ring-1 focus:ring-crm-accent transition-colors"
                />
                <div className="mt-1 flex items-center gap-1.5 text-[10px] text-crm-textMuted">
                  <ShieldCheck className="w-3.5 h-3.5 text-crm-accent flex-shrink-0" />
                  <span>Stored encrypted. Never shown again after saving.</span>
                </div>
              </div>

              {/* Optional New API Secret Key */}
              <div>
                <label className="block text-[11px] font-medium text-crm-textSecondary uppercase tracking-wider mb-1">
                  New API Secret Key <span className="text-crm-textMuted font-normal lowercase">(optional)</span>
                </label>
                <input
                  type="password"
                  placeholder="Leave blank to keep existing secret"
                  value={reconnectApiSecretKey}
                  onChange={(e) => setReconnectApiSecretKey(e.target.value)}
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
                  onClick={() => setStoreToReconnect(null)}
                  className="px-3 py-1.5 rounded-md border border-crm-border text-xs font-medium text-crm-textSecondary hover:text-crm-text hover:bg-crm-elevated transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={reconnectLoading}
                  className="px-4 py-1.5 rounded-md bg-crm-accent hover:bg-crm-accentHover text-xs font-medium text-white transition-colors shadow-sm disabled:opacity-60 flex items-center gap-1.5"
                >
                  {reconnectLoading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Reconnecting...</span>
                    </>
                  ) : (
                    <span>Reconnect &amp; Refresh</span>
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
