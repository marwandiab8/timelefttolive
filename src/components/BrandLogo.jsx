// Marwan's K2 logo. It sits on a small white disc so the grey ring reads on the dark themes too.
export default function BrandLogo({ size = 40, className = '' }) {
  return (
    <img
      className={`brand-logo ${className}`.trim()}
      src="/brand/k2-logo-256.png"
      alt="K2"
      width={size}
      height={size}
      decoding="async"
    />
  );
}
