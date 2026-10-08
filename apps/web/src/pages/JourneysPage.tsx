import React, { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "../lib/api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import {
  FriendlyStep,
  flattenToEngineSteps,
  reconcileVariableMapping,
  VariableMappingEntry,
} from "../lib/journeyStepBuilder";
import {
  GitBranch,
  Plus,
  Play,
  Pause,
  Clock,
  AlertCircle,
  CheckCircle2,
  X,
  Loader2,
  Trash2,
  Sparkles,
  Search,
} from "lucide-react";

export interface JourneyVersion {
  id: string;
  journeyId: string;
  versionNumber: number;
  steps: any[];
  createdAt: string;
}

export interface Journey {
  id: string;
  workspaceId: string;
  name: string;
  triggerEvent: string;
  status: "active" | "paused" | "draft" | string;
  currentVersionId?: string | null;
  createdAt: string;
  updatedAt: string;
  versions?: JourneyVersion[];
}

export interface Template {
  id: string;
  providerName: string;
  status: string;
  category: string;
  language: string;
  channelId: string;
  bodyPreview?: string;
  placeholders?: string[];
  positionalPlaceholders?: string[];
}

export interface Channel {
  id: string;
  type: string;
  provider: string;
  phoneNumber?: string | null;
  phoneNumberId?: string | null;
  status: string;
}

export const TRIGGER_OPTIONS = [
  { value: "cart_abandoned", label: "When a cart is abandoned" },
  { value: "order_placed_cod", label: "When a COD order is placed" },
  { value: "order_status_changed", label: "When an order's status changes" },
  { value: "order_delivered", label: "When an order is delivered" },
];

export const TRIGGER_LABELS: Record<string, string> = {
  cart_abandoned: "When a cart is abandoned",
  order_placed_cod: "When a COD order is placed",
  order_status_changed: "When an order's status changes",
  order_delivered: "When an order is delivered",
};

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

function getStepCount(journey: Journey): number {
  if (!journey.versions || journey.versions.length === 0) return 0;
  const targetVersion = journey.currentVersionId
    ? journey.versions.find((v) => v.id === journey.currentVersionId) || journey.versions[0]
    : journey.versions[0];
  return Array.isArray(targetVersion?.steps) ? targetVersion.steps.length : 0;
}

function getTemplatePlaceholders(template?: Template): string[] {
  if (!template) return [];
  const list =
    Array.isArray(template.positionalPlaceholders) && template.positionalPlaceholders.length > 0
      ? template.positionalPlaceholders
      : Array.isArray(template.placeholders)
      ? template.placeholders
      : [];
  return Array.from(new Set(list));
}

function journeyNeedsVariableMapping(journey: Journey, templates: Template[]): boolean {
  if (!journey.versions || journey.versions.length === 0) return false;
  const targetVersion = journey.currentVersionId
    ? journey.versions.find((v) => v.id === journey.currentVersionId) || journey.versions[0]
    : journey.versions[0];
  if (!targetVersion || !Array.isArray(targetVersion.steps)) return false;

  for (const step of targetVersion.steps) {
    if (step?.type === "send_message" || step?.kind === "send_message") {
      const tpl = templates.find((t) => t.id === step.templateId);
      if (!tpl) continue;
      const placeholders = getTemplatePlaceholders(tpl);
      if (placeholders.length === 0) continue;
      const mapping = step.variableMapping || {};
      for (const p of placeholders) {
        const entry = mapping[p];
        if (!entry) return true;
        if (entry.source === "contact_field" && !entry.field) return true;
        if (entry.source === "contact_attribute" && !entry.key?.trim()) return true;
        if (
          entry.source === "fixed" &&
          (entry.value === undefined || entry.value === null || entry.value.trim() === "")
        )
          return true;
      }
    }
  }
  return false;
}

/**
 * Validates a tree of FriendlyStep objects before submission.
 */
