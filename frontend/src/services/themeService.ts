export type ThemeMode = 'light' | 'dark' | 'system';

type ThemeChangeListener = (theme: 'light' | 'dark', mode: ThemeMode) => void;

const THEME_STORAGE_KEY = 'sae_app_theme_mode';

class ThemeService {
  private currentMode: ThemeMode = 'dark';
  private resolvedTheme: 'light' | 'dark' = 'dark';
  private listeners: Set<ThemeChangeListener> = new Set();
  private mediaQuery: MediaQueryList | null = null;

  constructor() {
    this.init();
  }

  private init() {
    if (typeof window === 'undefined') return;

    // Check media query for system preference
    if (window.matchMedia) {
      this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      this.mediaQuery.addEventListener('change', (e) => {
        if (this.currentMode === 'system') {
          this.applyTheme(e.matches ? 'dark' : 'light');
        }
      });
    }

    // Load saved preference
    const saved = localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
    if (saved && (saved === 'light' || saved === 'dark' || saved === 'system')) {
      this.currentMode = saved;
    } else {
      this.currentMode = 'dark'; // Default to dark as per existing app identity
    }

    this.resolveAndApply();
  }

  private resolveAndApply() {
    let resolved: 'light' | 'dark' = 'dark';
    if (this.currentMode === 'system') {
      resolved = this.mediaQuery && this.mediaQuery.matches ? 'dark' : 'light';
    } else {
      resolved = this.currentMode;
    }

    this.applyTheme(resolved);
  }

  private applyTheme(resolved: 'light' | 'dark') {
    this.resolvedTheme = resolved;

    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      if (resolved === 'dark') {
        root.classList.add('dark');
        root.classList.remove('light');
        root.setAttribute('data-theme', 'dark');
        root.style.colorScheme = 'dark';
      } else {
        root.classList.remove('dark');
        root.classList.add('light');
        root.setAttribute('data-theme', 'light');
        root.style.colorScheme = 'light';
      }
    }

    this.notifyListeners();
  }

  public getMode(): ThemeMode {
    return this.currentMode;
  }

  public getResolvedTheme(): 'light' | 'dark' {
    return this.resolvedTheme;
  }

  public setMode(mode: ThemeMode) {
    this.currentMode = mode;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch (e) {
      // ignore
    }
    this.resolveAndApply();
  }

  public toggleTheme() {
    // Cycles: dark -> light -> system -> dark
    if (this.currentMode === 'dark') {
      this.setMode('light');
    } else if (this.currentMode === 'light') {
      this.setMode('system');
    } else {
      this.setMode('dark');
    }
  }

  public subscribe(fn: ThemeChangeListener) {
    this.listeners.add(fn);
    fn(this.resolvedTheme, this.currentMode);
    return () => this.listeners.delete(fn);
  }

  private notifyListeners() {
    this.listeners.forEach((fn) => fn(this.resolvedTheme, this.currentMode));
  }
}

export const themeService = new ThemeService();
