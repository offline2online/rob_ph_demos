// A searchable, sortable list for the Docs page, drawn with AG Grid (the
// Personalisation Hub's data grid, ag-theme-alpine). AG Grid is loaded lazily
// from jsDelivr, the way Quill is (quill-loader.js); if it cannot load, the
// same data is drawn as a plain sortable table so the page never goes blank.
//
//   const list = createDocsList(containerEl, { id, columns, searchLabel, emptyText });
//   list.setRows(rows);   // safe to call on every snapshot — keeps search/sort
//
// A column is { key, header, html(row) -> cell HTML, text(row) -> sortable and
// searchable text, flex?, width?, sortable? }. Cell HTML must already be
// escaped by the caller; click handlers are delegated on the container.

const AG_VERSION = "32.3.3";
const AG_BASE = `https://cdn.jsdelivr.net/npm/ag-grid-community@${AG_VERSION}/`;
let loading = null;

export function loadAgGrid() {
  if (typeof window !== "undefined" && window.agGrid && window.agGrid.createGrid) return Promise.resolve(window.agGrid);
  if (loading) return loading;
  loading = new Promise((resolve) => {
    const done = (v) => resolve(v);
    for (const name of ["ag-grid.css", "ag-theme-alpine.css"]) {
      const l = document.createElement("link");
      l.rel = "stylesheet"; l.href = `${AG_BASE}styles/${name}`;
      document.head.appendChild(l);
    }
    const s = document.createElement("script");
    s.src = `${AG_BASE}dist/ag-grid-community.min.noStyle.js`;
    s.onload = () => done(window.agGrid && window.agGrid.createGrid ? window.agGrid : null);
    s.onerror = () => { loading = null; done(null); };
    document.head.appendChild(s);
  });
  return loading;
}

function escAttr(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"); }

export function createDocsList(container, opts) {
  const { id, columns, searchLabel = "Search", emptyText = "Nothing to show yet." } = opts;
  let rows = [];
  let query = "";
  let sort = null; // { key, dir }
  let api = null;
  let gridEl = null;
  let agFailed = false;

  container.classList.add("docs-list");
  container.innerHTML = `
    <div class="docs-list-tools"><span class="material-symbols-outlined" aria-hidden="true">search</span>
      <input type="search" class="docs-list-search" aria-label="${escAttr(searchLabel)}" placeholder="${escAttr(searchLabel)}"></div>
    <div class="docs-list-body"></div>`;
  const search = container.querySelector(".docs-list-search");
  const body = container.querySelector(".docs-list-body");

  const textOf = (c, r) => String(c.text ? c.text(r) : "").toLowerCase();
  const visible = () => {
    let list = rows.filter((r) => !query || columns.some((c) => textOf(c, r).includes(query)));
    if (sort) {
      const c = columns.find((x) => x.key === sort.key);
      list = list.slice().sort((a, b) => textOf(c, a).localeCompare(textOf(c, b), undefined, { numeric: true }) * (sort.dir === "desc" ? -1 : 1));
    }
    return list;
  };

  function drawTable() {
    const list = visible();
    if (!list.length) { body.innerHTML = `<p class="interface-row-empty">${escAttr(rows.length ? "No matches." : emptyText)}</p>`; return; }
    body.innerHTML = `<div class="docs-table-wrap"><table class="docs-table"><thead><tr>${columns.map((c) => {
      const s = sort && sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
      return c.sortable === false ? `<th>${escAttr(c.header)}</th>`
        : `<th aria-sort="${s}"><button type="button" class="docs-th-sort" data-key="${escAttr(c.key)}">${escAttr(c.header)}<span class="material-symbols-outlined">${s === "ascending" ? "arrow_upward" : s === "descending" ? "arrow_downward" : "unfold_more"}</span></button></th>`;
    }).join("")}</tr></thead><tbody>${list.map((r) => `<tr data-id="${escAttr(r.id)}">${columns.map((c) => `<td>${c.html(r)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }

  function startGrid(ag) {
    body.innerHTML = "";
    gridEl = document.createElement("div");
    gridEl.className = "ag-theme-alpine docs-ag";
    gridEl.dataset.grid = id;
    body.appendChild(gridEl);
    api = ag.createGrid(gridEl, {
      columnDefs: columns.map((c) => ({
        colId: c.key, headerName: c.header, sortable: c.sortable !== false, resizable: true,
        flex: c.flex || 0, width: c.width, minWidth: c.minWidth || 90, autoHeight: true, wrapText: true,
        valueGetter: (p) => (c.text ? c.text(p.data) : ""),
        comparator: (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }),
        cellRenderer: (p) => { const d = document.createElement("div"); d.className = "docs-ag-cell"; d.innerHTML = c.html(p.data); return d; },
      })),
      rowData: rows,
      getRowId: (p) => String(p.data.id),
      domLayout: "autoHeight",
      suppressCellFocus: true,
      overlayNoRowsTemplate: `<span class="interface-row-empty">${escAttr(emptyText)}</span>`,
      quickFilterText: query,
    });
  }

  search.addEventListener("input", () => {
    query = search.value.trim().toLowerCase();
    if (api) api.setGridOption("quickFilterText", query); else drawTable();
  });
  body.addEventListener("click", (e) => {
    const b = e.target.closest(".docs-th-sort");
    if (!b) return;
    const key = b.dataset.key;
    sort = sort && sort.key === key ? (sort.dir === "asc" ? { key, dir: "desc" } : null) : { key, dir: "asc" };
    drawTable();
  });

  drawTable();
  loadAgGrid().then((ag) => {
    if (!ag) { agFailed = true; return; }
    if (!container.isConnected) return;
    startGrid(ag);
  });

  return {
    setRows(next) {
      rows = next || [];
      if (api) { api.setGridOption("rowData", rows); api.setGridOption("quickFilterText", query); } else if (!gridEl || agFailed) drawTable();
    },
    get usesAgGrid() { return !!api; },
  };
}
