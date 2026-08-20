// Two glyphs with no Material Icons equivalent, ported verbatim from
// product-module-prototype_5.html's ICON.ab / ICON.removeBg / ICON.starFill.
const PATHS = {
  removeBg: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2.5" strokeDasharray="3.2 3" />
      <path d="M7.5 15.5l2.8-3.6 2.2 2.6 1.9-2.3 2.1 3.3z" fill="currentColor" stroke="none" />
      <circle cx="9" cy="8.8" r="1.5" fill="currentColor" stroke="none" />
    </>
  ),
  ab: (
    <>
      <rect x="2.4" y="4.6" width="8.6" height="14.8" rx="2.2" />
      <rect x="13" y="4.6" width="8.6" height="14.8" rx="2.2" />
      <text x="6.7" y="15.4" textAnchor="middle" fontSize="9.4" fontWeight="700" fill="currentColor" stroke="none">
        A
      </text>
      <text x="17.3" y="15.4" textAnchor="middle" fontSize="9.4" fontWeight="700" fill="currentColor" stroke="none">
        B
      </text>
    </>
  ),
  starOutline: <path d="M12 3.2l2.64 5.36 5.91.86-4.28 4.17 1.01 5.89L12 16.66l-5.28 2.82 1.01-5.89L3.45 9.42l5.91-.86z" />,
  starFill: (
    <path d="M12 3.2l2.64 5.36 5.91.86-4.28 4.17 1.01 5.89L12 16.66l-5.28 2.82 1.01-5.89L3.45 9.42l5.91-.86z" fill="currentColor" />
  ),
};

export default function BespokeIcon({ name, size = 22, style }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      {PATHS[name]}
    </svg>
  );
}
