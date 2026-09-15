/**
 * Experience Templates board — prototype content frame.
 *
 * Systems Two (display types / elements) and Three (the surface layer) of the
 * Real-Time Personalised Surface Architecture Specification v1.2. See
 * `../REQUIREMENTS.md` for the spec this renders, and
 * `../../shared/interface-contract.md` for the boundary with Live Visitor Profile.
 *
 * This is a PROTOTYPE, not a platform page: it is iframed into HQ Admin, so it
 * renders no header, no sidebar, no breadcrumb and nothing `position: fixed`.
 * It starts at the page title and fills whatever frame the parent gives it.
 *
 * Stack matches `menu-board-demo/product-app`: React 18 + Ant Design 5, wrapped
 * in a ConfigProvider carrying the PH theme. Icons are Material Symbols
 * (Outlined) — the platform's only icon set.
 */

import React, { useMemo, useState } from 'react';
import { Button, Dropdown, Segmented, Select, Switch, Tabs, Tooltip } from 'antd';
import {
  DISPLAY_TYPES,
  OWNERS,
  PLAYLIST,
  TEMPLATES,
  TIERS,
  TOUCH_POINTS,
  withDeadlines,
} from './boardData.js';

/* ------------------------------------------------------------------ tokens */

const T = {
  primary: '#169bc2',
  primaryTint: 'rgba(22,155,194,0.10)',
  primarySoft: '#e8fdff',
  accent: '#38b0cf',
  text: '#333333',
  muted: 'rgba(0,0,0,0.45)',
  micro: '#9ca3af',
  border: '#d9d9d9',
  borderSubtle: '#f0f0f0',
  divider: 'rgba(5,5,5,0.06)',
  gridText: '#181d1f',
  gridBorder: 'rgba(24,29,31,0.15)',
  surfaceAlt: '#fafafa',
  success: '#52c41a',
  warning: '#faad14',
  error: '#ff4d4f',
  font: 'Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif',
};

/* -------------------------------------------------------------- primitives */

const Icon = ({ name, size = 20, style }) => (
  <span className="material-symbols-outlined" style={{ fontSize: size, verticalAlign: 'middle', ...style }}>
    {name}
  </span>
);

/** Outlined pill, transparent fill — never a solid badge. */
const Pill = ({ children, tone }) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      height: 24,
      padding: '4px 12px',
      borderRadius: 9999,
      border: `1px solid ${tone || T.border}`,
      color: tone || T.text,
      fontSize: 13,
      whiteSpace: 'nowrap',
    }}
  >
    {children}
  </span>
);

const Dot = ({ colour }) => (
  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: colour }} />
);

const SectionLabel = ({ children }) => (
  <div style={{ fontSize: 12, letterSpacing: '0.5px', color: T.muted, textTransform: 'uppercase', margin: '24px 0 12px' }}>
    {children}
  </div>
);

const CountLine = ({ n, noun }) => (
  <div style={{ fontSize: 14 }}>
    <b>{n}</b> {noun}
  </div>
);

/* ------------------------------------------- slot ownership (§5, no backfill) */

function OwnershipBar({ ownership, rtbOpen, slots }) {
  if (slots === 0) return <span style={{ color: T.muted }}>—</span>;
  if (slots === -1) return <Pill>Unlimited</Pill>;

  const segments = [
    { key: 'hq', n: ownership.hq, colour: OWNERS.hq.colour },
    { key: 'advertiser', n: ownership.advertiser, colour: OWNERS.advertiser.colour },
    { key: 'stores', n: ownership.stores, colour: OWNERS.stores.colour },
  ].filter((s) => s.n > 0);

  const assigned = segments.reduce((sum, s) => sum + s.n, 0);
  const unassigned = Math.max(0, slots - assigned);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
      <div style={{ display: 'flex', height: 6, width: 96, borderRadius: 9999, overflow: 'hidden', background: T.borderSubtle, flexShrink: 0 }}>
        {segments.map((s) => (
          <div key={s.key} style={{ flex: s.n, background: s.colour }} />
        ))}
        {unassigned > 0 && <div style={{ flex: unassigned, background: 'repeating-linear-gradient(45deg,#e6e6e6,#e6e6e6 3px,#f7f7f7 3px,#f7f7f7 6px)' }} />}
      </div>
      <span style={{ fontSize: 13, color: T.muted, whiteSpace: 'nowrap' }}>
        {segments.map((s) => `${OWNERS[s.key].label} ${s.n}`).join(' · ')}
        {rtbOpen > 0 && ` · RTB ${rtbOpen}`}
      </span>
    </div>
  );
}

