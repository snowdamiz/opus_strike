export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;

  const userAgent = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true;
  // iPadOS 13+ reports itself as Macintosh; the touch check tells them apart.
  return /Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1;
}
