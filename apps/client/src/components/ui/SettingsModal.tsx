import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ALL_HERO_IDS,
  GAMEPLAY_MODES,
  HERO_DEFINITIONS,
  getGameplayModeLabel,
  type GameplayMode,
  type HeroId,
} from '@voxel-strike/shared';
import { Download, Film, Loader2, Map as MapIcon, Timer } from 'lucide-react';
import { useAudio } from '../../hooks/useAudio';
import { config } from '../../config/environment';
import {
  defaultSettings,
  graphicsPresetSettings,
  type ClientSettings,
  type DevTutorialOverride,
  type KeybindAction,
  type StreamerFeedMode,
  useSettingsStore,
} from '../../store/settingsStore';
import { useGameStore } from '../../store/gameStore';
import { useNetwork } from '../../contexts/NetworkContext';
import { useWallet } from '../../contexts/WalletContext';
import {
  requestCreateRecordingShowcase,
  requestRecordingShowcaseJob,
  requestRecordingsIndex,
  type RecordingShowcaseJob,
} from '../../contexts/networkApi';
import { formatKeybind, mouseButtonToKeybindCode } from '../../utils/keybindings';
import { GameDialog } from './GameDialog';
import { WalletProviderOptions } from './WalletProviderOptions';

type SettingsTab = 'video' | 'audio' | 'controls' | 'gameplay' | 'account' | 'development';

interface SettingsModalProps {
  onClose: () => void;
}

const resolutionScaleOptions = [
  { value: 'minimum', label: 'Minimum' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'ultra', label: 'Ultra' },
];

const featureQualityOptions = [
  { value: 'off', label: 'Off' },
  { value: 'minimum', label: 'Minimum' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'ultra', label: 'Ultra' },
];

const fpsDisplayModeOptions = [
  { value: 'off', label: 'Off' },
  { value: 'fps', label: 'FPS' },
];

const graphicsPresetOptions = [
  { value: 'potato', label: 'Potato' },
  { value: 'competitive', label: 'Competitive' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'cinematic', label: 'Cinematic' },
];

const devTutorialOverrideOptions = [
  { value: 'account', label: 'Account Status' },
  { value: 'bypass', label: 'Bypass Tutorial' },
  { value: 'force', label: 'Force Tutorial' },
];

const streamerFeedModeOptions = [
  { value: 'random', label: 'Random Matches' },
  { value: 'bot_deathmatch', label: 'Bot Deathmatch' },
];

const recordingHeroOptions = ALL_HERO_IDS.map((heroId) => ({
  value: heroId,
  label: HERO_DEFINITIONS[heroId].name,
}));

const recordingGameplayModeOptions = GAMEPLAY_MODES.map((mode) => ({
  value: mode,
  label: getGameplayModeLabel(mode),
}));

