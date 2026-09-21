import React, { useState, useEffect, useCallback } from "react";
import { api, ApiError } from "../lib/api";
import {
  Users,
  Search,
  Plus,
  Upload,
  X,
  AlertCircle,
  CheckCircle2,
  Check,
  FileText,
  Loader2,
} from "lucide-react";

export interface Contact {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  attributes: Record<string, unknown> | null;
  optedInAt: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface ImportResult {
  totalRows: number;
  imported: number;
  skipped: Array<{ row: number; reason: string }>;
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

export const ContactsPage: React.FC = () => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Search state with debouncing
  const [searchInput, setSearchInput] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false);

  // Add Contact Form State
  const [addPhone, setAddPhone] = useState<string>("");
  const [addName, setAddName] = useState<string>("");
  const [addEmail, setAddEmail] = useState<string>("");
  const [addLoading, setAddLoading] = useState<boolean>(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Import CSV State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importLoading, setImportLoading] = useState<boolean>(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // Debounce search input by 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 300);

    return () => clearTimeout(timer);
  }, [searchInput]);

  // Fetch contacts
  const fetchContacts = useCallback(async (query: string) => {
    setLoading(true);
    setError(null);
    try {
      const endpoint = query
        ? `/api/v1/contacts?search=${encodeURIComponent(query)}`
        : "/api/v1/contacts";
      const data = await api.get<Contact[]>(endpoint);
      setContacts(data);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to load contacts.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch contacts when debouncedSearch changes
  useEffect(() => {
    fetchContacts(debouncedSearch);
  }, [debouncedSearch, fetchContacts]);

  // Handle Add Contact Submit
  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addPhone.trim()) {
      setAddError("Phone number is required");
      return;
    }

    setAddLoading(true);
    setAddError(null);

    try {
      await api.post<Contact>("/api/v1/contacts", {
        phone: addPhone.trim(),
        name: addName.trim() || undefined,
        email: addEmail.trim() || undefined,
      });

      // Close modal and reset fields
      setIsAddModalOpen(false);
      setAddPhone("");
      setAddName("");
      setAddEmail("");

      // Refresh list
      await fetchContacts(debouncedSearch);
    } catch (err) {
      if (err instanceof ApiError) {
        setAddError(err.message);
      } else if (err instanceof Error) {
        setAddError(err.message);
      } else {
        setAddError("Failed to add contact.");
      }
    } finally {
      setAddLoading(false);
    }
  };

  // Handle Import CSV Submit
  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setImportError("Please select a CSV file to import.");
      return;
    }

    setImportLoading(true);
    setImportError(null);
    setImportResult(null);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const result = await api.post<ImportResult>(
        "/api/v1/contacts/import",
        formData
      );

      setImportResult(result);
      // Re-fetch contacts to reflect new additions
      await fetchContacts(debouncedSearch);
    } catch (err) {
      if (err instanceof ApiError) {
        setImportError(err.message);
      } else if (err instanceof Error) {
        setImportError(err.message);
      } else {
        setImportError("CSV import failed.");
      }
    } finally {
      setImportLoading(false);
    }
  };

  const closeImportModal = () => {
    setIsImportModalOpen(false);
    setSelectedFile(null);
    setImportError(null);
    setImportResult(null);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Top Header & Actions Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-heading font-semibold text-crm-text tracking-tight">
              Contacts
            </h1>
            <span className="px-2 py-0.5 rounded text-[11px] font-mono text-crm-textSecondary bg-crm-elevated border border-crm-border font-medium">
              {contacts.length} {contacts.length === 1 ? "contact" : "contacts"}
            </span>
          </div>
          <p className="text-xs text-crm-textSecondary mt-0.5">
            Manage your audience, channel subscriptions, and opt-in status.
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            onClick={() => {
              setImportError(null);
              setImportResult(null);
              setSelectedFile(null);
              setIsImportModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-crm-surface hover:bg-crm-elevated border border-crm-border text-xs font-medium text-crm-text shadow-sm transition-colors"
          >
            <Upload className="w-3.5 h-3.5 text-crm-accent" />
            <span>Import CSV</span>
          </button>

          <button
            onClick={() => {
              setAddError(null);
              setIsAddModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-crm-accent hover:bg-crm-accentHover text-xs font-medium text-white shadow-sm transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add contact</span>
          </button>
        </div>
      </div>

      {/* Inline Page Error */}
      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2.5 text-xs text-red-700">
          <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Filter / Search Bar */}
      <div className="flex items-center justify-between gap-3 p-2 rounded-lg bg-crm-surface border border-crm-border shadow-sm">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-crm-textMuted" />
          <input
            type="text"
            placeholder="Search contacts by name or phone..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full pl-9 pr-8 py-1.5 bg-crm-elevated/60 border border-crm-border rounded-md text-xs text-crm-text placeholder-crm-textMuted focus:outline-none focus:border-crm-accent focus:ring-1 focus:ring-crm-accent transition-colors"
          />
          {searchInput && (
            <button
              onClick={() => setSearchInput("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-crm-textMuted hover:text-crm-text p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Contacts Table Container */}
      <div className="bg-crm-surface border border-crm-border rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-16 flex flex-col items-center justify-center text-center">
            <Loader2 className="w-6 h-6 text-crm-accent animate-spin mb-2" />
            <p className="text-xs font-mono text-crm-textSecondary uppercase tracking-wider">
              Loading contacts...
            </p>
          </div>
        ) : contacts.length === 0 ? (
          <div className="py-16 px-4 flex flex-col items-center justify-center text-center">
            <div className="w-12 h-12 rounded-xl bg-crm-elevated border border-crm-border flex items-center justify-center mb-3">
              <Users className="w-6 h-6 text-crm-textSecondary" />
            </div>
            <h3 className="text-sm font-heading font-semibold text-crm-text">
              {debouncedSearch ? "No contacts match your search" : "No contacts yet"}
            </h3>
            <p className="text-xs text-crm-textSecondary mt-1 max-w-sm">
              {debouncedSearch
                ? `No contacts matching "${debouncedSearch}". Try a different name or phone query.`
                : "Get started by adding your first contact manually or importing from a CSV file."}
            </p>
            {debouncedSearch ? (
              <button
                onClick={() => setSearchInput("")}
                className="mt-4 px-3 py-1.5 rounded-md bg-crm-surface hover:bg-crm-elevated border border-crm-border text-xs font-medium text-crm-text transition-colors shadow-sm"
              >
                Clear search
              </button>
            ) : (
              <div className="flex items-center gap-2 mt-4">
                <button
                  onClick={() => setIsAddModalOpen(true)}
                  className="px-3 py-1.5 rounded-md bg-crm-accent hover:bg-crm-accentHover text-xs font-medium text-white transition-colors shadow-sm"
                >
                  Add contact
                </button>
                <button
                  onClick={() => setIsImportModalOpen(true)}
                  className="px-3 py-1.5 rounded-md bg-crm-surface hover:bg-crm-elevated border border-crm-border text-xs font-medium text-crm-text transition-colors shadow-sm"
                >
                  Import CSV
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-crm-border bg-crm-elevated/50 text-[11px] font-mono text-crm-textSecondary uppercase tracking-wider select-none">
                  <th className="py-2.5 px-4 font-medium">Name</th>
                  <th className="py-2.5 px-4 font-medium">Phone</th>
                  <th className="py-2.5 px-4 font-medium">Email</th>
                  <th className="py-2.5 px-4 font-medium">Opted In</th>
                  <th className="py-2.5 px-4 font-medium">Added</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-crm-border text-xs">
                {contacts.map((contact) => {
                  const isOptedIn = Boolean(contact.optedInAt);

                  return (
                    <tr
                      key={contact.id}
                      className="hover:bg-crm-subtle/40 transition-colors group"
                    >
                      {/* Name Column */}
                      <td className="py-3 px-4 font-medium text-crm-text">
                        {contact.name ? (
                          <div className="flex items-center gap-2">
                            <span className="truncate">{contact.name}</span>
                          </div>
                        ) : (
                          <span className="text-crm-textMuted font-mono">—</span>
                        )}
                      </td>

                      {/* Phone Column */}
                      <td className="py-3 px-4 font-mono text-crm-text">
                        {contact.phone}
                      </td>

                      {/* Email Column */}
                      <td className="py-3 px-4 text-crm-textSecondary">
                        {contact.email ? (
                          <span className="truncate">{contact.email}</span>
                        ) : (
                          <span className="text-crm-textMuted font-mono">—</span>
                        )}
                      </td>

                      {/* Opted In Badge */}
                      <td className="py-3 px-4">
                        {isOptedIn ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-crm-successBg text-crm-success border border-crm-successBorder">
                            <Check className="w-3 h-3" />
                            <span>Opted In</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-crm-elevated text-crm-textMuted border border-crm-border">
                            <X className="w-3 h-3" />
                            <span>Opted Out</span>
                          </span>
                        )}
                      </td>

                      {/* Added Date */}
                      <td className="py-3 px-4 font-mono text-crm-textSecondary whitespace-nowrap">
                        {formatDate(contact.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Contact Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4 select-none">
          <div className="bg-crm-surface border border-crm-border rounded-xl shadow-lg w-full max-w-md p-6 relative">
            <div className="flex items-center justify-between pb-4 border-b border-crm-border">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-md bg-crm-accentSubtle border border-crm-accentBorder flex items-center justify-center text-crm-accent">
                  <Plus className="w-4 h-4" />
                </div>
                <h2 className="text-sm font-heading font-semibold text-crm-text">
                  Add Contact
                </h2>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-crm-textMuted hover:text-crm-text p-1 rounded transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {addError && (
              <div className="mt-4 p-2.5 rounded-md bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                <span>{addError}</span>
              </div>
            )}

            <form onSubmit={handleAddSubmit} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-[11px] font-medium text-crm-textSecondary uppercase tracking-wider mb-1">
                  Phone Number <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="+14155552671"
                  value={addPhone}
                  onChange={(e) => setAddPhone(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-crm-border rounded-md text-xs text-crm-text placeholder-crm-textMuted font-mono focus:outline-none focus:border-crm-accent focus:ring-1 focus:ring-crm-accent transition-colors"
                />
                <p className="text-[10px] text-crm-textMuted mt-1">
                  Standard format with country code (e.g. +14155552671).
                </p>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-crm-textSecondary uppercase tracking-wider mb-1">
                  Full Name <span className="text-crm-textMuted">(optional)</span>
                </label>
                <input
                  type="text"
                  placeholder="Jane Doe"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-crm-border rounded-md text-xs text-crm-text placeholder-crm-textMuted focus:outline-none focus:border-crm-accent focus:ring-1 focus:ring-crm-accent transition-colors"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-crm-textSecondary uppercase tracking-wider mb-1">
                  Email Address <span className="text-crm-textMuted">(optional)</span>
                </label>
                <input
                  type="email"
                  placeholder="jane@example.com"
                  value={addEmail}
                  onChange={(e) => setAddEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-crm-border rounded-md text-xs text-crm-text placeholder-crm-textMuted focus:outline-none focus:border-crm-accent focus:ring-1 focus:ring-crm-accent transition-colors"
                />
              </div>

              <div className="pt-3 border-t border-crm-border flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-3 py-1.5 rounded-md border border-crm-border text-xs font-medium text-crm-textSecondary hover:text-crm-text hover:bg-crm-elevated transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addLoading}
                  className="px-4 py-1.5 rounded-md bg-crm-accent hover:bg-crm-accentHover text-xs font-medium text-white transition-colors shadow-sm disabled:opacity-60 flex items-center gap-1.5"
                >
                  {addLoading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <span>Save Contact</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import CSV Modal */}
      {isImportModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4 select-none">
          <div className="bg-crm-surface border border-crm-border rounded-xl shadow-lg w-full max-w-lg p-6 relative">
            <div className="flex items-center justify-between pb-4 border-b border-crm-border">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-md bg-crm-accentSubtle border border-crm-accentBorder flex items-center justify-center text-crm-accent">
                  <Upload className="w-4 h-4" />
                </div>
                <h2 className="text-sm font-heading font-semibold text-crm-text">
                  Import Contacts from CSV
                </h2>
              </div>
              <button
                onClick={closeImportModal}
                className="text-crm-textMuted hover:text-crm-text p-1 rounded transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {importError && (
              <div className="mt-4 p-2.5 rounded-md bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                <span>{importError}</span>
              </div>
            )}

            {importResult ? (
              <div className="mt-4 space-y-4">
                <div className="p-3 rounded-lg bg-crm-successBg border border-crm-successBorder flex items-center gap-2.5 text-xs text-crm-success font-medium">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  <span>
                    Import complete: {importResult.imported} imported,{" "}
                    {importResult.skipped.length} skipped out of{" "}
                    {importResult.totalRows} total rows.
                  </span>
                </div>

                {importResult.skipped.length > 0 && (
                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-mono text-crm-textSecondary uppercase tracking-wider">
                      Skipped Rows Breakdown ({importResult.skipped.length})
                    </label>
                    <div className="max-h-48 overflow-y-auto border border-crm-border rounded-md bg-crm-elevated/40 p-2.5 divide-y divide-crm-border/60">
                      {importResult.skipped.map((skip, index) => (
                        <div
                          key={index}
                          className="py-1.5 first:pt-0 last:pb-0 text-xs flex items-start justify-between gap-3"
                        >
                          <span className="font-mono text-crm-text font-medium text-[11px]">
                            Row {skip.row}
                          </span>
                          <span className="text-[11px] text-red-600 text-right">
                            {skip.reason}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="pt-3 border-t border-crm-border flex justify-end">
                  <button
                    onClick={closeImportModal}
                    className="px-4 py-1.5 rounded-md bg-crm-accent hover:bg-crm-accentHover text-xs font-medium text-white transition-colors shadow-sm"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleImportSubmit} className="mt-4 space-y-4">
                <div className="p-4 border-2 border-dashed border-crm-border rounded-lg bg-crm-elevated/30 flex flex-col items-center justify-center text-center">
                  <FileText className="w-8 h-8 text-crm-accent mb-2" />
                  <label
                    htmlFor="csv-file-input"
                    className="cursor-pointer text-xs font-medium text-crm-accent hover:underline"
                  >
                    {selectedFile ? selectedFile.name : "Select a CSV file to upload"}
                  </label>
                  <input
                    id="csv-file-input"
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        setSelectedFile(e.target.files[0]);
                        setImportError(null);
                      }
                    }}
                    className="hidden"
                  />
                  <p className="text-[10px] text-crm-textSecondary mt-1">
                    CSV should include headers: <code className="font-mono text-crm-text">phone</code> (required),{" "}
                    <code className="font-mono text-crm-text">name</code>,{" "}
                    <code className="font-mono text-crm-text">email</code>.
                  </p>
                </div>

                <div className="pt-3 border-t border-crm-border flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeImportModal}
                    className="px-3 py-1.5 rounded-md border border-crm-border text-xs font-medium text-crm-textSecondary hover:text-crm-text hover:bg-crm-elevated transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={importLoading || !selectedFile}
                    className="px-4 py-1.5 rounded-md bg-crm-accent hover:bg-crm-accentHover text-xs font-medium text-white transition-colors shadow-sm disabled:opacity-60 flex items-center gap-1.5"
                  >
                    {importLoading ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Importing...</span>
                      </>
                    ) : (
                      <span>Upload & Import</span>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
