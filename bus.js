// What the pages and the service worker share: the BroadcastChannel that tells them what changed, the messages it carries, and the key of
// the copy of the appearance in localStorage (theme-boot.js is a plain script and writes the key out: theme-boot.test.js keeps them equal).
export const BUS_NAME = 'obturo';
export const MESSAGES = Object.freeze({ settingsChanged: 'settings-changed', openShot: 'open-shot', openSettings: 'open-settings' });
export const APPEARANCE_KEY = 'obturo.appearance';