function validateFriendlySteps(steps: FriendlyStep[], templates?: Template[]): string | null {
  if (steps.length === 0) {
    return "Journey must have at least one step.";
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.kind === "wait") {
      if (!step.amount || step.amount <= 0) {
        return `Step ${i + 1} (Wait) must have a duration greater than 0.`;
      }
    } else if (step.kind === "send_message") {
      if (!step.templateId) {
        return `Step ${i + 1} (Send a message) requires an approved template to be selected.`;
      }
      if (!step.channelId) {
        return `Step ${i + 1} (Send a message) requires a connected channel to be selected.`;
      }
      if (templates) {
        const tpl = templates.find((t) => t.id === step.templateId);
        if (tpl) {
          const placeholders = getTemplatePlaceholders(tpl);
          const mapping = step.variableMapping || {};
          for (const p of placeholders) {
            const entry = mapping[p];
            if (!entry) {
              return `Step ${i + 1} (Send a message) is missing variable mapping for placeholder '{{${p}}}'.`;
            }
            if (entry.source === "contact_field" && !entry.field) {
              return `Step ${i + 1}: Select a contact field for placeholder '{{${p}}}'.`;
            }
            if (entry.source === "contact_attribute" && !entry.key?.trim()) {
              return `Step ${i + 1}: Provide an attribute key for placeholder '{{${p}}}'.`;
            }
            if (
              entry.source === "fixed" &&
              (entry.value === undefined || entry.value === null || entry.value.trim() === "")
            ) {
              return `Step ${i + 1}: Provide a fixed value for placeholder '{{${p}}}'.`;
            }
          }
        }
      }
    } else if (
      step.kind === "check_order_placed" ||
      step.kind === "check_customer_replied_confirm" ||
      step.kind === "check_customer_replied_decline"
    ) {
      if (step.ifYes.length > 0) {
        const err = validateFriendlySteps(step.ifYes, templates);
        if (err) return `In Step ${i + 1} (If Yes branch): ${err}`;
      }
      if (step.ifNo.length > 0) {
        const err = validateFriendlySteps(step.ifNo, templates);
        if (err) return `In Step ${i + 1} (If No branch): ${err}`;
      }
    }
  }

  return null;
}

// ============================================================================
// RECURSIVE STEP LIST EDITOR COMPONENT
// ============================================================================

interface StepListEditorProps {
  steps: FriendlyStep[];
  onChange: (steps: FriendlyStep[]) => void;
  templates: Template[];
  channels: Channel[];
  depth?: number;
}

