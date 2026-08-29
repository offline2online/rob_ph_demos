import { Tooltip } from 'antd';

// ph-designer's AI gradient recipe (references/components.md §1) — same
// teal→violet pair Product Details' "Add New Language" AiButton uses for
// every AI-driven action elsewhere in this app. Exported so ai-themed
// IconActions and any future AiButton-style control share one definition.
export const AI_GRADIENT_SOFT = 'linear-gradient(135deg, rgba(22,155,194,.2), rgba(151,71,255,.2))';
export const AI_GRADIENT_SOLID = 'linear-gradient(135deg, #169bc2, #9747ff)';

// Icon + permanent caption + state-aware Tooltip (bold title + plain-language
// line). Brief §9: "Toolbar buttons — custom IconAction.jsx". No AntD
// equivalent exists for a captioned icon-action button.
export default function IconAction({
  icon,
  caption,
  tooltipTitle,
  tooltipDesc,
  active = false,
  gold = false,
  danger = false,
  disabled = false,
  row = false,
  tooltipPlacement,
  ai = false,
  busy = false,
  onClick,
}) {
  const base = {
    display: 'flex',
    flexDirection: row ? 'row' : 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: row ? 7 : 4,
    width: row ? undefined : 72,
    minWidth: row ? 0 : 72,
    padding: row ? '6px 12px' : '8px 6px 7px',
    border: '1px solid ' + (row ? '#d9d9d9' : 'transparent'),
    borderRadius: 6,
    background: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    color: 'rgba(0,0,0,.65)',
    transition: 'all .15s',
    opacity: disabled ? 0.35 : 1,
  };
  if (active && !disabled) {
    base.background = gold ? '#fffbe6' : '#e8fdff';
    base.borderColor = gold ? '#ffe58f' : '#87d9ec';
    base.color = gold ? '#d48806' : '#09759c';
  }
  if (danger && !disabled) base.color = '#ff4d4f';

  // AI-driven actions (Enhance, Remove Background, Request Changes, Video)
  // get the same gradient treatment as every other AI-driven control in
  // this app — a soft tint while idle/busy, a solid fill once its result
  // is actually applied (active), so "this is an AI action" and "this AI
  // action is currently in effect" both read consistently everywhere.
  if (ai && !disabled) {
    base.borderColor = 'transparent';
    if (active) {
      base.background = AI_GRADIENT_SOLID;
      base.color = '#fff';
    } else {
      base.background = AI_GRADIENT_SOFT;
      base.color = '#169bc2';
    }
  }

  const gradientText = ai && !disabled && !active
    ? { backgroundImage: AI_GRADIENT_SOLID, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }
    : {};

  const btn = (
    <button
      type="button"
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      style={base}
      onMouseEnter={(e) => {
        if (disabled) return;
        if (ai) { if (!active) e.currentTarget.style.filter = 'brightness(0.97)'; return; }
        if (!active) { e.currentTarget.style.background = '#fafafa'; e.currentTarget.style.borderColor = '#f0f0f0'; }
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        if (ai) { e.currentTarget.style.filter = 'none'; return; }
        if (!active) { e.currentTarget.style.background = 'none'; e.currentTarget.style.borderColor = row ? '#d9d9d9' : 'transparent'; }
      }}
    >
      <span style={{ display: 'inline-flex', animation: busy ? 'ph-ai-spin 0.9s linear infinite' : 'none' }}>{icon}</span>
      <span style={{ fontSize: row ? 13 : 11, lineHeight: 1.25, textAlign: 'center', whiteSpace: 'nowrap', ...gradientText }}>
        {caption}
      </span>
    </button>
  );

  if (!tooltipTitle) return btn;

  return (
    <Tooltip
      placement={tooltipPlacement || (row ? 'top' : 'bottom')}
      title={
        <div style={{ maxWidth: 200 }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>{tooltipTitle}</div>
          {tooltipDesc && <div style={{ opacity: 0.85 }}>{tooltipDesc}</div>}
        </div>
      }
    >
      {btn}
    </Tooltip>
  );
}
