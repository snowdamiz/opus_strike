export function SkinRarityChrome({ className = '' }: { className?: string }) {
  return (
    <div className={`loadout-skin-card-chrome${className ? ` ${className}` : ''}`} aria-hidden="true">
      <span className="loadout-skin-card-sash" />
      <span className="loadout-skin-card-emblem" />
      <span className="loadout-skin-card-bracket is-top-left" />
      <span className="loadout-skin-card-bracket is-top-right" />
      <span className="loadout-skin-card-bracket is-bottom-left" />
      <span className="loadout-skin-card-bracket is-bottom-right" />
    </div>
  );
}