const keybindRows: { action: KeybindAction; label: string }[] = [
  { action: 'moveForward', label: 'Move Forward' },
  { action: 'moveBackward', label: 'Move Back' },
  { action: 'moveLeft', label: 'Move Left' },
  { action: 'moveRight', label: 'Move Right' },
  { action: 'jump', label: 'Jump' },
  { action: 'crouch', label: 'Crouch' },
  { action: 'sprint', label: 'Sprint' },
  { action: 'primaryFire', label: 'Primary Fire' },
  { action: 'secondaryFire', label: 'Secondary Fire' },
  { action: 'reload', label: 'Reload' },
  { action: 'ability1', label: 'Ability 1' },
  { action: 'ability2', label: 'Ability 2' },
  { action: 'ultimate', label: 'Ultimate' },
  { action: 'interact', label: 'Interact' },
  { action: 'scoreboard', label: 'Scoreboard' },
  { action: 'pushToTalk', label: 'Push To Talk' },
  { action: 'ping', label: 'Ping' },
];

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('video');
  const savedSettings = useSettingsStore(state => state.settings);
  const applySettings = useSettingsStore(state => state.applySettings);
  const gamePlayerName = useGameStore(state => state.playerName);
  const setGameUser = useGameStore(state => state.setUser);
  const setGameWalletAddress = useGameStore(state => state.setWalletAddress);
  const { startDevTestingMap } = useNetwork();
  const {
    isAuthenticated,
    isConnecting,
    isSessionLoading,
    logout,
    linkDiscord,
    linkWallet,
    user,
    walletProviders,
    walletAddress,
    linkedAccounts,
    hasWalletAccount,
    error: authError,
    notice,
  } = useWallet();
  const [settings, setSettings] = useState<ClientSettings>(savedSettings);
  const [hasChanges, setHasChanges] = useState(false);
  const [rebindingAction, setRebindingAction] = useState<KeybindAction | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isLinkingWallet, setIsLinkingWallet] = useState(false);
  const [recordingHeroId, setRecordingHeroId] = useState<HeroId>('blaze');
  const [recordingGameplayMode, setRecordingGameplayMode] = useState<GameplayMode>('team_deathmatch');
  const [recordingJob, setRecordingJob] = useState<RecordingShowcaseJob | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [isStartingRecording, setIsStartingRecording] = useState(false);
  const [isDownloadingRecording, setIsDownloadingRecording] = useState(false);
  const [recordingNowMs, setRecordingNowMs] = useState(() => Date.now());
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const { updateSettings: applyAudioSettings } = useAudio();

  const displayName = user?.name || gamePlayerName || 'Unknown';
  const displayWalletAddress = user?.walletAddress ?? walletAddress;
  const discordAccount = linkedAccounts.find((account) => account.provider === 'discord') ?? null;
  const accountInitial = displayName.charAt(0).toUpperCase();
  const hasAccount = isAuthenticated && Boolean(user);
  const isGameAdmin = user?.isGameAdmin === true;
  const showDevelopmentSettings = config.isDev;
  const isRecordingActive = recordingJob?.status === 'recording' || recordingJob?.status === 'rendering';
  const isRecordingBusy = isStartingRecording || isRecordingActive;
  const recordingWaitLabel = recordingJob ? formatRecordingWaitRemaining(recordingJob, recordingNowMs) : null;

  const updateSetting = <K extends keyof ClientSettings>(key: K, value: ClientSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const updateGraphicsPreset = (preset: ClientSettings['graphicsPreset']) => {
    setSettings(prev => ({
      ...prev,
      graphicsPreset: preset,
      ...graphicsPresetSettings[preset],
    }));
    setHasChanges(true);
  };

  const handleSave = () => {
    applySettings(settings);
    applyAudioSettings(settings);
    setHasChanges(false);
  };

  const handleReset = () => {
    setSettings(defaultSettings);
    setRebindingAction(null);
    setHasChanges(true);
  };

  const handleSignOut = async () => {
    if (isSigningOut) return;

    setIsSigningOut(true);
    try {
      await logout();
      setGameUser(null, '', null);
      setGameWalletAddress(null);
    } finally {
      setIsSigningOut(false);
    }
  };

  const handleLinkDiscord = () => {
    if (!hasAccount || discordAccount) return;
    linkDiscord();
  };

  const handleLinkWallet = async (providerId?: string) => {
    if (!hasAccount || hasWalletAccount || isLinkingWallet) return;

    setIsLinkingWallet(true);
    try {
      const linkedUser = await linkWallet(providerId);
      setGameUser(linkedUser.id, linkedUser.name, linkedUser.stats);
      setGameWalletAddress(linkedUser.walletAddress ?? null);
    } catch {
      // The auth context owns the user-facing error message.
    } finally {
      setIsLinkingWallet(false);
    }
  };

  const handleStartDevTestingMap = () => {
    startDevTestingMap(displayName);
    onClose();
  };

  const handleStartShowcaseRecording = async () => {
    if (!isGameAdmin || isRecordingBusy) return;

    setIsStartingRecording(true);
    setRecordingError(null);
    try {
      const recordings = await requestRecordingsIndex();
      const response = await requestCreateRecordingShowcase({
        csrfToken: recordings.csrfToken,
        heroId: recordingHeroId,
        gameplayMode: recordingGameplayMode,
      });
      setRecordingJob(response.job);
      setRecordingError(response.job.status === 'failed' ? response.job.error : null);
    } catch (error) {
      setRecordingError(error instanceof Error ? error.message : 'Failed to start showcase recording');
    } finally {
      setIsStartingRecording(false);
    }
  };

  const handleDownloadShowcaseRecording = async () => {
    if (!recordingJob?.downloadUrl || isDownloadingRecording) return;

    setIsDownloadingRecording(true);
    setRecordingError(null);
    try {
      const response = await fetch(`${config.serverHttpUrl}${recordingJob.downloadUrl}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? 'Failed to download recording');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${recordingJob.recordingId}.mp4`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (error) {
      setRecordingError(error instanceof Error ? error.message : 'Failed to download recording');
    } finally {
      setIsDownloadingRecording(false);
    }
  };

  const updateKeybinding = useCallback((action: KeybindAction, code: string) => {
    setSettings((prev) => {
      const nextKeybindings = { ...prev.keybindings };
      const previousCode = nextKeybindings[action];
      const conflictingRow = keybindRows.find((row) => (
        row.action !== action && nextKeybindings[row.action] === code
      ));

      nextKeybindings[action] = code;
      if (conflictingRow) {
        nextKeybindings[conflictingRow.action] = previousCode;
      }

      return {
        ...prev,
        keybindings: nextKeybindings,
      };
    });
    setHasChanges(true);
    setRebindingAction(null);
  }, []);

  useEffect(() => {
    if (activeTab !== 'audio' || typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      return;
    }

    let cancelled = false;
    const refreshDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        setAudioInputs(devices.filter((device) => device.kind === 'audioinput'));
        setAudioOutputs(devices.filter((device) => device.kind === 'audiooutput'));
      } catch {
        if (!cancelled) {
          setAudioInputs([]);
          setAudioOutputs([]);
        }
      }
    };

    void refreshDevices();
    navigator.mediaDevices.addEventListener?.('devicechange', refreshDevices);

    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener?.('devicechange', refreshDevices);
    };
  }, [activeTab]);

  useEffect(() => {
    if (!recordingJob || recordingJob.status === 'succeeded' || recordingJob.status === 'failed') return;

    let cancelled = false;
    const refreshJob = async () => {
      try {
        const response = await requestRecordingShowcaseJob(recordingJob.id);
        if (!cancelled) {
          setRecordingJob(response.job);
          setRecordingError(response.job.status === 'failed' ? response.job.error : null);
        }
      } catch (error) {
        if (!cancelled) {
          setRecordingError(error instanceof Error ? error.message : 'Failed to refresh showcase recording');
        }
      }
    };

    const intervalId = window.setInterval(() => {
      void refreshJob();
    }, 2_500);
    void refreshJob();

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [recordingJob?.id, recordingJob?.status]);

  useEffect(() => {
    if (!isRecordingActive) return;

    setRecordingNowMs(Date.now());
    const intervalId = window.setInterval(() => {
      setRecordingNowMs(Date.now());
    }, 1_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isRecordingActive, recordingJob?.id]);

  useEffect(() => {
    if (!rebindingAction) return;
    document.body.dataset.rebindingKeybind = 'true';

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.code === 'Escape') {
        setRebindingAction(null);
        return;
      }

      updateKeybinding(rebindingAction, event.code);
    };

    const handleMouseDown = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      updateKeybinding(rebindingAction, mouseButtonToKeybindCode(event.button));
    };

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('mousedown', handleMouseDown, true);
    window.addEventListener('contextmenu', handleContextMenu, true);

    return () => {
      delete document.body.dataset.rebindingKeybind;
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('mousedown', handleMouseDown, true);
      window.removeEventListener('contextmenu', handleContextMenu, true);
    };
  }, [rebindingAction, updateKeybinding]);

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { 
      id: 'video', 
      label: 'Video',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      )
    },
    { 
      id: 'audio', 
      label: 'Audio',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
        </svg>
      )
    },
    { 
      id: 'controls', 
      label: 'Controls',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
        </svg>
      )
    },
    { 
      id: 'gameplay', 
      label: 'Gameplay',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    },
    {
      id: 'account',
      label: 'Account',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.5 20.25a8.25 8.25 0 0115 0" />
        </svg>
      )
    },
  ];

  if (showDevelopmentSettings) {
    tabs.push({
      id: 'development',
      label: 'Dev',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 9l-3 3 3 3m8-6l3 3-3 3M13.5 5l-3 14" />
        </svg>
      ),
    });
  }

  const inputDeviceOptions = [
    { value: '', label: 'Default Input' },
    ...audioInputs.map((device, index) => ({
      value: device.deviceId,
      label: device.label || `Microphone ${index + 1}`,
    })),
  ];

  const outputDeviceOptions = [
    { value: '', label: 'Default Output' },
    ...audioOutputs.map((device, index) => ({
      value: device.deviceId,
      label: device.label || `Speaker ${index + 1}`,
    })),
  ];

  return (
    <GameDialog
      title="SETTINGS"
      icon={(
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      )}
      size="xl"
      onClose={onClose}
      panelClassName="settings-dialog-panel h-[min(70vh,40rem)]"
      bodyClassName="settings-dialog-body flex-1 flex overflow-hidden min-h-0"
      footerClassName="settings-dialog-footer flex items-center justify-between gap-3 px-[clamp(1.125rem,1.45vw,1.5rem)] py-[clamp(0.75rem,1vw,1rem)] border-t border-white/5 bg-strike-elevated/50"
      footer={(
        <>
          <button
            onClick={handleReset}
            className="px-3.5 py-2 rounded-lg text-xs text-white/50 font-display hover:text-white hover:bg-white/5 "
          >
            RESET DEFAULTS
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-[1.125rem] py-2 rounded-lg bg-white/5 text-xs text-white/70 font-display hover:bg-white/10 hover:text-white "
            >
              CANCEL
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges}
              className={`px-[1.125rem] py-2 rounded-lg text-xs font-display ${
                hasChanges
                  ? 'bg-orange-500 text-white hover:bg-orange-400'
                  : 'bg-white/5 text-white/30 cursor-not-allowed'
              }`}
            >
              SAVE CHANGES
            </button>
          </div>
        </>
      )}
    >
          {/* Sidebar */}
          <div className="settings-tab-list w-32 lg:w-40 xl:w-48 shrink-0 border-r border-white/5 p-2.5 lg:p-3 space-y-1.5">
            {tabs.map((tab) => (
 <button
 key={tab.id}
 onClick={() => setActiveTab(tab.id)}
 className={`settings-tab-button w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg font-display text-xs focus:outline-none focus-visible:ring-1 focus-visible:ring-orange-400/70 [&_svg]:h-[1rem] [&_svg]:w-[1rem] ${
 activeTab === tab.id
 ? 'bg-orange-500/20 text-orange-400'
 : 'text-white/50 hover:text-white hover:bg-white/5'
 }`}
 >
 {tab.icon}
 {tab.label.toUpperCase()}
 </button>
            ))}
          </div>

          {/* Settings Content */}
          <div className="settings-dialog-content flex-1 p-[clamp(1.125rem,1.6vw,1.65rem)] overflow-y-auto custom-scrollbar">
            {activeTab === 'video' && (
              <div className="space-y-4">
                <SettingRow label="Graphics Preset" description="Applies a complete video profile">
                  <SelectInput
                    value={settings.graphicsPreset}
                    onChange={(v) => updateGraphicsPreset(v as ClientSettings['graphicsPreset'])}
                    options={graphicsPresetOptions}
                  />
                </SettingRow>

                <SettingRow label="Resolution Scale" description="Internal render resolution">
                  <SelectInput
                    value={settings.resolutionScale}
                    onChange={(v) => updateSetting('resolutionScale', v as ClientSettings['resolutionScale'])}
                    options={resolutionScaleOptions}
                  />
                </SettingRow>

                <SettingRow label="Anti-Aliasing" description="Smooth jagged geometry edges">
                  <ToggleInput
                    value={settings.antialiasing}
                    onChange={(v) => updateSetting('antialiasing', v)}
                  />
                </SettingRow>

                <SettingRow label="Shadow Quality" description="Shadow map resolution and soft filtering">
                  <SelectInput
                    value={settings.shadowQuality}
                    onChange={(v) => updateSetting('shadowQuality', v as ClientSettings['shadowQuality'])}
                    options={featureQualityOptions}
                  />
                </SettingRow>

                <SettingRow label="Reflections" description="Generated environment reflections for metal and glass">
                  <SelectInput
                    value={settings.reflectionQuality}
                    onChange={(v) => updateSetting('reflectionQuality', v as ClientSettings['reflectionQuality'])}
                    options={featureQualityOptions}
                  />
                </SettingRow>

                <SettingRow label="Materials" description="Terrain texture detail and material variation">
                  <SelectInput
                    value={settings.materialQuality}
                    onChange={(v) => updateSetting('materialQuality', v as ClientSettings['materialQuality'])}
                    options={featureQualityOptions}
                  />
                </SettingRow>

                <SettingRow label="Environment Detail" description="Weather particles and procedural dressing density">
                  <SelectInput
                    value={settings.environmentQuality}
                    onChange={(v) => updateSetting('environmentQuality', v as ClientSettings['environmentQuality'])}
                    options={featureQualityOptions}
                  />
                </SettingRow>

                <SettingRow label="Field of View" description={`${settings.fov}°`}>
                  <SliderInput
                    value={settings.fov}
                    onChange={(v) => updateSetting('fov', v)}
                    min={60}
                    max={120}
                    step={1}
                  />
                </SettingRow>

                <SettingRow label="Show FPS" description="Display frame rate counter">
                  <SelectInput
                    value={settings.showFPS}
                    onChange={(v) => updateSetting('showFPS', v as ClientSettings['showFPS'])}
                    options={fpsDisplayModeOptions}
                  />
                </SettingRow>
              </div>
            )}

            {activeTab === 'audio' && (
              <div className="space-y-4">
                <SettingRow label="Master Volume" description={`${settings.masterVolume}%`}>
                  <SliderInput
                    value={settings.masterVolume}
                    onChange={(v) => updateSetting('masterVolume', v)}
                    min={0}
                    max={100}
                    step={1}
                  />
                </SettingRow>

                <SettingRow label="Sound Effects" description={`${settings.sfxVolume}%`}>
                  <SliderInput
                    value={settings.sfxVolume}
                    onChange={(v) => updateSetting('sfxVolume', v)}
                    min={0}
                    max={100}
                    step={1}
                  />
                </SettingRow>

                <SettingRow label="Music" description={`${settings.musicVolume}%`}>
                  <SliderInput
                    value={settings.musicVolume}
                    onChange={(v) => updateSetting('musicVolume', v)}
                    min={0}
                    max={100}
                    step={1}
                  />
                </SettingRow>

                <div className="pt-3 border-t border-white/5" />

                <SettingRow label="Team Voice" description="Enable match voice connection">
                  <ToggleInput
                    value={settings.voiceEnabled}
                    onChange={(v) => updateSetting('voiceEnabled', v)}
                  />
                </SettingRow>

                <SettingRow label="Voice Volume" description={`${settings.voiceVolume}%`}>
                  <SliderInput
                    value={settings.voiceVolume}
                    onChange={(v) => updateSetting('voiceVolume', v)}
                    min={0}
                    max={100}
                    step={1}
                  />
                </SettingRow>

                <SettingRow label="Microphone Gain" description={`${settings.micVolume}%`}>
                  <SliderInput
                    value={settings.micVolume}
                    onChange={(v) => updateSetting('micVolume', v)}
                    min={0}
                    max={100}
                    step={1}
                  />
                </SettingRow>

                <SettingRow label="Input Device" description="Microphone used for team voice">
                  <SelectInput
                    value={settings.voiceInputDeviceId}
                    onChange={(v) => updateSetting('voiceInputDeviceId', v)}
                    options={inputDeviceOptions}
                  />
                </SettingRow>

                <SettingRow label="Output Device" description="Speaker used for teammate voice">
                  <SelectInput
                    value={settings.voiceOutputDeviceId}
                    onChange={(v) => updateSetting('voiceOutputDeviceId', v)}
                    options={outputDeviceOptions}
                  />
                </SettingRow>

                <SettingRow label="Noise Suppression" description="Reduce background microphone noise">
                  <ToggleInput
                    value={settings.noiseSuppressionEnabled}
                    onChange={(v) => updateSetting('noiseSuppressionEnabled', v)}
                  />
                </SettingRow>

                <SettingRow label="Echo Cancellation" description="Prevent speaker audio feeding into mic">
                  <ToggleInput
                    value={settings.echoCancellationEnabled}
                    onChange={(v) => updateSetting('echoCancellationEnabled', v)}
                  />
                </SettingRow>

                <SettingRow label="Auto Gain Control" description="Stabilize microphone level">
                  <ToggleInput
                    value={settings.autoGainControlEnabled}
                    onChange={(v) => updateSetting('autoGainControlEnabled', v)}
                  />
                </SettingRow>

              </div>
            )}

            {activeTab === 'controls' && (
              <div className="space-y-4">
                <SettingRow label="Mouse Sensitivity" description="Adjust look sensitivity">
                  <SliderInput
                    value={settings.sensitivity}
                    onChange={(v) => updateSetting('sensitivity', v)}
                    min={1}
                    max={100}
                    step={1}
                  />
                </SettingRow>

                <SettingRow label="Invert Y-Axis" description="Invert vertical look direction">
                  <ToggleInput
                    value={settings.invertY}
                    onChange={(v) => updateSetting('invertY', v)}
                  />
                </SettingRow>

                <SettingRow label="Toggle Crouch" description="Press to toggle crouch instead of hold">
                  <ToggleInput
                    value={settings.toggleCrouch}
                    onChange={(v) => updateSetting('toggleCrouch', v)}
                  />
                </SettingRow>

                <SettingRow label="Toggle Sprint" description="Press to toggle sprint instead of hold">
                  <ToggleInput
                    value={settings.toggleSprint}
                    onChange={(v) => updateSetting('toggleSprint', v)}
                  />
                </SettingRow>

                {/* Keybinds */}
                <div className="pt-4 border-t border-white/5">
                  <h3 className="font-display text-base text-white mb-4">KEYBINDS</h3>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
                    {keybindRows.map((bind) => (
                      <div key={bind.action} className="settings-keybind-row flex items-center justify-between gap-3 px-3.5 py-2 rounded bg-white/5">
                        <span className="text-white/60 font-body text-sm">{bind.label}</span>
                        <button
                          type="button"
                          onClick={() => setRebindingAction(bind.action)}
                          aria-pressed={rebindingAction === bind.action}
                          aria-label={`Rebind ${bind.label}`}
                          className={`w-24 h-8 px-2.5 rounded border text-center font-mono text-xs transition-colors ${
                            rebindingAction === bind.action
                              ? 'border-orange-300 bg-orange-500/30 text-orange-100'
                              : 'border-white/10 bg-white/10 text-white hover:border-white/25 hover:bg-white/15'
                          }`}
                        >
                          {rebindingAction === bind.action
                            ? 'LISTENING'
                            : formatKeybind(settings.keybindings[bind.action])}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'gameplay' && (
              <div className="space-y-4">
                <SettingRow label="HUD" description="Show the in-game HUD">
                  <ToggleInput
                    value={settings.showHUD}
                    onChange={(v) => updateSetting('showHUD', v)}
                  />
                </SettingRow>

                <SettingRow label="Damage Numbers" description="Show damage dealt on hit">
                  <ToggleInput
                    value={settings.showDamageNumbers}
                    onChange={(v) => updateSetting('showDamageNumbers', v)}
                  />
                </SettingRow>

                <SettingRow label="Kill Feed" description="Show kills and deaths in corner">
                  <ToggleInput
                    value={settings.showKillFeed}
                    onChange={(v) => updateSetting('showKillFeed', v)}
                  />
                </SettingRow>

                {isGameAdmin && (
                  <>
                    <SettingRow label="Streamer Mode" description="Cinematic admin observer feed">
                      <ToggleInput
                        value={settings.streamerModeEnabled}
                        onChange={(v) => updateSetting('streamerModeEnabled', v)}
                      />
                    </SettingRow>

                    <SettingRow label="Streamer Feed" description="Choose the admin observer source">
                      <SelectInput
                        value={settings.streamerFeedMode}
                        onChange={(v) => updateSetting('streamerFeedMode', v as StreamerFeedMode)}
                        options={streamerFeedModeOptions}
                      />
                    </SettingRow>

                    <div className="pt-3 border-t border-white/5" />

                    <SettingRow label="Recording Hero" description="Featured bot for the server recording">
                      <SelectInput
                        value={recordingHeroId}
                        onChange={(v) => setRecordingHeroId(v as HeroId)}
                        options={recordingHeroOptions}
                      />
                    </SettingRow>

                    <SettingRow label="Recording Mode" description="Random lobby mode for the capture">
                      <SelectInput
                        value={recordingGameplayMode}
                        onChange={(v) => setRecordingGameplayMode(v as GameplayMode)}
                        options={recordingGameplayModeOptions}
                      />
                    </SettingRow>

                    <SettingRow
                      label="Showcase Recording"
                      description={recordingJob ? formatRecordingJobStatus(recordingJob, recordingNowMs) : 'Server captures and renders 5 minutes'}
                    >
                      <div className="flex items-center gap-2">
                        {recordingWaitLabel && (
                          <span className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 font-mono text-[11px] tabular-nums text-white/65">
                            <Timer className="h-3.5 w-3.5 text-orange-200/80" aria-hidden="true" />
                            {recordingWaitLabel}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={handleStartShowcaseRecording}
                          disabled={isRecordingBusy}
                          className={`flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border px-3.5 font-display text-xs transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-orange-300/70 ${
                            isRecordingBusy
                              ? 'border-white/10 bg-white/5 text-white/35 cursor-not-allowed'
                              : 'border-orange-300/25 bg-orange-500/15 text-orange-100 hover:border-orange-200/45 hover:bg-orange-500/25'
                          }`}
                        >
                          {isRecordingBusy ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <Film className="h-4 w-4" aria-hidden="true" />
                          )}
                          {isRecordingBusy ? 'RUNNING' : 'CREATE'}
                        </button>

                        {recordingJob?.status === 'succeeded' && recordingJob.downloadUrl && (
                          <button
                            type="button"
                            onClick={handleDownloadShowcaseRecording}
                            disabled={isDownloadingRecording}
                            aria-label="Download showcase recording"
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-300/70 ${
                              isDownloadingRecording
                                ? 'border-white/10 bg-white/5 text-white/35 cursor-not-allowed'
                                : 'border-cyan-300/25 bg-cyan-500/15 text-cyan-100 hover:border-cyan-200/45 hover:bg-cyan-500/25'
                            }`}
                          >
                            {isDownloadingRecording ? (
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            ) : (
                              <Download className="h-4 w-4" aria-hidden="true" />
                            )}
                          </button>
                        )}
                      </div>
                    </SettingRow>

                    {recordingError && (
                      <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2">
                        <p className="text-red-300 text-xs font-body">{recordingError}</p>
                      </div>
                    )}
                  </>
                )}

                <SettingRow label="Crosshair Style" description="Choose your crosshair appearance">
                  <SelectInput
                    value={settings.crosshairStyle}
                    onChange={(v) => updateSetting('crosshairStyle', v as ClientSettings['crosshairStyle'])}
                    options={[
                      { value: 'default', label: 'Default' },
                      { value: 'dot', label: 'Dot' },
                      { value: 'circle', label: 'Circle' },
                      { value: 'cross', label: 'Cross' },
                    ]}
                  />
                </SettingRow>

                <SettingRow label="Crosshair Color" description="Customize crosshair color">
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={settings.crosshairColor}
                      onChange={(e) => updateSetting('crosshairColor', e.target.value)}
                      className="w-10 h-10 rounded cursor-pointer bg-transparent border-0"
                    />
                    <span className="text-white/50 font-mono text-sm">{settings.crosshairColor}</span>
                  </div>
                </SettingRow>
              </div>
            )}

            {showDevelopmentSettings && activeTab === 'development' && (
              <div className="space-y-4">
                <SettingRow label="Tutorial Gate" description="Local development account gating">
                  <SelectInput
                    value={settings.devTutorialOverride}
                    onChange={(v) => updateSetting('devTutorialOverride', v as DevTutorialOverride)}
                    options={devTutorialOverrideOptions}
                  />
                </SettingRow>

                <SettingRow label="Testing Map" description="Local target range and hero switch lineup">
                  <button
                    type="button"
                    onClick={handleStartDevTestingMap}
                    className="flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-cyan-300/20 bg-cyan-500/15 px-3.5 font-display text-xs text-cyan-100 transition-colors hover:border-cyan-200/40 hover:bg-cyan-500/25 focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-300/70"
                  >
                    <MapIcon className="h-4 w-4" aria-hidden="true" />
                    START
                  </button>
                </SettingRow>
              </div>
            )}

            {activeTab === 'account' && (
              <div className="space-y-1">
                {hasAccount && !hasWalletAccount && (
                  <div className="mb-2 rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2">
                    <p className="text-amber-200 text-xs font-body">
                      A wallet is required for ranked. Connect one before entering ranked games.
                    </p>
                  </div>
                )}

                {notice && (
                  <div className="mb-2 rounded-lg border border-green-500/20 bg-green-500/10 px-3 py-2">
                    <p className="text-green-300 text-xs font-body">{notice}</p>
                  </div>
                )}

                {authError && (
                  <div className="mb-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2">
                    <p className="text-red-300 text-xs font-body">{authError}</p>
                  </div>
                )}

                <SettingRow
                  label="Player"
                  description={hasAccount ? 'Currently signed in' : isSessionLoading ? 'Checking saved session' : 'No active account'}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className={`w-10 h-10 shrink-0 rounded-lg flex items-center justify-center font-display text-base ${
                      hasAccount ? 'bg-orange-500/20 text-orange-300' : 'bg-white/5 text-white/35'
                    }`}>
                      {hasAccount ? accountInitial : (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.5 10.5V6.75a4.5 4.5 0 00-9 0v3.75m-.75 10.5h10.5a2.25 2.25 0 002.25-2.25v-6a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 12.75v6A2.25 2.25 0 006.75 21z" />
                        </svg>
                      )}
                    </div>
                    <span className="max-w-44 truncate font-display text-sm text-white">
                      {hasAccount ? displayName : 'SIGNED OUT'}
                    </span>
                  </div>
                </SettingRow>

                <SettingRow label="Restricted Modes" description={hasWalletAccount ? 'Wallet linked; token hold checked on queue' : 'Wallet required for ranked'}>
                  <AccountValue value={hasWalletAccount ? 'WALLET LINKED' : hasAccount ? 'WALLET NEEDED' : 'SIGNED OUT'} />
                </SettingRow>

                <SettingRow label="Discord" description={discordAccount ? 'Connected login provider' : 'Link Discord to this profile'}>
                  {discordAccount ? (
                    <AccountValue value={discordAccount.displayName || 'CONNECTED'} />
                  ) : (
                    <button
                      type="button"
                      onClick={handleLinkDiscord}
                      disabled={!hasAccount}
                      className={`h-9 px-3.5 rounded-lg font-display text-xs flex shrink-0 items-center justify-center border focus:outline-none focus-visible:ring-1 focus-visible:ring-indigo-300/70 ${
                        hasAccount
                          ? 'border-indigo-300/20 bg-indigo-500/15 text-indigo-100 hover:border-indigo-200/40 hover:bg-indigo-500/25'
                          : 'border-white/10 bg-white/5 text-white/25 cursor-not-allowed'
                      }`}
                    >
                      CONNECT
                    </button>
                  )}
                </SettingRow>

                <SettingRow label="Wallet" description={hasWalletAccount ? 'Connected wallet provider' : 'Required for ranked'}>
                  {hasWalletAccount ? (
                    <AccountValue value={formatAccountAddress(displayWalletAddress)} />
                  ) : (
                    <WalletProviderOptions
                      walletProviders={walletProviders}
                      isConnecting={isLinkingWallet || isConnecting}
                      onSelect={handleLinkWallet}
                      disabled={!hasAccount}
                      className="settings-wallet-options"
                      buttonClassName="settings-wallet-option"
                      iconClassName="settings-wallet-icon"
                      logoClassName="settings-wallet-logo"
                      showLabels={false}
                      showSpinner={false}
                    />
                  )}
                </SettingRow>

                <SettingRow label="Sign Out" description="End this app session">
                  <button
                    type="button"
                    onClick={handleSignOut}
                    disabled={!hasAccount || isSigningOut}
                    className={`h-9 px-3.5 rounded-lg font-display text-xs flex shrink-0 items-center justify-center gap-2 border focus:outline-none focus-visible:ring-1 focus-visible:ring-red-300/70 ${
                      hasAccount
                        ? 'border-red-400/20 bg-red-500/10 text-red-200 hover:border-red-300/40 hover:bg-red-500/15'
                        : 'border-white/10 bg-white/5 text-white/25 cursor-not-allowed'
                    }`}
                  >
                    {isSigningOut ? (
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                      </svg>
                    )}
                    {isSigningOut ? 'SIGNING OUT' : 'SIGN OUT'}
                  </button>
                </SettingRow>
              </div>
            )}
          </div>
    </GameDialog>
  );
}

function formatAccountAddress(address: string | null | undefined): string {
  if (!address) return 'UNLINKED';
  if (address.length <= 14) return address;
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}

function readRecordingStartMs(job: RecordingShowcaseJob): number {
  const startedAt = Date.parse(job.recordingStartedAt ?? job.createdAt);
  if (Number.isFinite(startedAt)) return startedAt;
  const createdAt = Date.parse(job.createdAt);
  return Number.isFinite(createdAt) ? createdAt : Date.now();
}

function formatDurationClock(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(durationMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatRecordingWaitRemaining(job: RecordingShowcaseJob, nowMs: number): string | null {
  if (job.status !== 'recording') return null;
  const elapsedMs = Math.max(0, nowMs - readRecordingStartMs(job));
  const remainingMs = Math.max(0, job.recordingDurationMs - elapsedMs);
  return `${formatDurationClock(remainingMs)} left`;
}

function formatRecordingJobStatus(job: RecordingShowcaseJob, nowMs: number): string {
  if (job.status === 'succeeded') return 'Ready to download';
  if (job.status === 'failed') return 'Recording failed';
  if (job.status === 'rendering') return 'Rendering MP4 on server';
  const remaining = formatRecordingWaitRemaining(job, nowMs);
  return remaining
    ? `Recording random lobby on server - ${remaining} before render`
    : 'Recording random lobby on server';
}

function AccountValue({ value }: { value: string }) {
  return (
    <span className="settings-account-value block max-w-[17rem] truncate rounded-lg border border-white/10 bg-white/[0.07] px-3.5 py-2 font-mono text-xs text-white/70">
      {value}
    </span>
  );
}

// Setting Row Component
function SettingRow({ label, description, children }: { 
  label: string; 
  description: string; 
  children: React.ReactNode;
}) {
  return (
    <div className="settings-row flex items-center justify-between gap-6 py-3">
      <div className="settings-row-copy min-w-0">
        <h4 className="font-display text-sm text-white">{label}</h4>
        <p className="text-white/40 text-xs font-body mt-0.5">{description}</p>
      </div>
      <div className="settings-row-control shrink-0">{children}</div>
    </div>
  );
}

// Toggle Input Component
function ToggleInput({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  return (
 <button
 onClick={() => onChange(!value)}
	 className={`settings-toggle w-12 h-6 rounded-full relative ${
	 value ? 'bg-orange-500' : 'bg-white/20'
	 }`}
	 >
	 <div
	 className={`settings-toggle-knob absolute top-1 w-4 h-4 rounded-full bg-white ${
	 value ? 'left-7' : 'left-1'
	 }`}
 />
 </button>
  );
}

// Slider Input Component
function SliderInput({ value, onChange, min, max, step }: { 
  value: number; 
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  const percent = ((value - min) / (max - min)) * 100;
  
  return (
    <div className="settings-slider w-[10.5rem] xl:w-48 flex items-center gap-3">
      <input
        type="range"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step}
        className="settings-slider-input flex-1 h-1.5 rounded-full appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, rgb(var(--color-accent-primary)) 0%, rgb(var(--color-accent-primary)) ${percent}%, rgba(255,255,255,0.2) ${percent}%, rgba(255,255,255,0.2) 100%)`,
        }}
      />
      <span className="settings-slider-value w-9 text-right text-white/60 font-mono text-xs">{value}</span>
    </div>
  );
}

// Select Input Component
function SelectInput({ value, onChange, options }: { 
  value: string; 
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedOption = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape') {
      setIsOpen(false);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setIsOpen((open) => !open);
      return;
    }

    const currentIndex = options.findIndex((option) => option.value === value);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex = (currentIndex + direction + options.length) % options.length;
      onChange(options[nextIndex].value);
    }
  };

  return (
    <div ref={containerRef} className="settings-select relative min-w-36">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className="settings-select-button w-full h-10 px-3.5 rounded-lg bg-white/[0.07] border border-white/10 text-sm text-white font-body cursor-pointer focus:outline-none focus:border-orange-500/80 hover:border-white/20 hover:bg-white/[0.1] flex items-center justify-between gap-3"
      >
        <span>{selectedOption.label}</span>
        <svg
          className={`w-4 h-4 text-white/50 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div
          role="listbox"
          className="settings-select-menu absolute right-0 top-12 z-50 w-full overflow-hidden rounded-lg border border-white/15 bg-strike-elevated/95 shadow-2xl backdrop-blur-md"
        >
          {options.map((option) => {
            const isSelected = option.value === value;

            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={`settings-select-option w-full px-3.5 py-2.5 text-left text-sm font-body flex items-center gap-2 hover:bg-white/10 ${
                  isSelected ? 'text-orange-300 bg-orange-500/15' : 'text-white/70'
                }`}
              >
                <span className="w-4 text-orange-300">
                  {isSelected && (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </span>
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