/* ------------------------------------------------ trust zones (spec §7 / §2.3) */

const ZONE = {
  locked: { label: 'PH-locked', border: `2px solid ${T.text}`, background: 'rgba(51,51,51,0.04)' },
  agent: { label: 'Agent-addressable', border: `1px dashed ${T.primary}`, background: T.primaryTint },
};

const ZoneKey = () => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'center', fontSize: 13, color: T.muted }}>
    <span style={{ textTransform: 'uppercase', fontSize: 12, letterSpacing: '0.5px' }}>Key:</span>
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 16, height: 16, borderRadius: 4, ...ZONE.locked }} /> PH-locked — price, terms, disclosures
    </span>
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 16, height: 16, borderRadius: 4, ...ZONE.agent }} /> Agent-addressable — selection within PH’s eligible set
    </span>
  </div>
);

/* ------------------------------------------------------------------ table */

const Th = ({ children, width, align }) => (
  <th
    style={{
      fontSize: 13,
      fontWeight: 700,
      color: T.gridText,
      textAlign: align || 'left',
      padding: '0 15px',
      height: 40,
      width,
      borderBottom: `1px solid ${T.gridBorder}`,
      whiteSpace: 'nowrap',
    }}
  >
    {children}
  </th>
);

const Td = ({ children, align, style }) => (
  <td
    style={{
      fontSize: 14,
      color: T.text,
      textAlign: align || 'left',
      padding: '0 15px',
      borderBottom: `1px solid ${T.gridBorder}`,
      ...style,
    }}
  >
    {children}
  </td>
);

/* =============================================== 1. Display type library */

