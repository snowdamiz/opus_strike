export function LoadingScreen() {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-voxel-darker">
      {/* Logo */}
      <div className="mb-8">
        <h1 
          className="font-display text-5xl font-black"
          style={{
            background: 'linear-gradient(135deg, #00ff88, #7c3aed)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          VOXEL STRIKE
        </h1>
      </div>

      {/* Loading bar */}
      <div className="w-64 h-1 bg-voxel-dark rounded-full overflow-hidden">
        <div 
          className="h-full w-1/2 bg-gradient-to-r from-voxel-primary to-voxel-accent loading-bar"
        />
      </div>

      {/* Loading text */}
      <p className="mt-4 font-body text-gray-400 animate-pulse">
        Connecting to server...
      </p>

      {/* Tips */}
      <div className="absolute bottom-8 left-0 right-0 text-center">
        <p className="font-body text-sm text-gray-500">
          <span className="text-voxel-primary">TIP:</span> Use wall running and grappling to maintain momentum
        </p>
      </div>
    </div>
  );
}

