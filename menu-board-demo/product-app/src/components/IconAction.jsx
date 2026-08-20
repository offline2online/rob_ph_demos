import { Tooltip } from 'antd';

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
  onClick,
}) {
  const base = {
    display: 'flex',
    flexDirection: row ? 'row' : 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: row ? 7 : 4,
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

  const btn = (
    <button
      type="button"
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      style={base}
      onMouseEnter={(e) => {
        if (disabled) return;
        if (!active) { e.currentTarget.style.background = '#fafafa'; e.currentTarget.style.borderColor = '#f0f0f0'; }
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        if (!active) { e.currentTarget.style.background = 'none'; e.currentTarget.style.borderColor = row ? '#d9d9d9' : 'transparent'; }
      }}
    >
      {icon}
      <span style={{ fontSize: row ? 13 : 11, lineHeight: 1.25, textAlign: 'center', whiteSpace: 'nowrap' }}>
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