function DisplayTypesPanel() {
  const [touchPoint, setTouchPoint] = useState('all');
  const [inheritedOnly, setInheritedOnly] = useState(false);

  const counts = useMemo(() => {
    const c = { all: DISPLAY_TYPES.length };
    Object.keys(TOUCH_POINTS).forEach((k) => {
      c[k] = DISPLAY_TYPES.filter((d) => d.touchPoint === k).length;
    });
    return c;
  }, []);

  const rows = DISPLAY_TYPES.filter(
    (d) => (touchPoint === 'all' || d.touchPoint === touchPoint) && (!inheritedOnly || d.overrides > 0),
  );

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        <Segmented
          value={touchPoint}
          onChange={setTouchPoint}
          options={[
            { label: `All (${counts.all})`, value: 'all' },
            ...Object.entries(TOUCH_POINTS).map(([key, tp]) => ({
              label: `${tp.label} (${counts[key]})`,
              value: key,
              icon: <Icon name={tp.icon} size={16} />,
            })),
          ]}
        />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <CountLine n={rows.length} noun="display types" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <Switch size="small" checked={inheritedOnly} onChange={setInheritedOnly} />
            Only types with display-level overrides
          </span>
          <Button type="text" style={{ paddingInline: 0 }}>Slot Ownership</Button>
          <Button type="text" style={{ paddingInline: 0 }}>Add Display Type</Button>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 1040, borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <Th width={44} />
              <Th width={150}>Touch Point</Th>
              <Th width={250}>Name</Th>
              <Th width={210}>Resolution / Breakpoints</Th>
              <Th width={130}>Plays</Th>
              <Th width={80} align="right">Slots</Th>
              <Th width={230}>Slot Ownership</Th>
              <Th width={170}>Default Playlist(s)</Th>
              <Th width={150}>Inheritance</Th>
              <Th width={60} />
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr
                key={d.id}
                style={{ height: 56 }}
                onMouseEnter={(e) => { e.currentTarget.style.background = T.primarySoft; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <Td><input type="checkbox" aria-label={`Select ${d.name}`} /></Td>
                <Td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: T.muted }}>
                    <Icon name={TOUCH_POINTS[d.touchPoint].icon} />
                    {TOUCH_POINTS[d.touchPoint].label}
                  </span>
                </Td>
                <Td>
                  <div style={{ fontWeight: 500 }}>{d.name}</div>
                  <div style={{ fontSize: 12, color: T.micro, marginTop: 2 }}>{d.flags.join(' · ')}</div>
                </Td>
                <Td style={{ color: T.muted }}>{d.spec}</Td>
                <Td><Pill tone={d.plays === 'static' ? T.border : undefined}>{d.plays.toUpperCase()}</Pill></Td>
                <Td align="right">{d.slots === -1 ? '∞' : d.slots}</Td>
                <Td><OwnershipBar ownership={d.ownership} rtbOpen={d.rtbOpen} slots={d.slots} /></Td>
                <Td style={{ color: d.playlists[0] === '—' ? T.muted : T.text }}>{d.playlists.join(', ')}</Td>
                <Td>
                  {d.overrides > 0 ? (
                    <Tooltip title="A display-level override always wins and is never reset by a later type-level edit.">
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: T.warning }}>
                        <Dot colour={T.warning} />
                        {d.overrides} overridden
                      </span>
                    </Tooltip>
                  ) : (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: T.muted }}>
                      <Dot colour={T.success} />
                      Type default
                    </span>
                  )}
                </Td>
                <Td align="right">
                  <Dropdown
                    menu={{ items: [
                      { key: 'edit', label: 'Edit Display Type' },
                      { key: 'slots', label: 'Slot Ownership & Quota' },
                      { key: 'zones', label: 'Multi-zone Layout' },
                      { key: 'overrides', label: 'Review Display Overrides' },
                    ] }}
                  >
                    <Button type="text" icon={<Icon name="more_horiz" />} />
                  </Dropdown>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 20, fontSize: 13, color: T.muted }}>
        <span style={{ textTransform: 'uppercase', fontSize: 12, letterSpacing: '0.5px' }}>Key:</span>
        {Object.values(OWNERS).map((o) => (
          <span key={o.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Dot colour={o.colour} /> {o.label}-owned slots
          </span>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, background: 'repeating-linear-gradient(45deg,#e6e6e6,#e6e6e6 2px,#f7f7f7 2px,#f7f7f7 4px)' }} />
          Open RTB — advertiser stamped post-hoc, once the auction clears
        </span>
      </div>
    </div>
  );
}

/* ======================================================= 2. Playlists */

function PlaylistsPanel() {
  const items = withDeadlines(PLAYLIST);
  const total = items.reduce((sum, i) => sum + i.duration, 0);

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 500 }}>{PLAYLIST.name}</div>
          <div style={{ fontSize: 13, color: T.muted, marginTop: 2 }}>
            {PLAYLIST.displayType} · {PLAYLIST.schedule} · first-paint budget {PLAYLIST.firstPaintBudget}ms · loop {(total / 1000).toFixed(0)}s
          </div>
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          <Select defaultValue={PLAYLIST.name} style={{ width: 200 }} options={[{ value: PLAYLIST.name }, { value: 'Drive-Thru Late' }, { value: 'Core Menu' }]} />
          <Button type="text" style={{ paddingInline: 0 }}>Add Playlist Item</Button>
        </div>
      </div>

      <CountLine n={items.length} noun="items" />

      <div style={{ overflowX: 'auto', marginTop: 8 }}>
        <table style={{ width: '100%', minWidth: 980, borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <Th width={70} align="right">Slot</Th>
              <Th width={230}>Campaign</Th>
              <Th width={130}>Owner</Th>
              <Th width={90} align="right">Priority</Th>
              <Th width={110} align="right">Duration</Th>
              <Th width={190}>Visibility deadline</Th>
              <Th width={230}>Campaign type</Th>
              <Th>Creative settings</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.slot} style={{ height: 48 }}>
                <Td align="right" style={{ color: T.muted }}>{item.slot}</Td>
                <Td style={{ fontWeight: item.owner === 'advertiser' ? 400 : 500, color: item.campaign.startsWith('—') ? T.muted : T.text }}>
                  {item.campaign}
                </Td>
                <Td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <Dot colour={OWNERS[item.owner].colour} />
                    {OWNERS[item.owner].label}
                  </span>
                </Td>
                <Td align="right" style={{ color: item.priority === null ? T.muted : T.text }}>
                  {item.priority === null ? 'auction' : item.priority}
                </Td>
                <Td align="right">{(item.duration / 1000).toFixed(0)}s</Td>
                <Td>
                  <Tooltip title="first_paint_budget + Σ playbackDuration of every preceding slot. Manual navigation collapses this to the moment of navigation.">
                    <span style={{ color: item.deadlineMs > 10000 ? T.success : T.text }}>
                      +{item.deadlineMs.toLocaleString()}ms
                    </span>
                  </Tooltip>
                </Td>
                <Td><Pill>{item.campaignType}</Pill></Td>
                <Td style={{ fontSize: 13, color: T.muted }}>{item.creative}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 16, fontSize: 13, color: T.muted, maxWidth: 780 }}>
        Deferred visibility buys time: a source that can never make the 400ms first paint can still
        win slot 4 at +24,400ms. Dwell time and rotation position are personalisation levers, not
        just layout settings.
      </div>
    </div>
  );
}

