// Synthetic Web Audio Service for Tactical Outdoor Field Operation

class AudioService {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;

  private initCtx() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  // Tactical click / beep
  public playBeep(freq: number = 880, durationMs: number = 80, type: OscillatorType = 'sine') {
    if (this.isMuted) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + durationMs / 1000);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + durationMs / 1000);
    } catch (e) {
      // Audio context error
    }
  }

  // QR Code Detected & Validated (Double ascending chime)
  public playQrDetected() {
    if (this.isMuted) return;
    this.playBeep(987.77, 90, 'sine'); // B5
    setTimeout(() => {
      this.playBeep(1318.51, 150, 'triangle'); // E6
    }, 100);
  }

  public playTargetLock() {
    if (this.isMuted) return;
    this.playBeep(880, 80, 'triangle');
    setTimeout(() => this.playBeep(1174.66, 120, 'triangle'), 90);
  }

  public playQrSuccess() {
    this.playQrDetected();
  }

  // Runner ACK Confirmed (High triumphal triple chime)
  public playRunnerAck() {
    if (this.isMuted) return;
    this.playBeep(1046.5, 80, 'sine'); // C6
    setTimeout(() => this.playBeep(1318.51, 80, 'sine'), 100); // E6
    setTimeout(() => this.playBeep(1567.98, 200, 'triangle'), 200); // G6
  }

  // RTL Command Triggered (Warning siren pulses)
  public playRtlAlert() {
    if (this.isMuted) return;
    this.playBeep(700, 150, 'sawtooth');
    setTimeout(() => this.playBeep(550, 200, 'sawtooth'), 180);
  }

  // 3-Minute Timeout Critical Warning
  public playTimeoutWarning() {
    if (this.isMuted) return;
    this.playBeep(1200, 100, 'square');
    setTimeout(() => this.playBeep(1200, 100, 'square'), 150);
  }

  // Mission Complete Fanfare
  public playMissionComplete() {
    if (this.isMuted) return;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    notes.forEach((freq, idx) => {
      setTimeout(() => this.playBeep(freq, 160, 'triangle'), idx * 120);
    });
  }

  // Haptic Feedback for Mobile / Android vibration
  public triggerHaptic(type: 'light' | 'medium' | 'heavy' | 'success' | 'warning' = 'medium') {
    if (typeof window !== 'undefined' && 'navigator' in window && 'vibrate' in navigator) {
      try {
        switch (type) {
          case 'light':
            navigator.vibrate(30);
            break;
          case 'medium':
            navigator.vibrate(80);
            break;
          case 'heavy':
            navigator.vibrate(200);
            break;
          case 'success':
            navigator.vibrate([60, 40, 120]);
            break;
          case 'warning':
            navigator.vibrate([100, 60, 100, 60, 200]);
            break;
        }
      } catch (e) {
        // Haptics not allowed
      }
    }
  }
}

export const audioService = new AudioService();