const StepListEditor: React.FC<StepListEditorProps> = ({
  steps,
  onChange,
  templates,
  channels,
  depth = 0,
}) => {
  const [addingKind, setAddingKind] = useState<string>("wait");

  const updateStep = (index: number, updated: FriendlyStep) => {
    const next = [...steps];
    next[index] = updated;
    onChange(next);
  };

  const removeStep = (index: number) => {
    const next = steps.filter((_, i) => i !== index);
    onChange(next);
  };

  const handleAddStep = () => {
    let newStep: FriendlyStep;
    if (addingKind === "wait") {
      newStep = { kind: "wait", amount: depth === 0 ? 2 : 1, unit: "hours" };
    } else if (addingKind === "send_message") {
      const defaultTemplate = templates[0];
      const defaultPlaceholders = getTemplatePlaceholders(defaultTemplate);
      const initialMapping = reconcileVariableMapping({}, defaultPlaceholders);
      newStep = {
        kind: "send_message",
        templateId: defaultTemplate?.id || "",
        channelId: channels[0]?.id || "",
        variableMapping: initialMapping,
      };
    } else if (
      addingKind === "check_order_placed" ||
      addingKind === "check_customer_replied_confirm" ||
      addingKind === "check_customer_replied_decline"
    ) {
      newStep = {
        kind: addingKind,
        ifYes: [],
        ifNo: [],
      };
    } else {
      newStep = { kind: "wait", amount: 1, unit: "hours" };
    }
    onChange([...steps, newStep]);
  };

  return (
    <div className="space-y-3">
      {steps.map((step, index) => {
        return (
          <div
            key={index}
            className={`border rounded-lg p-3 bg-crm-surface transition-all ${
              step.kind === "wait"
                ? "border-amber-200/80 bg-amber-50/20"
                : step.kind === "send_message"
                ? "border-blue-200/80 bg-blue-50/20"
                : "border-purple-200/80 bg-purple-50/20"
            }`}
          >
            {/* Step Header */}
            <div className="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-crm-border/60">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="w-5 h-5 rounded-full bg-crm-accentSubtle text-crm-accent text-[11px] font-mono font-bold flex items-center justify-center">
                  {index + 1}
                </span>
                <span className="text-xs font-semibold text-crm-text">
                  {step.kind === "wait" && "Wait Duration"}
                  {step.kind === "send_message" && "Send WhatsApp Message"}
                  {step.kind === "check_order_placed" && "Check If Ordered"}
                  {step.kind === "check_customer_replied_confirm" && "Check If Customer Replied YES"}
                  {step.kind === "check_customer_replied_decline" && "Check If Customer Replied NO"}
                </span>
                {step.kind === "send_message" && (() => {
                  const tpl = templates.find((t) => t.id === step.templateId);
                  if (!tpl) return null;
                  const placeholders = getTemplatePlaceholders(tpl);
                  if (placeholders.length === 0) return null;
                  const mapping = step.variableMapping || {};
                  const isMissing = placeholders.some((p) => {
                    const entry = mapping[p];
                    if (!entry) return true;
                    if (entry.source === "contact_field" && !entry.field) return true;
                    if (entry.source === "contact_attribute" && !entry.key?.trim()) return true;
                    if (
                      entry.source === "fixed" &&
                      (entry.value === undefined || entry.value === null || entry.value.trim() === "")
                    )
                      return true;
                    return false;
                  });
                  return isMissing ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-800 border border-amber-300">
                      <AlertCircle className="w-3 h-3 text-amber-600 shrink-0" />
                      Needs variable mapping
                    </span>
                  ) : null;
                })()}
              </div>
              <button
                type="button"
                onClick={() => removeStep(index)}
                className="text-crm-textSecondary hover:text-red-600 transition-colors p-1"
                title="Remove step"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Step Body */}
            {step.kind === "wait" && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-start gap-2.5">
                  <div className="flex-1 min-w-[120px]">
                    <label className="block text-[11px] font-medium text-crm-textSecondary mb-1 whitespace-nowrap">
                      Duration Amount
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={step.amount}
                      onChange={(e) =>
                        updateStep(index, {
                          ...step,
                          amount: Math.max(1, parseInt(e.target.value, 10) || 1),
                        })
                      }
                      className="w-full px-2.5 py-1.5 text-xs bg-crm-surface border border-crm-border rounded focus:outline-none focus:border-crm-accent"
                    />
                  </div>
                  <div className="flex-1 min-w-[120px]">
                    <label className="block text-[11px] font-medium text-crm-textSecondary mb-1 whitespace-nowrap">
                      Time Unit
                    </label>
                    <select
                      value={step.unit}
                      onChange={(e) =>
                        updateStep(index, {
                          ...step,
                          unit: e.target.value as "minutes" | "hours" | "days",
                        })
                      }
                      className="w-full px-2.5 py-1.5 text-xs bg-crm-surface border border-crm-border rounded focus:outline-none focus:border-crm-accent"
                    >
                      <option value="minutes">Minutes</option>
                      <option value="hours">Hours</option>
                      <option value="days">Days</option>
                    </select>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-amber-800 bg-amber-50 px-2 py-1 rounded border border-amber-200/60 font-mono">
                  <Clock className="w-3 h-3 text-amber-600 shrink-0" />
                  <span>
                    Pauses for {step.amount} {step.unit} before executing subsequent steps.
                  </span>
                </div>
              </div>
            )}

            {step.kind === "send_message" && (() => {
              const selectedTemplate = templates.find((tpl) => tpl.id === step.templateId);
              const placeholders = getTemplatePlaceholders(selectedTemplate);
              const mapping = step.variableMapping || {};

              return (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-medium text-crm-textSecondary mb-1">
                        Approved WhatsApp Template
                      </label>
                      {templates.length === 0 ? (
                        <p className="text-[11px] text-red-600 italic">
                          No approved templates found.
                        </p>
                      ) : (
                        <select
                          value={step.templateId}
                          onChange={(e) => {
                            const nextTemplateId = e.target.value;
                            const nextTemplate = templates.find((t) => t.id === nextTemplateId);
                            const nextPlaceholders = getTemplatePlaceholders(nextTemplate);
                            const updatedMapping = reconcileVariableMapping(step.variableMapping, nextPlaceholders);
                            updateStep(index, {
                              ...step,
                              templateId: nextTemplateId,
                              variableMapping: updatedMapping,
                            });
                          }}
                          className="w-full px-2.5 py-1.5 text-xs bg-crm-surface border border-crm-border rounded focus:outline-none focus:border-crm-accent"
                        >
                          <option value="">Select a template...</option>
                          {templates.map((tpl) => (
                            <option key={tpl.id} value={tpl.id}>
                              {tpl.providerName} ({tpl.language.toUpperCase()})
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-crm-textSecondary mb-1">
                        Connected WhatsApp Channel
                      </label>
                      {channels.length === 0 ? (
                        <p className="text-[11px] text-red-600 italic">
                          No connected channels found.
                        </p>
                      ) : (
                        <select
                          value={step.channelId}
                          onChange={(e) =>
                            updateStep(index, {
                              ...step,
                              channelId: e.target.value,
                            })
                          }
                          className="w-full px-2.5 py-1.5 text-xs bg-crm-surface border border-crm-border rounded focus:outline-none focus:border-crm-accent"
                        >
                          <option value="">Select a channel...</option>
                          {channels.map((chn) => (
                            <option key={chn.id} value={chn.id}>
                              {chn.phoneNumber || chn.id} ({chn.provider})
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>

                  {/* Template Variable Mapping Section */}
                  {selectedTemplate && (
                    <div className="pt-2 border-t border-crm-border/60 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-crm-textSecondary flex items-center gap-1.5">
                          <span>Template Variable Mapping</span>
                          {placeholders.length > 0 && (
                            <span className="font-mono text-[10px] bg-crm-subtle px-1.5 py-0.5 rounded border border-crm-border">
                              {placeholders.length}
                            </span>
                          )}
                        </span>
                        {placeholders.length === 0 && (
                          <span className="text-[11px] text-crm-textMuted italic">
                            This template has no placeholders.
                          </span>
                        )}
                      </div>

                      {placeholders.length > 0 && (
                        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                          {placeholders.map((placeholder) => {
                            const entry: VariableMappingEntry = mapping[placeholder] || {
                              source: "contact_field",
                              field: "name",
                            };

                            let inlineError: string | null = null;
                            if (!mapping[placeholder]) {
                              inlineError = "Variable is unmapped";
                            } else if (entry.source === "contact_field" && !entry.field) {
                              inlineError = "Select a contact field";
                            } else if (entry.source === "contact_attribute" && !entry.key?.trim()) {
                              inlineError = "Enter an attribute key";
                            } else if (
                              entry.source === "fixed" &&
                              (entry.value === undefined || entry.value === null || entry.value.trim() === "")
                            ) {
                              inlineError = "Enter a fixed value";
                            }

                            return (
                              <div
                                key={placeholder}
                                className={`p-2.5 bg-white border rounded-lg space-y-2 ${
                                  inlineError ? "border-amber-300 bg-amber-50/20" : "border-crm-border"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-1.5">
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold bg-crm-accentSubtle text-crm-accent border border-crm-accentBorder">
                                      {"{{"}{placeholder}{"}}"}
                                    </span>
                                    {inlineError && (
                                      <span className="text-[10px] text-amber-700 font-medium flex items-center gap-1">
                                        <AlertCircle className="w-3 h-3 text-amber-600" />
                                        {inlineError}
                                      </span>
                                    )}
                                  </div>

                                  {/* Source Toggle */}
                                  <div className="inline-flex p-0.5 rounded-md bg-crm-subtle border border-crm-border text-xs">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const newMapping = {
                                          ...mapping,
                                          [placeholder]: {
                                            source: "contact_field" as const,
                                            field: entry.field || "name",
                                            fallback: entry.fallback || "",
                                          },
                                        };
                                        updateStep(index, { ...step, variableMapping: newMapping });
                                      }}
                                      className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                                        entry.source === "contact_field"
                                          ? "bg-crm-accent text-white shadow-xs font-semibold"
                                          : "text-crm-textSecondary hover:text-crm-text"
                                      }`}
                                    >
                                      Contact Field
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const newMapping = {
                                          ...mapping,
                                          [placeholder]: {
                                            source: "contact_attribute" as const,
                                            key: entry.key || "",
                                            fallback: entry.fallback || "",
                                          },
                                        };
                                        updateStep(index, { ...step, variableMapping: newMapping });
                                      }}
                                      className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                                        entry.source === "contact_attribute"
                                          ? "bg-crm-accent text-white shadow-xs font-semibold"
                                          : "text-crm-textSecondary hover:text-crm-text"
                                      }`}
                                    >
                                      Custom Attribute
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const newMapping = {
                                          ...mapping,
                                          [placeholder]: {
                                            source: "fixed" as const,
                                            value: entry.value || "",
                                          },
                                        };
                                        updateStep(index, { ...step, variableMapping: newMapping });
                                      }}
                                      className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                                        entry.source === "fixed"
                                          ? "bg-crm-accent text-white shadow-xs font-semibold"
                                          : "text-crm-textSecondary hover:text-crm-text"
                                      }`}
                                    >
                                      Fixed Text
                                    </button>
                                  </div>
                                </div>

                                {/* Inputs */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  {entry.source === "contact_field" && (
                                    <div>
                                      <label className="block text-[10px] font-medium text-crm-textSecondary mb-0.5">
                                        Field
                                      </label>
                                      <select
                                        value={entry.field || "name"}
                                        onChange={(e) => {
                                          const newMapping = {
                                            ...mapping,
                                            [placeholder]: {
                                              ...entry,
                                              field: e.target.value as "name" | "email" | "phone",
                                            },
                                          };
                                          updateStep(index, { ...step, variableMapping: newMapping });
                                        }}
                                        className="w-full px-2 py-1 bg-white border border-crm-border rounded text-xs font-mono text-crm-text focus:outline-none focus:border-crm-accent"
                                      >
                                        <option value="name">Contact Name (name)</option>
                                        <option value="phone">Phone Number (phone)</option>
                                        <option value="email">Email Address (email)</option>
                                      </select>
                                    </div>
                                  )}

                                  {entry.source === "contact_attribute" && (
                                    <div>
                                      <label className="block text-[10px] font-medium text-crm-textSecondary mb-0.5">
                                        Attribute Key
                                      </label>
                                      <input
                                        type="text"
                                        placeholder="e.g. city, vip_tier..."
                                        value={entry.key || ""}
                                        onChange={(e) => {
                                          const newMapping = {
                                            ...mapping,
                                            [placeholder]: {
                                              ...entry,
                                              key: e.target.value,
                                            },
                                          };
                                          updateStep(index, { ...step, variableMapping: newMapping });
                                        }}
                                        className="w-full px-2 py-1 bg-white border border-crm-border rounded text-xs font-mono text-crm-text placeholder-crm-textMuted focus:outline-none focus:border-crm-accent"
                                      />
                                    </div>
                                  )}

                                  {entry.source === "fixed" && (
                                    <div className="sm:col-span-2">
                                      <label className="block text-[10px] font-medium text-crm-textSecondary mb-0.5">
                                        Fixed Value
                                      </label>
                                      <input
                                        type="text"
                                        placeholder={`Fixed value for {{${placeholder}}}...`}
                                        value={entry.value || ""}
                                        onChange={(e) => {
                                          const newMapping = {
                                            ...mapping,
                                            [placeholder]: {
                                              ...entry,
                                              value: e.target.value,
                                            },
                                          };
                                          updateStep(index, { ...step, variableMapping: newMapping });
                                        }}
                                        className="w-full px-2 py-1 bg-white border border-crm-border rounded text-xs font-mono text-crm-text placeholder-crm-textMuted focus:outline-none focus:border-crm-accent"
                                      />
                                    </div>
                                  )}

                                  {(entry.source === "contact_field" || entry.source === "contact_attribute") && (
                                    <div>
                                      <label className="block text-[10px] font-medium text-crm-textSecondary mb-0.5">
                                        Optional Fallback <span className="text-crm-textMuted font-normal">(used if empty)</span>
                                      </label>
                                      <input
                                        type="text"
                                        placeholder='e.g. "there" or "Valued Customer"'
                                        value={entry.fallback || ""}
                                        onChange={(e) => {
                                          const newMapping = {
                                            ...mapping,
                                            [placeholder]: {
                                              ...entry,
                                              fallback: e.target.value,
                                            },
                                          };
                                          updateStep(index, { ...step, variableMapping: newMapping });
                                        }}
                                        className="w-full px-2 py-1 bg-white border border-crm-border rounded text-xs text-crm-text placeholder-crm-textMuted focus:outline-none focus:border-crm-accent"
                                      />
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {(step.kind === "check_order_placed" ||
              step.kind === "check_customer_replied_confirm" ||
              step.kind === "check_customer_replied_decline") && (
              <div className="space-y-3 pt-1">
                <p className="text-[11px] text-crm-textSecondary italic">
                  Condition evaluation: branches diverge based on whether the condition check is met.
                </p>

                <div
                  className={
                    depth === 0
                      ? "grid grid-cols-1 md:grid-cols-2 gap-3"
                      : "flex flex-col gap-3"
                  }
                >
                  {/* If Yes Branch */}
                  <div className="border border-emerald-200 bg-emerald-50/30 rounded-lg p-2.5">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800 mb-2 pb-1 border-b border-emerald-200/60">
                      <span className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-[10px]">
                        ✓
                      </span>
                      <span>If yes (Condition met):</span>
                    </div>

                    <StepListEditor
                      steps={step.ifYes}
                      onChange={(newYes) =>
                        updateStep(index, {
                          ...step,
                          ifYes: newYes,
                        })
                      }
                      templates={templates}
                      channels={channels}
                      depth={depth + 1}
                    />

                    {step.ifYes.length === 0 && (
                      <p className="text-[11px] text-crm-textMuted italic py-1">
                        Empty — run will exit cleanly if condition is met.
                      </p>
                    )}
                  </div>

                  {/* If No Branch */}
                  <div className="border border-rose-200 bg-rose-50/30 rounded-lg p-2.5">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-800 mb-2 pb-1 border-b border-rose-200/60">
                      <span className="w-4 h-4 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center text-[10px]">
                        ✕
                      </span>
                      <span>If no (Condition not met):</span>
                    </div>

                    <StepListEditor
                      steps={step.ifNo}
                      onChange={(newNo) =>
                        updateStep(index, {
                          ...step,
                          ifNo: newNo,
                        })
                      }
                      templates={templates}
                      channels={channels}
                      depth={depth + 1}
                    />

                    {step.ifNo.length === 0 && (
                      <p className="text-[11px] text-crm-textMuted italic py-1">
                        Empty — run will exit cleanly if condition is not met.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Add Step Control */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <select
          value={addingKind}
          onChange={(e) => setAddingKind(e.target.value)}
          className="px-2.5 py-1.5 text-xs bg-crm-surface border border-crm-border rounded focus:outline-none focus:border-crm-accent"
        >
          <option value="wait">Wait (Delay)</option>
          <option value="send_message">Send a message</option>
          {depth < 2 && (
            <>
              <option value="check_order_placed">Check if ordered</option>
              <option value="check_customer_replied_confirm">
                Check if customer replied yes
              </option>
              <option value="check_customer_replied_decline">
                Check if customer replied no
              </option>
            </>
          )}
        </select>

        <button
          type="button"
          onClick={handleAddStep}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-crm-accent bg-crm-accentSubtle border border-crm-accentBorder rounded hover:bg-crm-accentSubtle/80 transition-colors shadow-sm"
        >
          <Plus className="w-3.5 h-3.5" />
          Add step
        </button>
      </div>
    </div>
  );
};

// ============================================================================
// MAIN JOURNEYS PAGE
// ============================================================================

export const JourneysPage: React.FC = () => {
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Action status per journey (pause / activate)
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [confirmJourneyAction, setConfirmJourneyAction] = useState<{
    journey: Journey;
    action: "pause" | "activate";
  } | null>(null);
  const [confirmActionLoading, setConfirmActionLoading] = useState<boolean>(false);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [name, setName] = useState<string>("");
  const [triggerEvent, setTriggerEvent] = useState<string>("cart_abandoned");
  const [steps, setSteps] = useState<FriendlyStep[]>([
    { kind: "wait", amount: 2, unit: "hours" },
  ]);
  const [submitLoading, setSubmitLoading] = useState<boolean>(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Fetch all initial data
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [journeysRes, templatesRes, channelsRes] = await Promise.all([
        api.get<Journey[]>("/api/v1/journeys"),
        api.get<Template[]>("/api/v1/templates").catch(() => []),
        api.get<Channel[]>("/api/v1/channels").catch(() => []),
      ]);

      setJourneys(journeysRes || []);
      // Filter client-side: templates to status "approved", channels to "connected"
      setTemplates((templatesRes || []).filter((t) => t.status === "approved"));
      setChannels((channelsRes || []).filter((c) => c.status === "connected"));
    } catch (err: any) {
      setError(err?.message || "Failed to load journeys");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Handle Confirmed Journey Lifecycle Action (Pause or Activate)
  const handleExecuteJourneyAction = async () => {
    if (!confirmJourneyAction) return;
    const { journey, action } = confirmJourneyAction;

    setConfirmActionLoading(true);
    setActionLoading((prev) => ({ ...prev, [journey.id]: true }));
    setError(null);
    setSuccessMessage(null);

    try {
      if (action === "pause") {
        await api.post(`/api/v1/journeys/${journey.id}/pause`);
        setSuccessMessage(`Journey "${journey.name}" has been paused.`);
      } else {
        await api.post(`/api/v1/journeys/${journey.id}/activate`);
        setSuccessMessage(`Journey "${journey.name}" is now active.`);
      }
      setConfirmJourneyAction(null);
      await fetchData();
    } catch (err: any) {
      setError(err?.message || `Failed to ${action} journey`);
    } finally {
      setConfirmActionLoading(false);
      setActionLoading((prev) => ({ ...prev, [journey.id]: false }));
    }
  };

  // Handle Create Journey Submit
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);

    if (!name.trim()) {
      setModalError("Please provide a name for the journey.");
      return;
    }

    if (!triggerEvent) {
      setModalError("Please select an entry trigger event.");
      return;
    }

    const validationErr = validateFriendlySteps(steps, templates);
    if (validationErr) {
      setModalError(validationErr);
      return;
    }

    setSubmitLoading(true);
    try {
      // Flatten the human-friendly step tree into engine steps array
      const flatSteps = flattenToEngineSteps(steps);

      await api.post("/api/v1/journeys", {
        name: name.trim(),
        triggerEvent,
        steps: flatSteps,
      });

      setIsModalOpen(false);
      setName("");
      setTriggerEvent("cart_abandoned");
      setSteps([{ kind: "wait", amount: 2, unit: "hours" }]);
      setSuccessMessage(`Journey "${name.trim()}" created and activated.`);
      await fetchData();
    } catch (err: any) {
      setModalError(err?.message || "Failed to create journey");
    } finally {
      setSubmitLoading(false);
    }
  };

  // Filtered journeys for search
  const filteredJourneys = useMemo(() => {
    if (!searchQuery.trim()) return journeys;
    const query = searchQuery.toLowerCase().trim();
    return journeys.filter((j) => {
      const label = TRIGGER_LABELS[j.triggerEvent] || j.triggerEvent;
      return (
        j.name.toLowerCase().includes(query) ||
        label.toLowerCase().includes(query) ||
        j.status.toLowerCase().includes(query)
      );
    });
  }, [journeys, searchQuery]);

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold font-heading text-crm-text flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-crm-accent" />
            Automated Journeys
          </h1>
          <p className="text-xs text-crm-textSecondary mt-0.5">
            Automate customer follow-ups based on real-time store events and message replies.
          </p>
        </div>

        <button
          onClick={() => {
            setModalError(null);
            setIsModalOpen(true);
          }}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-crm-accent hover:bg-crm-accentHover rounded-md shadow-sm transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create Journey
        </button>
      </div>

      {/* Global Alerts */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-md flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-red-500 hover:text-red-700"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {successMessage && (
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-md flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
          <span>{successMessage}</span>
          <button
            onClick={() => setSuccessMessage(null)}
            className="ml-auto text-emerald-600 hover:text-emerald-800"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Search Bar */}
      {journeys.length > 0 && (
        <div className="mb-4 flex items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-crm-textSecondary" />
            <input
              type="text"
              placeholder="Search journeys by name or trigger..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-crm-surface border border-crm-border rounded-md text-crm-text focus:outline-none focus:border-crm-accent shadow-sm"
            />
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading ? (
        <div className="p-12 text-center text-crm-textSecondary flex flex-col items-center justify-center gap-2">
          <Loader2 className="w-6 h-6 animate-spin text-crm-accent" />
          <span className="text-xs">Loading journeys...</span>
        </div>
      ) : journeys.length === 0 ? (
        /* Empty State */
        <div className="bg-crm-surface border border-crm-border rounded-lg p-12 text-center max-w-xl mx-auto my-8 shadow-sm">
          <div className="w-12 h-12 rounded-full bg-crm-accentSubtle border border-crm-accentBorder text-crm-accent flex items-center justify-center mx-auto mb-3">
            <GitBranch className="w-6 h-6" />
          </div>
          <h2 className="text-sm font-semibold font-heading text-crm-text mb-1">
            No journeys yet — automate how you follow up with customers.
          </h2>
          <p className="text-xs text-crm-textSecondary max-w-md mx-auto mb-5 leading-relaxed">
            Create automated recovery and confirmation sequences triggered when carts are abandoned,
            COD orders are placed, or order statuses change.
          </p>
          <button
            onClick={() => {
              setModalError(null);
              setIsModalOpen(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-crm-accent hover:bg-crm-accentHover rounded-md shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create Your First Journey
          </button>
        </div>
      ) : (
        /* Journeys Table */
        <div className="bg-crm-surface border border-crm-border rounded-lg shadow-sm overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-crm-border bg-crm-elevated/40 text-[11px] font-mono uppercase text-crm-textSecondary">
                <th className="py-2.5 px-4 font-medium">Journey Name</th>
                <th className="py-2.5 px-4 font-medium">Trigger Event</th>
                <th className="py-2.5 px-4 font-medium">Status</th>
                <th className="py-2.5 px-4 font-medium">Steps</th>
                <th className="py-2.5 px-4 font-medium">Created</th>
                <th className="py-2.5 px-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-crm-border text-xs text-crm-text">
              {filteredJourneys.map((journey) => {
                const triggerLabel =
                  TRIGGER_LABELS[journey.triggerEvent] || journey.triggerEvent;
                const stepCount = getStepCount(journey);
                const isActionBusy = !!actionLoading[journey.id];

                return (
                  <tr key={journey.id} className="hover:bg-crm-elevated/30 transition-colors">
                    <td className="py-3 px-4 font-medium text-crm-text">
                      <div className="flex items-center gap-2 flex-wrap">
                        <GitBranch className="w-3.5 h-3.5 text-crm-accent shrink-0" />
                        <span>{journey.name}</span>
                        {journeyNeedsVariableMapping(journey, templates) && (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-800 border border-amber-300"
                            title="This journey has template placeholders without variable mappings"
                          >
                            <AlertCircle className="w-3 h-3 text-amber-600 shrink-0" />
                            Needs variable mapping
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-crm-textSecondary">
                      <span className="inline-flex items-center gap-1 font-mono text-[11px] bg-crm-subtle px-2 py-0.5 rounded border border-crm-border">
                        {triggerLabel}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {journey.status === "active" ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                          Paused
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-crm-textSecondary font-mono text-[11px]">
                      {stepCount} {stepCount === 1 ? "step" : "steps"}
                    </td>
                    <td className="py-3 px-4 text-crm-textSecondary text-[11px]">
                      {formatDate(journey.createdAt)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {journey.status === "active" ? (
                        <button
                          type="button"
                          onClick={() => setConfirmJourneyAction({ journey, action: "pause" })}
                          disabled={isActionBusy}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-300 rounded hover:bg-amber-100 transition-colors disabled:opacity-50"
                        >
                          {isActionBusy ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Pause className="w-3 h-3" />
                          )}
                          Pause
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmJourneyAction({ journey, action: "activate" })}
                          disabled={isActionBusy}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-300 rounded hover:bg-emerald-100 transition-colors disabled:opacity-50"
                        >
                          {isActionBusy ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Play className="w-3 h-3" />
                          )}
                          Activate
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* CREATE JOURNEY MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-crm-surface border border-crm-border rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-crm-border flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold font-heading text-crm-text flex items-center gap-2">
                  <GitBranch className="w-4 h-4 text-crm-accent" />
                  Create Journey
                </h2>
                <p className="text-xs text-crm-textSecondary mt-0.5">
                  Design automated sequence with triggers, timers, and conditional reply branches.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-crm-textSecondary hover:text-crm-text p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleCreateSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
              {modalError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-md flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{modalError}</span>
                </div>
              )}

              {/* Journey Name */}
              <div>
                <label className="block text-xs font-semibold text-crm-text mb-1">
                  Journey Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Abandoned Cart Recovery (1 Hour Delay)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-crm-surface border border-crm-border rounded-md text-crm-text focus:outline-none focus:border-crm-accent"
                  required
                />
              </div>

              {/* Trigger Dropdown */}
              <div>
                <label className="block text-xs font-semibold text-crm-text mb-1">
                  Entry Trigger Event <span className="text-red-500">*</span>
                </label>
                <select
                  value={triggerEvent}
                  onChange={(e) => setTriggerEvent(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-crm-surface border border-crm-border rounded-md text-crm-text focus:outline-none focus:border-crm-accent"
                >
                  {TRIGGER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label} ({opt.value})
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-crm-textSecondary mt-1">
                  Each workspace can run one active journey per trigger type.
                </p>
              </div>

              {/* Step Builder Section */}
              <div className="pt-2 border-t border-crm-border">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-crm-text flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-crm-accent" />
                    Journey Steps & Logic Flow
                  </label>
                  <span className="text-[11px] text-crm-textSecondary">
                    Executes top-to-bottom
                  </span>
                </div>

                <StepListEditor
                  steps={steps}
                  onChange={setSteps}
                  templates={templates}
                  channels={channels}
                  depth={0}
                />
              </div>

              {/* Modal Footer */}
              <div className="pt-4 border-t border-crm-border flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  disabled={submitLoading}
                  className="px-3.5 py-1.5 text-xs font-medium text-crm-textSecondary hover:text-crm-text border border-crm-border rounded-md bg-crm-surface transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitLoading}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-crm-accent hover:bg-crm-accentHover rounded-md shadow-sm transition-colors disabled:opacity-50"
                >
                  {submitLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Save & Activate Journey
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm Pause / Activate Journey Lifecycle Dialog */}
      <ConfirmDialog
        isOpen={Boolean(confirmJourneyAction)}
        title={
          confirmJourneyAction?.action === "pause"
            ? "Pause Automated Journey"
            : "Activate Automated Journey"
        }
        icon={
          confirmJourneyAction?.action === "pause" ? (
            <Pause className="w-4 h-4 text-red-600" />
          ) : (
            <Play className="w-4 h-4 text-crm-accent" />
          )
        }
        message={
          confirmJourneyAction ? (
            confirmJourneyAction.action === "pause" ? (
              <div className="space-y-2">
                <p>
                  Are you sure you want to pause journey{" "}
                  <strong className="text-crm-text">&quot;{confirmJourneyAction.journey.name}&quot;</strong>?
                </p>
                <p className="text-[11px] text-crm-textMuted">
                  Automated follow-ups and recovery messages will be suspended for new and in-flight store events until reactivated.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <p>
                  Activate automated journey{" "}
                  <strong className="text-crm-text">&quot;{confirmJourneyAction.journey.name}&quot;</strong>?
                </p>
                <p className="text-[11px] text-crm-textMuted">
                  Incoming store events matching this trigger will immediately begin entering this automated sequence.
                </p>
              </div>
            )
          ) : null
        }
        confirmLabel={
          confirmJourneyAction?.action === "pause" ? "Pause Journey" : "Activate Journey"
        }
        cancelLabel={confirmJourneyAction?.action === "pause" ? "Keep Active" : "Cancel"}
        isDestructive={confirmJourneyAction?.action === "pause"}
        isLoading={confirmActionLoading}
        onConfirm={handleExecuteJourneyAction}
        onCancel={() => setConfirmJourneyAction(null)}
      />
    </div>
  );
};
