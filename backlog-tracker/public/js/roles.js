// User Management → Roles: the internal IAM roles (Admin, Product, Designer,
// Engineer, Security). Pure presentation and pure helpers; app.js owns
// Firestore (the `roles` collection and consoleUsers.roleId).
// AG Grid Community is loaded on first use by docs-grid.js.

import { loadAgGrid } from "./docs-grid.js";

export const DEFAULT_ROLES = [
  { name: "Admin", description: "Full access to the console and its settings." },
  { name: "Product", description: "Defines what gets built and signs it off." },
  { name: "Designer", description: "Designs the screens and the experience." },
  { name: "Engineer", description: "Builds and ships the product." },
  { name: "Security", description: "Reviews access, data handling and risk." },
];

const tsMs = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : 0);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// One row per role, with the number of console members assigned to it.
export function roleRows(roles, members) {
  const counts = {};
  (members || []).forEach((m) => { if (m.roleId) counts[m.roleId] = (counts[m.roleId] || 0) + 1; });
  return (roles || []).map((r) => ({
    id: r.id,
    name: r.name || "",
    description: r.description || "",
    users: counts[r.id] || 0,
    modifiedMs: tsMs(r.updatedAt) || tsMs(r.createdAt),
  })).sort((a, b) => a.name.localeCompare(b.name));
}

export function trimmedRoleName(v) { return String(v == null ? "" : v).trim().replace(/\s+/g, " "); }

// Names are unique ignoring case. `exceptId` lets a rename keep its own name.
export function roleNameError(name, roles, exceptId) {
  const n = trimmedRoleName(name);
  if (!n) return "Give the role a name.";
  if (n.length > 60) return "Role names can be up to 60 characters.";
  const clash = (roles || []).some((r) => r.id !== exceptId && String(r.name || "").trim().toLowerCase() === n.toLowerCase());
  return clash ? `A role called "${n}" already exists.` : "";
}

export function cloneName(name, roles) {
  const base = `Copy of ${trimmedRoleName(name)}`;
  let candidate = base, i = 2;
  while ((roles || []).some((r) => String(r.name || "").trim().toLowerCase() === candidate.toLowerCase())) candidate = `${base} (${i++})`;
  return candidate;
}

export async function mountRolesGrid(host, { relativeAgo, onEdit, onClone, onDelete }) {
  const ag = await loadAgGrid();
  if (!ag) throw new Error("AG Grid didn't load");
  const actions = (params) => {
    const wrap = document.createElement("span");
    wrap.className = "role-actions";
    const mk = (cls, icon, label, fn) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = `role-act ${cls}`; b.dataset.roleId = params.data.id;
      b.setAttribute("aria-label", `${label} ${params.data.name}`); b.title = label;
      b.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">${icon}</span>`;
      b.addEventListener("click", (e) => { e.stopPropagation(); fn(params.data.id); });
      wrap.appendChild(b);
    };
    mk("role-edit", "edit", "Edit", onEdit);
    mk("role-clone", "content_copy", "Clone", onClone);
    mk("role-delete", "delete", "Delete", onDelete);
    return wrap;
  };
  const api = ag.createGrid(host, {
    columnDefs: [
      { field: "name", headerName: "Role name", flex: 1, minWidth: 160 },
      { field: "description", headerName: "Description", flex: 2, minWidth: 220 },
      { field: "users", headerName: "Users", width: 110, filter: "agNumberColumnFilter" },
      {
        field: "modifiedMs", headerName: "Last modified", width: 170, filter: "agNumberColumnFilter",
        valueFormatter: (p) => relativeAgo(p.value),
        tooltipValueGetter: (p) => (p.value ? new Date(p.value).toLocaleString() : ""),
      },
      { colId: "actions", headerName: "", width: 140, pinned: "right", sortable: false, filter: false, floatingFilter: false, resizable: false, cellRenderer: actions },
    ],
    defaultColDef: { sortable: true, filter: "agTextColumnFilter", floatingFilter: true, resizable: true },
    rowData: [],
    getRowId: (p) => p.data.id,
    suppressCellFocus: true, suppressColumnVirtualisation: true,
    headerHeight: 40, floatingFiltersHeight: 40, rowHeight: 48,
    pagination: true, paginationPageSize: 25, paginationPageSizeSelector: [25, 50, 100],
    domLayout: "autoHeight",
    overlayNoRowsTemplate: '<span class="um-empty">No roles yet.</span>',
  });
  return {
    api,
    setRows(rows) { api.setGridOption("rowData", rows); },
    search(text) { api.setGridOption("quickFilterText", text); },
  };
}
