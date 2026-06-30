export function SkinRarityChrome({ className = '' }: { className?: string }) {
  return (
    <div className={`skins-card-chrome${className ? ` ${className}` : ''}`} aria-hidden="true">
      <span className="skins-card-sash" />
      <span className="skins-card-emblem" />
      <span className="skins-card-bracket is-top-left" />
      <span className="skins-card-bracket is-top-right" />
      <span className="skins-card-bracket is-bottom-left" />
      <span className="skins-card-bracket is-bottom-right" />
    </div>
  );
}
