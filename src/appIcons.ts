import type { AppIconId } from './types';

/** Lumen's icons. Each has a tile for pickers and a tab icon and home-screen icon in public/icons/. */
export const APP_ICONS: { id: AppIconId; name: string; preview: string }[] = [
  { id: 'star', name: 'Star', preview: './icons/star-256.png' },
  { id: 'camera', name: 'Camera', preview: './icons/camera-256.png' },
];

/** Shows an icon in the browser tab and for "Add to Home Screen" (the links are in index.html). */
export function showIconInPage(id: AppIconId) {
  const set = (selector: string, href: string) => {
    const link = document.head.querySelector<HTMLLinkElement>(selector);
    if (link && !link.href.endsWith(href.slice(1))) link.href = href;
  };
  set('link[rel="icon"][type="image/svg+xml"]', `./icons/${id}.svg`);
  set('link[rel="icon"][type="image/png"]', `./icons/${id}-32.png`);
  set('link[rel="apple-touch-icon"]', `./icons/${id}-touch.png`);
}

/** Uses an icon everywhere: the tab, and in the desktop app the Dock, taskbar and window icons. */
export function applyAppIcon(id: AppIconId) {
  showIconInPage(id);
  window.lumenDesktop?.setAppIcon(id);
}
