export default function MaterialIcon({ name, style, className = '' }) {
  return (
    <span className={`material-icons ${className}`} style={style} aria-hidden="true">
      {name}
    </span>
  );
}
