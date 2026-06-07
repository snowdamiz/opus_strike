export function LobbyBackdrop() {
  return (
    <div className="absolute inset-0" aria-hidden="true">
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: 'url(/bg.jpg)' }}
      />
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(to bottom, rgb(var(--color-strike-page-top) / 0.8), rgb(var(--color-strike-page-mid) / 0.75), rgb(var(--color-strike-page-bottom) / 0.9))',
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse 60% 70% at 50% 45%, rgb(var(--color-strike-page-top) / 0.5) 0%, transparent 70%)',
        }}
      />
      <div className="absolute inset-0 pattern-grid opacity-10" />
      <div
        className="absolute bottom-0 left-0 right-0 h-2/5"
        style={{
          background: 'linear-gradient(to top, rgb(var(--color-strike-page-top)), transparent)',
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          boxShadow: 'inset 0 0 200px 80px rgba(0,0,0,0.7)',
        }}
      />
    </div>
  );
}
