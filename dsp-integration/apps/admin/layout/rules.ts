/* The alignment rules, run inside the page (page.evaluate). Kept as one
   self-contained function so Playwright can serialise it: no imports, no
   closures over this file.

   Three rules, all geometry — a failure names the element and the numbers,
   so nobody has to eyeball a screenshot diff to see what moved:

   1. field-row   Fields that share a container sit on rows consistently: no
                  single field wrapped onto a row of its own while its equal-
                  width siblings share rows above it, and anything marked
                  data-layout-pair="<name>" is on one row with its partner.
   2. tooltip     Every info icon is the immediate neighbour of the text it
                  explains: text before it on the same line, a few pixels
                  away — not floating, not at the far end of the row.
   3. grid        Fields on one row share a label line and a control line;
                  fields stacked in one column share a left edge. */
export interface Violation { rule: 'field-row' | 'tooltip' | 'grid'; where: string; detail: string }

export function collectViolations(): Violation[] {
  const out: Violation[] = []
  const TOL = 1.5 // sub-pixel rounding, nothing more
  const TIP_MAX_GAP = 12
  const rect = (el: Element) => el.getBoundingClientRect()
  const visible = (el: Element) => {
    const r = rect(el)
    const s = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
  }
  /* A stable, readable address: nearest id/aria-label/text, then tag path. */
  const name = (el: Element) => {
    const aria = el.getAttribute('role') === 'button' ? el.getAttribute('aria-label') : null
    if (aria) return `info icon “${aria.replace(/\s+/g, ' ').trim().slice(0, 40)}”`
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
    return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${text ? ` “${text}”` : ''}`
  }
  const push = (rule: Violation['rule'], el: Element, detail: string) => out.push({ rule, where: name(el), detail })

  /* The visible page content, not the platform shell: nav, header. */
  const root = document.querySelector('main') ?? document.body

  /* ---- 2. tooltip adjacency ------------------------------------------ */
  const tips = [...root.querySelectorAll<HTMLElement>('[role="button"][aria-label]')]
    .filter((el) => (el.textContent ?? '').trim() === 'info' && visible(el))
  for (const tip of tips) {
    const tr = rect(tip)
    /* The text this icon explains: the last non-empty text before it inside
       its nearest block-level ancestor. */
    let block: Element | null = tip.parentElement
    while (block && getComputedStyle(block).display === 'inline') block = block.parentElement
    const walker = document.createTreeWalker(block ?? root, NodeFilter.SHOW_TEXT)
    let last: Text | null = null
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode()) {
      if (tip.contains(n)) break
      if ((n.textContent ?? '').trim() && !(n.parentElement?.closest('[role="button"][aria-label]')) && n.compareDocumentPosition(tip) & Node.DOCUMENT_POSITION_FOLLOWING) last = n
    }
    if (!last) { push('tooltip', tip, 'no label, heading or copy before the icon — it is floating'); continue }
    const range = document.createRange()
    range.selectNodeContents(last)
    const rs = [...range.getClientRects()].filter((r) => r.width > 0)
    const lr = rs[rs.length - 1]
    if (!lr) continue
    const gap = tr.left - lr.right
    const dy = Math.abs((tr.top + tr.height / 2) - (lr.top + lr.height / 2))
    if (gap < -TOL) push('tooltip', tip, `overlaps the text before it by ${(-gap).toFixed(1)}px`)
    else if (gap > TIP_MAX_GAP) push('tooltip', tip, `${gap.toFixed(1)}px from the text it explains (max ${TIP_MAX_GAP}px)`)
    if (dy > Math.max(6, lr.height / 2)) push('tooltip', tip, `sits ${dy.toFixed(1)}px off the vertical centre of its text`)
  }

  /* ---- fields: a <label> and its control, grouped by container ------------ */
  const labels = [...root.querySelectorAll<HTMLLabelElement>('label')].filter(visible)
  const groups = new Map<Element, { field: Element; label: Element; control: Element | null }[]>()
  for (const label of labels) {
    let field: Element | null = label.parentElement
    if (!field) continue
    /* Field puts an action beside the label in its own row div. */
    if (field.children.length === 2 && field.className.includes('justify-between') && field.parentElement) field = field.parentElement
    const container = field.parentElement
    if (!container || !visible(field)) continue
    const control = [...field.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea, .ant-select, .ant-picker, .ant-input-number')]
      .find((c) => visible(c) && !(label.contains(c))) ?? null
    const list = groups.get(container) ?? []
    list.push({ field, label, control })
    groups.set(container, list)
  }

  for (const [container, fields] of groups) {
    if (fields.length < 2) continue
    const rowsOf = () => {
      const rows: typeof fields[] = []
      for (const f of [...fields].sort((a, b) => rect(a.field).top - rect(b.field).top || rect(a.field).left - rect(b.field).left)) {
        const row = rows.find((r) => Math.abs(rect(r[0].field).top - rect(f.field).top) < 4)
        row ? row.push(f) : rows.push([f])
      }
      return rows
    }
    const rows = rowsOf()
    const cs = rect(container)

    /* ---- 1. field-row ---------------------------------------------------- */
    const pairs = new Map<string, typeof fields>()
    for (const f of fields) {
      const key = f.field.closest('[data-layout-pair]')?.getAttribute('data-layout-pair')
      if (key) pairs.set(key, [...(pairs.get(key) ?? []), f])
    }
    for (const [key, members] of pairs) {
      const tops = members.map((m) => rect(m.field).top)
      if (Math.max(...tops) - Math.min(...tops) > 4) push('field-row', members[0].field, `paired fields “${key}” are not on one row (tops ${tops.map((t) => Math.round(t)).join(' / ')})`)
    }
    /* A widow: a lone field on the last row, narrower than the container,
       while the rows above hold two or more fields of the same width. */
    if (rows.length >= 2) {
      const last = rows[rows.length - 1]
      const above = rows.slice(0, -1)
      const w = rect(last[0].field).width
      const siblingsShareRows = above.every((r) => r.length >= 2) && above.every((r) => r.every((f) => Math.abs(rect(f.field).width - w) < 4))
      if (last.length === 1 && siblingsShareRows && w < cs.width * 0.8) {
        push('field-row', last[0].field, `wrapped onto a row of its own (${Math.round(w)}px wide in a ${Math.round(cs.width)}px container; rows above hold ${above[0].length} fields each)`)
      }
    }

    /* ---- 3. grid --------------------------------------------------------- */
    for (const row of rows) {
      if (row.length < 2) continue
      const lt = row.map((f) => rect(f.label).top)
      if (Math.max(...lt) - Math.min(...lt) > TOL) push('grid', row[0].field, `labels on one row are ${(Math.max(...lt) - Math.min(...lt)).toFixed(1)}px apart vertically`)
      const ct = row.filter((f) => f.control).map((f) => rect(f.control!).top)
      if (ct.length > 1 && Math.max(...ct) - Math.min(...ct) > TOL) push('grid', row[0].field, `controls on one row are ${(Math.max(...ct) - Math.min(...ct)).toFixed(1)}px apart vertically`)
    }
    const stacked = rows.filter((r) => r.length === 1).map((r) => r[0])
    if (stacked.length >= 2) {
      const left = stacked.map((f) => rect(f.control ?? f.field).left)
      if (Math.max(...left) - Math.min(...left) > TOL) push('grid', stacked[0].field, `stacked fields do not share a left edge (${[...new Set(left.map((l) => Math.round(l)))].join(' / ')}px)`)
    }
  }
  /* Same issue found twice (two viewports aside) is one issue. */
  const seen = new Set<string>()
  return out.filter((v) => { const k = `${v.rule}|${v.where}|${v.detail}`; return seen.has(k) ? false : (seen.add(k), true) })
}
