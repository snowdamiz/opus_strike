import { useEffect, useState } from 'react';
import { ABILITY_DEFINITIONS } from '@voxel-strike/shared';
import { useShallow } from 'zustand/shallow';
import { useGameStore } from '../../store/gameStore';

const PHANTOM_VEIL_DURATION_MS = (ABILITY_DEFINITIONS['phantom_veil']?.duration ?? 6) * 1000;

/**
 * UltimateEffects - Full-screen visual effects for active local ultimates.
 */
export function UltimateEffects() {
  const { ultimateEffectActive, ultimateEffectType, ultimateEffectEndTime } = useGameStore(
    useShallow((state) => ({
      ultimateEffectActive: state.ultimateEffectActive,
      ultimateEffectType: state.ultimateEffectType,
      ultimateEffectEndTime: state.ultimateEffectEndTime,
    }))
  );
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    if (!ultimateEffectActive) {
      setFadeOut(false);
      return;
    }

    const updateTimer = () => {
      const now = Date.now();
      const remaining = Math.max(0, ultimateEffectEndTime - now);
      setTimeRemaining(remaining);
      setFadeOut(remaining < 500 && remaining > 0);

      if (remaining <= 0) {
        useGameStore.getState().setUltimateEffect(false);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 50);
    return () => clearInterval(interval);
  }, [ultimateEffectActive, ultimateEffectEndTime]);

  if (!ultimateEffectActive) return null;

  if (ultimateEffectType === 'phantom_veil') {
    const progress = Math.max(0, Math.min(1, timeRemaining / PHANTOM_VEIL_DURATION_MS));
    const seconds = (timeRemaining / 1000).toFixed(1);

    return (
      <div
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none overflow-hidden"
        style={{
          opacity: fadeOut ? 0 : 1,
          transition: 'opacity 0.5s ease-out',
          zIndex: 100,
        }}
      >
        <div
          className="absolute inset-0"
          style={{
            backdropFilter: 'saturate(48%) contrast(1.22) brightness(0.78) hue-rotate(14deg)',
            WebkitBackdropFilter: 'saturate(48%) contrast(1.22) brightness(0.78) hue-rotate(14deg)',
          }}
        />

        <div
          className="absolute inset-0"
          style={{
            background: `
              radial-gradient(ellipse 44% 34% at 50% 48%, rgba(34, 211, 238, 0.06), transparent 63%),
              radial-gradient(ellipse 88% 68% at 50% 50%, transparent 30%, rgba(8, 13, 34, 0.22) 54%, rgba(3, 4, 15, 0.72) 100%),
              linear-gradient(120deg, rgba(2, 6, 23, 0.2), rgba(49, 46, 129, 0.1), rgba(2, 6, 23, 0.22))
            `,
            animation: 'phantomVeilBreath 2.5s ease-in-out infinite',
          }}
        />

        <div
          className="absolute inset-[-18%]"
          style={{
            background: `
              conic-gradient(from 32deg at 50% 50%,
                transparent 0deg,
                rgba(34, 211, 238, 0.08) 24deg,
                transparent 52deg,
                rgba(196, 181, 253, 0.1) 98deg,
                transparent 132deg,
                rgba(14, 165, 233, 0.08) 192deg,
                transparent 236deg,
                rgba(167, 139, 250, 0.09) 302deg,
                transparent 360deg
              )`,
            mixBlendMode: 'screen',
            animation: 'phantomVeilSweep 18s linear infinite',
          }}
        />

        <div
          className="absolute inset-0"
          style={{
            opacity: 0.55,
            backgroundImage: `
              repeating-linear-gradient(102deg, transparent 0 22px, rgba(34, 211, 238, 0.055) 23px, transparent 25px),
              repeating-linear-gradient(78deg, transparent 0 46px, rgba(196, 181, 253, 0.045) 47px, transparent 49px)
            `,
            maskImage: 'radial-gradient(ellipse 72% 64% at 50% 50%, transparent 26%, black 100%)',
            WebkitMaskImage: 'radial-gradient(ellipse 72% 64% at 50% 50%, transparent 26%, black 100%)',
            animation: 'phantomVeilGrid 5.5s linear infinite',
          }}
        />

        <div
          className="absolute inset-0"
          style={{
            maskImage: 'radial-gradient(ellipse 52% 42% at center, transparent 18%, black 72%)',
            WebkitMaskImage: 'radial-gradient(ellipse 52% 42% at center, transparent 18%, black 72%)',
            backdropFilter: 'blur(7px)',
            WebkitBackdropFilter: 'blur(7px)',
          }}
        />

        <div className="absolute left-1/2 top-1/2 h-28 w-28 -translate-x-1/2 -translate-y-1/2">
          <div
            className="absolute inset-5 rounded-full"
            style={{
              border: '1px solid rgba(34, 211, 238, 0.34)',
              boxShadow: '0 0 28px rgba(34, 211, 238, 0.22), inset 0 0 22px rgba(196, 181, 253, 0.1)',
              animation: 'phantomVeilReticle 1.8s ease-in-out infinite',
            }}
          />
          <div
            className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rotate-45"
            style={{
              border: '1px solid rgba(196, 181, 253, 0.32)',
              boxShadow: '0 0 18px rgba(196, 181, 253, 0.18)',
              animation: 'phantomVeilDiamond 4.8s linear infinite',
            }}
          />
          <div className="absolute left-0 top-0 h-7 w-7 border-l border-t border-cyan-200/60" />
          <div className="absolute right-0 top-0 h-7 w-7 border-r border-t border-cyan-200/60" />
          <div className="absolute bottom-0 left-0 h-7 w-7 border-b border-l border-cyan-200/60" />
          <div className="absolute bottom-0 right-0 h-7 w-7 border-b border-r border-cyan-200/60" />
          <div
            className="absolute left-1/2 top-1/2 min-w-16 -translate-x-1/2 -translate-y-1/2 text-center font-mono text-lg font-bold tabular-nums text-cyan-50"
            style={{ textShadow: '0 0 12px rgba(34, 211, 238, 0.95)' }}
          >
            {seconds}
          </div>
        </div>

        <div className="absolute bottom-10 left-1/2 h-px w-[min(42rem,72vw)] -translate-x-1/2 bg-cyan-100/10">
          <div
            className="h-full origin-left transition-[width] duration-100"
            style={{
              width: `${progress * 100}%`,
              background: 'linear-gradient(90deg, rgba(34, 211, 238, 0.95), rgba(196, 181, 253, 0.88), rgba(248, 250, 252, 0.9))',
              boxShadow: '0 0 14px rgba(34, 211, 238, 0.68)',
            }}
          />
        </div>

        <div
          className="absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(248, 250, 252, 0.24) 3px, rgba(248, 250, 252, 0.24) 4px)',
            animation: 'phantomVeilScan 0.16s linear infinite',
          }}
        />

        <style>{`
          @keyframes phantomVeilBreath {
            0%, 100% { opacity: 0.82; filter: brightness(0.94); }
            50% { opacity: 1; filter: brightness(1.08); }
          }

          @keyframes phantomVeilSweep {
            from { transform: rotate(0deg) scale(1.05); }
            to { transform: rotate(360deg) scale(1.05); }
          }

          @keyframes phantomVeilGrid {
            from { transform: translate3d(-18px, 0, 0); }
            to { transform: translate3d(18px, 0, 0); }
          }

          @keyframes phantomVeilReticle {
            0%, 100% { transform: scale(0.92); opacity: 0.72; }
            50% { transform: scale(1.08); opacity: 1; }
          }

          @keyframes phantomVeilDiamond {
            from { transform: translate(-50%, -50%) rotate(45deg); }
            to { transform: translate(-50%, -50%) rotate(405deg); }
          }

          @keyframes phantomVeilScan {
            from { transform: translateY(0); }
            to { transform: translateY(4px); }
          }
        `}</style>
      </div>
    );
  }

  return null;
}
