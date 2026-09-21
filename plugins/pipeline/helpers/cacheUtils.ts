/**
 * cacheUtils.ts
 * Helper functions for safely interacting with localStorage.
 * Handles incognito mode or cases where localStorage is disabled.
 */

export function getCache<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const item = window.localStorage.getItem(key);
    return item ? JSON.parse(item) as T : null;
  } catch (error) {
    console.warn(`Error reading cache for key "${key}":`, error);
    return null;
  }
}

export function setCache<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Error setting cache for key "${key}":`, error);
  }
}

export function removeCache(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    console.warn(`Error removing cache for key "${key}":`, error);
  }
}
