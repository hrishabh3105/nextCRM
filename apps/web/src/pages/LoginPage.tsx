import React, { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ApiError } from "../lib/api";
import { ShieldCheck, ArrowRight, AlertCircle } from "lucide-react";

export const LoginPage: React.FC = () => {
  const { login, signup, isAuthenticated, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // If already authenticated, redirect to destination or dashboard
  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      const from = (location.state as { from?: { pathname?: string } })?.from?.pathname || "/dashboard";
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, authLoading, navigate, location]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      if (isSignUp) {
        if (!workspaceName.trim()) {
          setError("Workspace name is required");
          setSubmitting(false);
          return;
        }
        await signup(email.trim(), password, workspaceName.trim());
      } else {
        await login(email.trim(), password);
      }

      const from = (location.state as { from?: { pathname?: string } })?.from?.pathname || "/dashboard";
      navigate(from, { replace: true });
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Authentication failed. Please check your credentials.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-screen bg-crm-bg flex flex-col justify-center items-center px-4 py-8 relative overflow-hidden select-none">
      {/* Subtle background ambient tint */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-crm-accent/5 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-[380px] z-10">
        {/* Brand Header */}
        <div className="flex flex-col items-center mb-6 text-center">
          <div className="w-10 h-10 rounded-xl bg-crm-surface border border-crm-borderStrong flex items-center justify-center shadow-sm mb-3">
            <span className="text-crm-accent font-bold text-base font-mono">N</span>
          </div>
          <h1 className="text-xl font-heading font-semibold tracking-tight text-crm-text">
            NextCRM
          </h1>
          <p className="text-xs text-crm-textSecondary mt-1">
            {isSignUp
              ? "Create a new organization workspace"
              : "Sign in to your organization workspace"}
          </p>
        </div>

        {/* Auth Card */}
        <div className="bg-crm-surface border border-crm-border rounded-xl p-6 shadow-sm">
          {/* Mode Switcher Tabs */}
          <div className="grid grid-cols-2 gap-1 p-1 bg-crm-elevated rounded-lg mb-5 border border-crm-border">
            <button
              type="button"
              onClick={() => {
                setIsSignUp(false);
                setError(null);
              }}
              className={`py-1.5 text-xs font-medium rounded-md transition-all ${
                !isSignUp
                  ? "bg-crm-surface text-crm-text shadow-sm border border-crm-border"
                  : "text-crm-textSecondary hover:text-crm-text"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setIsSignUp(true);
                setError(null);
              }}
              className={`py-1.5 text-xs font-medium rounded-md transition-all ${
                isSignUp
                  ? "bg-crm-surface text-crm-text shadow-sm border border-crm-border"
                  : "text-crm-textSecondary hover:text-crm-text"
              }`}
            >
              Create Account
            </button>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-4 p-2.5 rounded-md bg-red-50 border border-red-200 flex items-start gap-2 text-red-700 text-xs">
              <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-3.5">
            {isSignUp && (
              <div>
                <label className="block text-[11px] font-medium text-crm-textSecondary uppercase tracking-wider mb-1.5">
                  Workspace Name
                </label>
                <input
                  type="text"
                  required
                  autoFocus={isSignUp}
                  placeholder="Acme Messaging"
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-crm-border rounded-md text-xs text-crm-text placeholder-crm-textMuted focus:outline-none focus:border-crm-accent focus:ring-1 focus:ring-crm-accent transition-colors"
                />
              </div>
            )}

            <div>
              <label className="block text-[11px] font-medium text-crm-textSecondary uppercase tracking-wider mb-1.5">
                Work Email
              </label>
              <input
                type="email"
                required
                autoFocus={!isSignUp}
                placeholder="name@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-crm-border rounded-md text-xs text-crm-text placeholder-crm-textMuted focus:outline-none focus:border-crm-accent focus:ring-1 focus:ring-crm-accent transition-colors"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-crm-textSecondary uppercase tracking-wider mb-1.5">
                Password
              </label>
              <input
                type="password"
                required
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-crm-border rounded-md text-xs text-crm-text placeholder-crm-textMuted focus:outline-none focus:border-crm-accent focus:ring-1 focus:ring-crm-accent transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full mt-2 py-2 px-4 rounded-md bg-crm-accent hover:bg-crm-accentHover disabled:opacity-60 text-white text-xs font-medium flex items-center justify-center gap-2 transition-all shadow-sm active:scale-[0.99]"
            >
              {submitting ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>{isSignUp ? "Creating workspace..." : "Signing in..."}</span>
                </>
              ) : (
                <>
                  <span>{isSignUp ? "Create Workspace & Continue" : "Sign In"}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </form>

          {/* Security badge footer */}
          <div className="mt-5 pt-4 border-t border-crm-border flex items-center justify-center gap-1.5 text-[10px] text-crm-textSecondary font-mono">
            <ShieldCheck className="w-3.5 h-3.5 text-crm-accent" />
            <span>Secure httpOnly session authentication</span>
          </div>
        </div>
      </div>
    </div>
  );
};
