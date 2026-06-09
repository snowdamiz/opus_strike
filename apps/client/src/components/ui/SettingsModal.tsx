import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudio } from '../../hooks/useAudio';
import {
  defaultSettings,
  type ClientSettings,
  type KeybindAction,
  useSettingsStore,
} from '../../store/settingsStore';
import { formatKeybind, mouseButtonToKeybindCode } from '../../utils/keybindings';
import { GameDialog } from './GameDialog';

type SettingsTab = 'video' | 'audio' | 'controls' | 'gameplay';

interface SettingsModalProps {
  onClose: () => void;
}

const resolutionScaleOptions = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'ultra', label: 'Ultra' },
];

const materialQualityOptions = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const featureQualityOptions = [
  { value: 'off', label: 'Off' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'ultra', label: 'Ultra' },
];

const fpsDisplayModeOptions = [
  { value: 'off', label: 'Off' },
  { value: 'fps', label: 'FPS Only' },
  { value: 'full', label: 'Full' },
];

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
];

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('video');
  const savedSettings = useSettingsStore(state => state.settings);
  const applySettings = useSettingsStore(state => state.applySettings);
  const [settings, setSettings] = useState<ClientSettings>(savedSettings);
  const [hasChanges, setHasChanges] = useState(false);
  const [rebindingAction, setRebindingAction] = useState<KeybindAction | null>(null);
  const { updateSettings: applyAudioSettings } = useAudio();

  const updateSetting = <K extends keyof ClientSettings>(key: K, value: ClientSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
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
    if (!rebindingAction) return;

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
      panelClassName="h-[min(70vh,40rem)]"
      bodyClassName="flex-1 flex overflow-hidden min-h-0"
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
          <div className="w-32 lg:w-40 xl:w-48 shrink-0 border-r border-white/5 p-2.5 lg:p-3 space-y-1.5">
            {tabs.map((tab) => (
 <button
 key={tab.id}
 onClick={() => setActiveTab(tab.id)}
 className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg font-display text-xs [&_svg]:h-[1rem] [&_svg]:w-[1rem] ${
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
          <div className="flex-1 p-[clamp(1.125rem,1.6vw,1.65rem)] overflow-y-auto custom-scrollbar">
            {activeTab === 'video' && (
              <div className="space-y-4">
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

                <SettingRow label="Material Detail" description="Surface maps, bump detail, and occlusion">
                  <SelectInput
                    value={settings.materialQuality}
                    onChange={(v) => updateSetting('materialQuality', v as ClientSettings['materialQuality'])}
                    options={materialQualityOptions}
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

                <SettingRow label="Show FPS" description="Display frame rate counter or diagnostics panel">
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
                      <div key={bind.action} className="flex items-center justify-between gap-3 px-3.5 py-2 rounded bg-white/5">
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
          </div>
    </GameDialog>
  );
}

// Setting Row Component
function SettingRow({ label, description, children }: { 
  label: string; 
  description: string; 
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div className="min-w-0">
        <h4 className="font-display text-sm text-white">{label}</h4>
        <p className="text-white/40 text-xs font-body mt-0.5">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// Toggle Input Component
function ToggleInput({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  return (
 <button
 onClick={() => onChange(!value)}
 className={`w-12 h-6 rounded-full relative ${
 value ? 'bg-orange-500' : 'bg-white/20'
 }`}
 >
 <div
 className={`absolute top-1 w-4 h-4 rounded-full bg-white ${
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
    <div className="w-[10.5rem] xl:w-48 flex items-center gap-3">
      <input
        type="range"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step}
        className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, rgb(var(--color-accent-primary)) 0%, rgb(var(--color-accent-primary)) ${percent}%, rgba(255,255,255,0.2) ${percent}%, rgba(255,255,255,0.2) 100%)`,
        }}
      />
      <span className="w-9 text-right text-white/60 font-mono text-xs">{value}</span>
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
    <div ref={containerRef} className="relative min-w-36">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className="w-full h-10 px-3.5 rounded-lg bg-white/[0.07] border border-white/10 text-sm text-white font-body cursor-pointer focus:outline-none focus:border-orange-500/80 hover:border-white/20 hover:bg-white/[0.1] flex items-center justify-between gap-3"
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
          className="absolute right-0 top-12 z-50 w-full overflow-hidden rounded-lg border border-white/15 bg-strike-elevated/95 shadow-2xl backdrop-blur-md"
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
                className={`w-full px-3.5 py-2.5 text-left text-sm font-body flex items-center gap-2 hover:bg-white/10 ${
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
