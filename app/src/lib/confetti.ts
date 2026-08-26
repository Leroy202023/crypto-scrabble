/** Lightweight DOM confetti burst — pairs with sfx.success(). */
export function confettiBurst(n = 28): void {
  const colors = ['#eccb6f', '#f6dd96', '#7dedaa', '#9fc2ff', '#ff8fa3', '#f5ecd7'];
  for (let i = 0; i < n; i++) {
    const d = document.createElement('div');
    d.className = 'confetti-piece';
    d.style.left = `${Math.random() * 100}vw`;
    d.style.background = colors[i % colors.length];
    d.style.animationDuration = `${1.1 + Math.random() * 0.9}s`;
    d.style.animationDelay = `${Math.random() * 0.25}s`;
    d.style.rotate = `${Math.random() * 360}deg`;
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 2600);
  }
}
