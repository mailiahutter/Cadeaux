// Chiffrement de bout en bout : AES-256-GCM via Web Crypto.
// La clé du groupe ne quitte jamais les téléphones : elle voyage dans la
// partie "#..." du lien d'invitation, que les navigateurs n'envoient à
// aucun serveur.

const subtle = globalThis.crypto.subtle;
const PREFIX = 'v1';

function toB64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function generateKeyString() {
  return toB64url(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

export function isValidKeyString(str) {
  try {
    return typeof str === 'string' && fromB64url(str).length === 32;
  } catch {
    return false;
  }
}

export async function importKey(keyString) {
  return subtle.importKey('raw', fromB64url(keyString), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encrypt(key, value) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(value));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  return `${PREFIX}.${toB64url(iv)}.${toB64url(ct)}`;
}

export async function decrypt(key, payload) {
  const [prefix, iv, ct] = String(payload).split('.');
  if (prefix !== PREFIX || !iv || !ct) throw new Error('Format chiffré inconnu');
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(iv) }, key, fromB64url(ct));
  return JSON.parse(new TextDecoder().decode(plain));
}

export async function hashPin(groupId, memberId, pin) {
  const data = new TextEncoder().encode(`${groupId}:${memberId}:${String(pin).trim()}`);
  return toB64url(new Uint8Array(await subtle.digest('SHA-256', data)));
}

export function uuid() {
  return globalThis.crypto.randomUUID();
}
