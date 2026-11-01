// User Management → Users: the AG Grid table of console members.
//
// Pure presentation. app.js owns Firestore (consoleUsers) and passes in the
// handlers; this file only turns members into rows and rows into a grid.
// AG Grid Community is loaded on first use by docs-grid.js (jsDelivr), so a
// visit to any other page does not download it.

import { loadAgGrid } from "./docs-grid.js";

const tsMs = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : 0);

// One grid row per consoleUsers doc. "Deactivated" is the existing `disabled`
// flag, which firestore.rules and the MCP server already treat as "no access".
export function userRows(members, selfEmail) {
  const me = String(selfEmail || "").toLowerCase();
  return members.map((m) => {
    const email = String(m.email || m.id || "").toLowerCase();
    return {
      email,
      name: m.displayName || "",
      roleId: m.roleId || "",
      role: ["admin", "editor", "viewer"].includes(m.role) ? m.role : "editor",
      status: m.disabled === true ? "Deactivated" : "Active",
      lastActiveMs: Math.max(tsMs(m.lastLoginAt), tsMs(m.lastMcpAt)),
      isSelf: email === me,
      member: m,
    };
  });
}

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export async function mountUsersGrid(host, { roleLabels, relativeAgo, onRoleChange, onManage, onSelection, getRoles = () => [], onAssignedRoleChange = () => {} }) {
  const ag = await loadAgGrid();
  if (!ag) throw new Error("AG Grid didn't load");
  const roleSelect = (params) => {
    const sel = document.createElement("select");
    sel.className = "um-role-select";
    sel.setAttribute("aria-label", `Role for ${params.data.email}`);
    sel.innerHTML = Object.entries(roleLabels).map(([v, l]) => `<option value="${v}"${v === params.data.role ? " selected" : ""}>${esc(l)}</option>`).join("");
    sel.disabled = params.data.isSelf;
    if (params.data.isSelf) sel.title = "You can't change your own role.";
    sel.addEventListener("click", (e) => e.stopPropagation());
    sel.addEventListener("change", () => onRoleChange([params.data.email], sel.value));
    return sel;
  };
  const assignedCell = (params) => {
    const sel = document.createElement("select");
    sel.className = "um-role-select um-assigned-select";
    sel.setAttribute("aria-label", `Assigned role for ${params.data.email}`);
    const roles = getRoles();
    sel.innerHTML = `<option value="">Not assigned</option>` + roles.map((r) => `<option value="${esc(r.id)}"${r.id === params.data.roleId ? " selected" : ""}>${esc(r.name)}</option>`).join("");
    sel.addEventListener("click", (e) => e.stopPropagation());
    sel.addEventListener("change", () => onAssignedRoleChange(params.data.email, sel.value));
    return sel;
  };
  const statusCell = (params) => {
    const span = document.createElement("span");
    const on = params.value === "Active";
    span.className = "um-status";
    span.innerHTML = `<span class="um-dot ${on ? "um-dot-on" : "um-dot-off"}" aria-hidden="true"></span>${esc(params.value)}`;
    return span;
  };
  const manageCell = (params) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "um-manage"; b.dataset.manage = params.data.email;
    b.setAttribute("aria-label", `Manage ${params.data.email}`);
    b.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">more_horiz</span>';
    b.addEventListener("click", (e) => { e.stopPropagation(); onManage(params.data.email); });
    return b;
  };
  const nameCell = (params) => {
    const d = document.createElement("span");
    d.textContent = params.value || "—";
    if (params.data.isSelf) d.textContent += " (you)";
    return d;
  };
  const api = ag.createGrid(host, {
    columnDefs: [
      { colId: "select", headerName: "", width: 52, checkboxSelection: true, headerCheckboxSelection: true, sortable: false, filter: false, floatingFilter: false, resizable: false, suppressMovable: true, pinned: "left" },
      { field: "name", headerName: "Name", flex: 1, minWidth: 160, cellRenderer: nameCell },
      { field: "email", headerName: "Email", flex: 1.4, minWidth: 220 },
      { field: "role", headerName: "Role", width: 150, cellRenderer: roleSelect, valueFormatter: (p) => roleLabels[p.value] || p.value, filterValueGetter: (p) => roleLabels[p.data.role] || p.data.role },
      { field: "roleId", headerName: "Assigned role", width: 190, cellRenderer: assignedCell, valueFormatter: (p) => { const r = getRoles().find((x) => x.id === p.value); return r ? r.name : "Not assigned"; }, filterValueGetter: (p) => { const r = getRoles().find((x) => x.id === p.data.roleId); return r ? r.name : "Not assigned"; } },
      { field: "status", headerName: "Status", width: 150, cellRenderer: statusCell },
      {
        field: "lastActiveMs", headerName: "Last active", width: 170,
        valueFormatter: (p) => relativeAgo(p.value),
        tooltipValueGetter: (p) => (p.value ? new Date(p.value).toLocaleString() : "No activity"),
        filter: "agNumberColumnFilter", floatingFilter: false,
      },
      { colId: "actions", headerName: "", width: 64, pinned: "right", sortable: false, filter: false, floatingFilter: false, resizable: false, cellRenderer: manageCell },
    ],
    defaultColDef: { sortable: true, filter: "agTextColumnFilter", floatingFilter: true, resizable: true, suppressHeaderMenuButton: false },
    rowData: [],
    getRowId: (p) => p.data.email,
    rowSelection: "multiple",
    suppressRowClickSelection: true,
    isRowSelectable: (n) => !!n.data && !n.data.isSelf,
    suppressCellFocus: true, suppressColumnVirtualisation: true,
    headerHeight: 40, floatingFiltersHeight: 40, rowHeight: 48,
    pagination: true, paginationPageSize: 25, paginationPageSizeSelector: [25, 50, 100],
    domLayout: "autoHeight",
    overlayNoRowsTemplate: '<span class="um-empty">Nobody added yet. The two owner accounts always have access whether or not they are listed here.</span>',
    onSelectionChanged: () => onSelection(api.getSelectedRows()),
  });
  return {
    api,
    setRows(rows) { api.setGridOption("rowData", rows); onSelection(api.getSelectedRows()); },
    search(text) { api.setGridOption("quickFilterText", text); },
    selected() { return api.getSelectedRows(); },
  };
}