/* ======================================================= 3. Templates */

function TemplatesPanel() {
  return (
    <div>
      <CountLine n={TEMPLATES.length} noun="templates" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20, marginTop: 12 }}>
        {TEMPLATES.map((tpl) => (
          <div key={tpl.id} style={{ border: `1px solid ${T.borderSubtle}`, borderRadius: 8 }}>
            <div style={{ background: T.surfaceAlt, padding: '12px 16px', borderRadius: '8px 8px 0 0', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 500 }}>{tpl.name}</div>
                <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
                  {tpl.type} · {tpl.widthMode} · first paint {tpl.firstPaintBudget}ms
                </div>
              </div>
              <Button type="text" icon={<Icon name="more_horiz" />} />
            </div>

            <div style={{ padding: 16 }}>
              {tpl.elements.map((el, i) => (
                <React.Fragment key={el.name}>
                  {i === tpl.foldPosition && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '12px 0', color: T.warning, fontSize: 12, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                      <span style={{ flex: 1, height: 1, background: T.warning, opacity: 0.4 }} />
                      Fold — position {tpl.foldPosition}
                      <span style={{ flex: 1, height: 1, background: T.warning, opacity: 0.4 }} />
                    </div>
                  )}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: '10px 12px',
                      marginBottom: 8,
                      borderRadius: 6,
                      ...(el.zone === 'locked' ? ZONE.locked : el.zone === 'agent' ? ZONE.agent : { border: `1px solid ${T.borderSubtle}` }),
                    }}
                  >
                    <span style={{ fontSize: 14 }}>{el.name}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, color: T.micro }}>{el.plays}</span>
                      <Pill>{el.deadline}</Pill>
                    </span>
                  </div>
                </React.Fragment>
              ))}

              <div style={{ marginTop: 16, padding: 12, borderRadius: 6, border: `1px dashed ${T.border}`, background: T.surfaceAlt }}>
                <div style={{ fontSize: 12, letterSpacing: '0.5px', textTransform: 'uppercase', color: T.muted, marginBottom: 6 }}>
                  Pairing overlay — not part of page layout
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                  <Icon name={tpl.pairing.state.startsWith('Paired') ? 'smartphone' : 'qr_code_2'} />
                  {tpl.pairing.state} · anchor {tpl.pairing.anchor} · offset {tpl.pairing.offset}
                </div>
                <div style={{ fontSize: 12, color: T.micro, marginTop: 6 }}>
                  Holds position through scroll and campaign transitions.
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <SectionLabel>Trust zones</SectionLabel>
      <ZoneKey />
    </div>
  );
}

/* ================================================== 4. Tier preview */

