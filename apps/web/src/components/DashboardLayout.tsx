import React from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import {
  Users,
  Radio,
  FileText,
  Megaphone,
  BarChart3,
  LogOut,
  LayoutDashboard,
  ShieldCheck,
  MessageSquare,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";

interface NavItem {
  name: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  soon?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { name: "Overview", to: "/dashboard", icon: LayoutDashboard },
  { name: "Conversations", to: "/conversations", icon: MessageSquare },
  { name: "Contacts", to: "/contacts", icon: Users },
  { name: "Channels", to: "/channels", icon: Radio },
  { name: "Templates", to: "/templates", icon: FileText },
  { name: "Campaigns", to: "/campaigns", icon: Megaphone },
  { name: "Usage", to: "/usage", icon: BarChart3 },
];

export const DashboardLayout: React.FC = () => {
  const { user, workspace, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-crm-bg text-crm-text">
      {/* Left Navigation Shell */}
      <aside className="w-64 flex-shrink-0 flex flex-col bg-crm-surface border-r border-crm-border select-none">
        {/* Workspace Brand / Header */}
        <div className="p-4 border-b border-crm-border flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-md bg-crm-accentSubtle border border-crm-accentBorder flex items-center justify-center text-crm-accent font-semibold text-xs font-heading shadow-sm">
              {workspace?.name ? workspace.name.charAt(0).toUpperCase() : "N"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-crm-text truncate font-heading">
                {workspace?.name || "NextCRM Workspace"}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-crm-success animate-pulse" />
                <span className="text-[10px] font-mono text-crm-textSecondary uppercase tracking-wider">
                  {workspace?.role || "Active"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 px-2.5 py-3 space-y-1 overflow-y-auto">
          <div className="px-2 pb-2 text-[10px] font-mono uppercase tracking-wider text-crm-textSecondary">
            Navigation
          </div>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.to;

            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `group flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all duration-150 relative ${
                    isActive
                      ? "bg-crm-accent text-white shadow-sm"
                      : "text-crm-textSecondary hover:text-crm-text hover:bg-crm-elevated border border-transparent"
                  }`
                }
              >
                <Icon
                  className={`w-4 h-4 transition-colors ${
                    isActive
                      ? "text-white"
                      : "text-crm-textSecondary group-hover:text-crm-text"
                  }`}
                />
                <span className="truncate">{item.name}</span>
                {item.soon && (
                  <span
                    className={`ml-auto text-[9px] font-mono px-1 py-0.5 rounded border ${
                      isActive
                        ? "border-white/20 text-white/80 bg-white/10"
                        : "border-crm-border text-crm-textMuted"
                    }`}
                  >
                    soon
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* User / Session Footer */}
        <div className="p-3 border-t border-crm-border bg-crm-surface flex flex-col gap-2">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-6 h-6 rounded-full bg-crm-accentSubtle border border-crm-accentBorder flex items-center justify-center text-[10px] font-mono text-crm-accent">
                <ShieldCheck className="w-3.5 h-3.5 text-crm-accent" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-crm-text truncate max-w-[120px]">
                  {user?.email || "Authenticated"}
                </div>
                <div className="text-[9px] font-mono text-crm-textSecondary truncate">
                  httpOnly session
                </div>
              </div>
            </div>

            <button
              onClick={handleLogout}
              title="Log out"
              className="p-1.5 rounded text-crm-textSecondary hover:text-red-600 hover:bg-red-50 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Workspace Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-crm-bg">
        {/* Top Minimal Bar */}
        <header className="h-12 border-b border-crm-border px-6 flex items-center justify-between flex-shrink-0 bg-crm-surface">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-crm-textSecondary">Workspace</span>
            <span className="text-crm-borderStrong">/</span>
            <span className="text-crm-text font-medium font-heading">{workspace?.name}</span>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded border border-crm-border bg-crm-elevated text-[11px] font-mono text-crm-textSecondary">
              <span className="w-1.5 h-1.5 rounded-full bg-crm-success" />
              <span>v1.0-alpha</span>
            </div>
          </div>
        </header>

        {/* Page Content Container */}
        <div className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
};
