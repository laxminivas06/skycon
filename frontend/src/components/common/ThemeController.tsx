import React, { useState, useEffect, useRef } from 'react';
import { Sun, Moon, Laptop, ChevronDown } from 'lucide-react';
import { themeService, ThemeMode } from '../../services/themeService';

interface ThemeControllerProps {
  className?: string;
  showLabels?: boolean;
}

export const ThemeController: React.FC<ThemeControllerProps> = ({
  className = '',
  showLabels = false
}) => {
  const [mode, setMode] = useState<ThemeMode>(themeService.getMode());
  const [resolved, setResolved] = useState<'light' | 'dark'>(themeService.getResolvedTheme());
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = themeService.subscribe((resTheme, curMode) => {
      setResolved(resTheme);
      setMode(curMode);
    });

    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      unsub();
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleSelect = (newMode: ThemeMode) => {
    themeService.setMode(newMode);
    setIsOpen(false);
  };

  const currentIcon = () => {
    if (mode === 'system') return <Laptop className="w-3.5 h-3.5 text-sky-400" />;
    if (mode === 'light') return <Sun className="w-3.5 h-3.5 text-amber-500" />;
    return <Moon className="w-3.5 h-3.5 text-sky-300" />;
  };

  const getLabel = (m: ThemeMode) => {
    if (m === 'light') return 'Light';
    if (m === 'dark') return 'Dark';
    return 'System';
  };

  return (
    <div className={`relative inline-block text-left font-mono ${className}`} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-1.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-200 px-2 sm:px-2.5 py-1.5 rounded border border-slate-700 text-xs transition cursor-pointer shadow-sm"
        title={`Current Theme: ${getLabel(mode)} (${resolved})`}
        aria-label="Toggle theme"
      >
        {currentIcon()}
        {showLabels && (
          <span className="hidden sm:inline font-bold uppercase text-[11px]">
            {getLabel(mode)}
          </span>
        )}
        <ChevronDown className="w-3 h-3 text-slate-400" />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-1.5 w-32 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl py-1 z-50 text-xs animate-in fade-in zoom-in-95">
          <button
            type="button"
            onClick={() => handleSelect('light')}
            className={`w-full text-left px-3 py-1.5 flex items-center space-x-2 transition ${
              mode === 'light'
                ? 'bg-amber-500/20 text-amber-500 font-bold'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Sun className="w-3.5 h-3.5 text-amber-500" />
            <span>Light</span>
          </button>

          <button
            type="button"
            onClick={() => handleSelect('dark')}
            className={`w-full text-left px-3 py-1.5 flex items-center space-x-2 transition ${
              mode === 'dark'
                ? 'bg-sky-500/20 text-sky-400 font-bold'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Moon className="w-3.5 h-3.5 text-sky-400" />
            <span>Dark</span>
          </button>

          <button
            type="button"
            onClick={() => handleSelect('system')}
            className={`w-full text-left px-3 py-1.5 flex items-center space-x-2 transition border-t border-slate-800/80 ${
              mode === 'system'
                ? 'bg-purple-500/20 text-purple-400 font-bold'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Laptop className="w-3.5 h-3.5 text-purple-400" />
            <span>System</span>
          </button>
        </div>
      )}
    </div>
  );
};
