export function LoadingScreen() {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-strike-bg relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-radial from-orange-500/5 via-transparent to-transparent" />
        <div className="absolute inset-0 pattern-grid opacity-20" />
      </div>

      {/* Content */}
      <div className="relative z-10 text-center">
        {/* Logo */}
        <div className="mb-8">
          <h1 className="font-display text-5xl text-white">
            VOXEL <span className="text-orange-500">STRIKE</span>
          </h1>
        </div>

        {/* Loading bar */}
        <div className="w-64 mx-auto">
          <div className="h-1 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full w-1/3 bg-gradient-to-r from-orange-500 to-orange-400 rounded-full animate-shimmer" />
          </div>
        </div>

        {/* Loading text */}
        <p className="mt-4 font-body text-white/40 animate-pulse-soft">
          Connecting to server...
        </p>
      </div>

      {/* Tips */}
      <div className="absolute bottom-8 left-0 right-0 text-center">
        <p className="font-body text-sm text-white/30">
          <span className="text-orange-400">TIP:</span> Use wall running and grappling to maintain momentum
        </p>
      </div>
    </div>
  );
}
