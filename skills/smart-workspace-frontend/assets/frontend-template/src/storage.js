export function readPreference(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
}

export function savePreference(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* Retain in-memory behavior when storage is unavailable. */ }
}
