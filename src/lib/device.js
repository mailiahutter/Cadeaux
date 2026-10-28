// Ce que le téléphone mémorise : uniquement la liste des groupes rejoints
// (clé + qui je suis). Aucune donnée de liste n'est gardée hors ligne.
import { createMemoryBackend } from './backend/memory.js';
import { createSupabaseBackend } from './backend/supabase.js';

const KEY = 'wl-groups';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
export const DEMO = !SUPABASE_URL || !SUPABASE_KEY;

let backend;
export function getBackend() {
  backend ??= DEMO ? createMemoryBackend({ persist: true }) : createSupabaseBackend(SUPABASE_URL, SUPABASE_KEY);
  return backend;
}

export function savedGroups() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

export function saveGroup(groupId, patch) {
  const all = savedGroups();
  all[groupId] = { ...all[groupId], ...patch };
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function forgetGroup(groupId) {
  const all = savedGroups();
  delete all[groupId];
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function inviteLink(groupId, keyString, year) {
  const base = window.location.href.split('#')[0];
  return `${base}#/g/${groupId}/${keyString}/${year}`;
}