function TierPreviewPanel() {
  return (
    <div>
      <div style={{ fontSize: 13, color: T.muted, maxWidth: 820, marginBottom: 16 }}>
        The render ladder, side by side. A surface paints immediately with whatever is available and
        enhances in place — it never blocks waiting on personalisation. Connection state is a second,
        orthogonal axis: campaigns resolve on the tier, CTAs resolve on the connection.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
        {TIERS.map((tier) => (
          <div key={tier.key} style={{ border: `1px solid ${T.borderSubtle}`, borderRadius: 8, display: 'flex', flexDirection: 'column' }}>
            <div style={{ background: T.surfaceAlt, padding: '12px 16px', borderRadius: '8px 8px 0 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.5px', color: T.micro }}>TIER {tier.n}</span>
                <span style={{ fontWeight: 500 }}>{tier.name}</span>
              </div>
              <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>{tier.connection}</div>
            </div>

            {/* the rendered surface */}
            <div style={{ padding: 16, borderBottom: `1px solid ${T.borderSubtle}` }}>
              <div style={{ background: '#111', color: '#fff', borderRadius: 6, padding: 14, minHeight: 168, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ ...ZONE.agent, borderRadius: 4, padding: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.25 }}>{tier.headline}</div>
                  <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>{tier.sub}</div>
                </div>

                <div style={{ ...ZONE.locked, borderColor: '#fff', background: 'rgba(255,255,255,0.08)', borderRadius: 4, padding: 8, marginTop: 'auto' }}>
                  <div style={{ fontSize: 10, letterSpacing: '0.5px', textTransform: 'uppercase', opacity: 0.7 }}>{tier.priceLabel}</div>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{tier.price}</div>
                  <div style={{ fontSize: 10, opacity: 0.65, marginTop: 4 }}>{tier.terms}</div>
                </div>

                {tier.cta && (
                  <div style={{ ...ZONE.agent, borderRadius: 4, padding: '6px 8px', fontSize: 12 }}>{tier.cta}</div>
                )}
              </div>
            </div>

            {/* what resolved */}
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.5px', color: T.micro, textTransform: 'uppercase' }}>Deadline</div>
                <div style={{ fontSize: 13, marginTop: 2 }}>{tier.deadline}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.5px', color: T.micro, textTransform: 'uppercase' }}>Resolved</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {tier.resolved.length === 0 && <span style={{ fontSize: 13, color: T.muted }}>Nothing</span>}
                  {tier.resolved.map((a) => <Pill key={a} tone={T.primary}>{a}</Pill>)}
                </div>
              </div>
              {tier.blank.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.5px', color: T.micro, textTransform: 'uppercase' }}>Blank — serves default</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    {tier.blank.map((a) => <Pill key={a}>{a}</Pill>)}
                  </div>
                </div>
              )}
              <div style={{ fontSize: 12, color: T.muted, marginTop: 'auto', paddingTop: 8 }}>{tier.note}</div>
            </div>
          </div>
        ))}
      </div>

      <SectionLabel>Trust zones</SectionLabel>
      <ZoneKey />
    </div>
  );
}

/* ====================================================== the content frame */

export default function ExperienceTemplatesBoard() {
  return (
    <div style={{ minHeight: '100%', width: '100%', background: '#fff', padding: 20, fontFamily: T.font, color: T.text }}>
      {/* No header, no sidebar, no breadcrumb — the parent HQ Admin shell owns them. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 20, fontWeight: 700 }}>Experience Templates</span>
        <span style={{ fontSize: 14, color: T.muted }}>
          Surface Architecture <b style={{ color: T.text }}>v1.2</b> · Systems Two &amp; Three
        </span>
      </div>
      <div style={{ height: 1, background: T.divider, margin: '16px 0' }} />

      <Tabs
        defaultActiveKey="display-types"
        items={[
          { key: 'display-types', label: 'Display Types', children: <DisplayTypesPanel /> },
          { key: 'playlists', label: 'Playlists', children: <PlaylistsPanel /> },
          { key: 'templates', label: 'Templates', children: <TemplatesPanel /> },
          { key: 'tiers', label: 'Tier Preview', children: <TierPreviewPanel /> },
        ]}
      />
    </div>
  );
}
