import React from "react";
import { useLocation } from "react-router-dom";
import { Clock } from "lucide-react";

export const PlaceholderPage: React.FC<{ title: string }> = ({ title }) => {
  const location = useLocation();

  return (
    <div className="max-w-4xl mx-auto py-12 flex flex-col items-center justify-center text-center">
      <div className="w-10 h-10 rounded-xl bg-crm-surface border border-crm-border flex items-center justify-center mb-3 shadow-sm">
        <Clock className="w-5 h-5 text-crm-accent" />
      </div>
      <h2 className="text-base font-heading font-semibold text-crm-text">{title} Module</h2>
      <p className="text-xs text-crm-textSecondary mt-1 max-w-sm">
        Route <span className="font-mono text-crm-accent font-medium">{location.pathname}</span> is scaffolded and ready for implementation.
      </p>
    </div>
  );
};
