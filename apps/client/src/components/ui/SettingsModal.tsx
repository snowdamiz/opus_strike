import { useState } from 'react';
import { useAudio } from '../../hooks/useAudio';

type SettingsTab = 'video' | 'audio' | 'controls' | 'gameplay';

interface Settings {
  // Video
  quality: 'low' | 'medium' | 'high' | 'ultra';
  fov: number;
  vsync: boolean;
  showFPS: boolean;
  
  // Audio
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  voiceVolume: number;
  
  // Controls
  sensitivity: number;
  invertY: boolean;
  toggleCrouch: boolean;
  toggleSprint: boolean;
  
  // Gameplay
  showDamageNumbers: boolean;
  showKillFeed: boolean;
  crosshairStyle: 'default' | 'dot' | 'circle' | 'cross';
  crosshairColor: string;
}

const defaultSettings: Settings = {
  quality: 'high',
  fov: 90,
  vsync: false,
  showFPS: false,
  masterVolume: 80,
  sfxVolume: 100,
  musicVolume: 50,
  voiceVolume: 100,
  sensitivity: 50,
  invertY: false,
  toggleCrouch: false,
  toggleSprint: false,
  showDamageNumbers: true,
  showKillFeed: true,
  crosshairStyle: 'default',
  crosshairColor: '#ffffff',
};

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('video');
  const [settings, setSettings] = useState<Settings>(() => {
    const saved = localStorage.getItem('voxel-strike-settings');
    return saved ? { ...defaultSettings, ...JSON.parse(saved) } : defaultSettings;
  });
  const [hasChanges, setHasChanges] = useState(false);
  const { updateSettings: applyAudioSettings } = useAudio();

  const updateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleSave = () => {
    localStorage.setItem('voxel-strike-settings', JSON.stringify(settings));
    // Apply audio settings immediately
    applyAudioSettings();
    setHasChanges(false);
  };

  const handleReset = () => {
    setSettings(defaultSettings);
    setHasChanges(true);
  };

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
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-4xl max-h-[85vh] mx-4 flex flex-col bg-strike-surface border border-white/10 rounded-xl overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div>
              <h2 className="font-display text-2xl text-white">SETTINGS</h2>
              <p className="text-white/40 text-sm font-body">Configure your game experience</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar */}
          <div className="w-48 border-r border-white/5 p-3 space-y-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-display text-sm transition-all ${
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
          <div className="flex-1 p-6 overflow-y-auto">
            {activeTab === 'video' && (
              <div className="space-y-6">
                <SettingRow label="Graphics Quality" description="Overall visual quality preset">
                  <SelectInput
                    value={settings.quality}
                    onChange={(v) => updateSetting('quality', v as Settings['quality'])}
                    options={[
                      { value: 'low', label: 'Low' },
                      { value: 'medium', label: 'Medium' },
                      { value: 'high', label: 'High' },
                      { value: 'ultra', label: 'Ultra' },
                    ]}
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

                <SettingRow label="V-Sync" description="Synchronize frame rate with monitor">
                  <ToggleInput
                    value={settings.vsync}
                    onChange={(v) => updateSetting('vsync', v)}
                  />
                </SettingRow>

                <SettingRow label="Show FPS" description="Display frame rate counter">
                  <ToggleInput
                    value={settings.showFPS}
                    onChange={(v) => updateSetting('showFPS', v)}
                  />
                </SettingRow>
              </div>
            )}

            {activeTab === 'audio' && (
              <div className="space-y-6">
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

                <SettingRow label="Voice Chat" description={`${settings.voiceVolume}%`}>
                  <SliderInput
                    value={settings.voiceVolume}
                    onChange={(v) => updateSetting('voiceVolume', v)}
                    min={0}
                    max={100}
                    step={1}
                  />
                </SettingRow>
              </div>
            )}

            {activeTab === 'controls' && (
              <div className="space-y-6">
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
                  <h3 className="font-display text-white mb-4">KEYBINDS</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { action: 'Move Forward', key: 'W' },
                      { action: 'Move Back', key: 'S' },
                      { action: 'Move Left', key: 'A' },
                      { action: 'Move Right', key: 'D' },
                      { action: 'Jump', key: 'Space' },
                      { action: 'Crouch', key: 'Ctrl' },
                      { action: 'Sprint', key: 'Shift' },
                      { action: 'Ability 1', key: 'E' },
                      { action: 'Ability 2', key: 'Q' },
                      { action: 'Ultimate', key: 'F' },
                      { action: 'Interact', key: 'R' },
                      { action: 'Scoreboard', key: 'Tab' },
                    ].map((bind) => (
                      <div key={bind.action} className="flex items-center justify-between px-3 py-2 rounded bg-white/5">
                        <span className="text-white/60 font-body text-sm">{bind.action}</span>
                        <span className="px-2 py-1 bg-white/10 rounded text-white font-mono text-xs">
                          {bind.key}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'gameplay' && (
              <div className="space-y-6">
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

                <SettingRow label="Crosshair Style" description="Choose your crosshair appearance">
                  <SelectInput
                    value={settings.crosshairStyle}
                    onChange={(v) => updateSetting('crosshairStyle', v as Settings['crosshairStyle'])}
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
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/5 bg-strike-elevated/50">
          <button
            onClick={handleReset}
            className="px-4 py-2 rounded-lg text-white/50 font-display hover:text-white hover:bg-white/5 transition-all"
          >
            RESET DEFAULTS
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-6 py-2 rounded-lg bg-white/5 text-white/70 font-display hover:bg-white/10 hover:text-white transition-all"
            >
              CANCEL
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges}
              className={`px-6 py-2 rounded-lg font-display transition-all ${
                hasChanges
                  ? 'bg-orange-500 text-white hover:bg-orange-400'
                  : 'bg-white/5 text-white/30 cursor-not-allowed'
              }`}
            >
              SAVE CHANGES
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Setting Row Component
function SettingRow({ label, description, children }: { 
  label: string; 
  description: string; 
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <div>
        <h4 className="font-display text-white">{label}</h4>
        <p className="text-white/40 text-sm font-body mt-0.5">{description}</p>
      </div>
      {children}
    </div>
  );
}

// Toggle Input Component
function ToggleInput({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`w-12 h-6 rounded-full transition-all relative ${
        value ? 'bg-orange-500' : 'bg-white/20'
      }`}
    >
      <div
        className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
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
    <div className="w-48 flex items-center gap-3">
      <input
        type="range"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step}
        className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, #f97316 0%, #f97316 ${percent}%, rgba(255,255,255,0.2) ${percent}%, rgba(255,255,255,0.2) 100%)`,
        }}
      />
      <span className="w-10 text-right text-white/60 font-mono text-sm">{value}</span>
    </div>
  );
}

// Select Input Component
function SelectInput({ value, onChange, options }: { 
  value: string; 
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-4 py-2 rounded-lg bg-white/10 border border-white/10 text-white font-body cursor-pointer appearance-none pr-10 focus:outline-none focus:border-orange-500"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='white'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 0.5rem center',
        backgroundSize: '1.25rem',
      }}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} className="bg-strike-surface">
          {option.label}
        </option>
      ))}
    </select>
  );
}

