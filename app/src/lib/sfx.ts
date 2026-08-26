// Tiny WebAudio synth — zero assets, AAA-feel feedback.
let ctx: AudioContext | null = null;
let enabled = localStorage.getItem('sfx') !== 'off';

function ac(): AudioContext | null {
  if (!enabled) return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.08, delay = 0, slideTo?: number) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export const sfx = {
  get enabled() { return enabled; },
  toggle() {
    enabled = !enabled;
    localStorage.setItem('sfx', enabled ? 'on' : 'off');
    if (enabled) sfx.select();
    return enabled;
  },
  select() { tone(660, 0.07, 'triangle', 0.05); },
  place() { tone(300, 0.12, 'square', 0.06, 0, 140); },
  success() {
    tone(523, 0.12, 'triangle', 0.07, 0);
    tone(659, 0.12, 'triangle', 0.07, 0.09);
    tone(784, 0.2, 'triangle', 0.08, 0.18);
  },
  coin() {
    tone(988, 0.09, 'square', 0.05);
    tone(1319, 0.18, 'square', 0.05, 0.08);
  },
  error() { tone(140, 0.25, 'sawtooth', 0.06, 0, 90); },
  open() {
    tone(392, 0.1, 'triangle', 0.06);
    tone(523, 0.1, 'triangle', 0.06, 0.08);
    tone(659, 0.1, 'triangle', 0.06, 0.16);
    tone(1047, 0.3, 'triangle', 0.08, 0.24);
  },
};
