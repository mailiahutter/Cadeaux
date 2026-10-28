// Test de bout en bout contre un vrai Supabase (local via `npx supabase start`).
// Lancement : SUPABASE_TEST_URL=http://127.0.0.1:54321 SUPABASE_TEST_KEY=<anon> npx vitest run
import { describe, expect, it } from 'vitest';
import { createSupabaseBackend } from '../src/lib/backend/supabase.js';
import { ConflictError, GroupSession } from '../src/lib/session.js';
import { listFor, statusFor } from '../src/lib/model.js';

const URL = process.env.SUPABASE_TEST_URL;
const KEY = process.env.SUPABASE_TEST_KEY;

const waitFor = async (cond, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
};

describe.skipIf(!URL)('Supabase réel (deux téléphones)', () => {
  it('chiffrement, réservations concurrentes, conflits et temps réel', async () => {
    // Téléphone A crée le groupe ; téléphone B le rejoint avec le lien.
    const phoneA = createSupabaseBackend(URL, KEY);
    const phoneB = createSupabaseBackend(URL, KEY);
    const created = await GroupSession.create(phoneA, 'Famille test', { name: 'Alice', pin: '1111' });
    const a = created.session;
    const b = await GroupSession.open(phoneB, created.groupId, created.keyString);
    const bob = await b.addMember({ name: 'Bob', pin: '2222' });
    const carla = await b.addMember({ name: 'Carla', pin: '3333' });

    // Données illisibles côté serveur
    const raw = await phoneA.fetchGroup(created.groupId);
    expect(JSON.stringify(raw)).not.toContain('Alice');

    // B écoute en temps réel
    let changes = 0;
    let subscribed = false;
    const unsub = b.subscribe(() => changes++, (s) => (subscribed ||= s === 'SUBSCRIBED'));
    let changesA = 0;
    let subscribedA = false;
    const unsubA = a.subscribe(() => changesA++, (s) => (subscribedA ||= s === 'SUBSCRIBED'));
    expect(await waitFor(() => subscribed && subscribedA)).toBe(true);
    await new Promise((r) => setTimeout(r, 2500)); // activation côté serveur

    await a.addItem({ year: created.year, ownerId: created.memberId, createdBy: created.memberId, data: { title: 'Vélo' } });
    expect(await waitFor(() => changes > 0)).toBe(true);

    // Le signal "changed" de B parvient à A
    changesA = 0;
    await b.setGiven('00000000-0000-0000-0000-000000000000', bob, true);
    expect(await waitFor(() => changesA > 0)).toBe(true);

    let snap = await b.load();
    const velo = snap.items.find((i) => i.data.title === 'Vélo');

    // Bob et Carla cliquent en même temps depuis deux téléphones
    const res = await Promise.all([b.reserve(velo.id, bob, 'solo'), a.reserve(velo.id, carla, 'solo')]);
    expect(res.sort()).toEqual(['ok', 'taken']);

    snap = await a.load();
    expect(statusFor(snap, velo, created.memberId).kind).toBe('owner');
    expect(statusFor(snap, velo, carla).kind).toBe('solo');
    expect(listFor(snap, created.memberId, created.memberId, created.year)).toHaveLength(1);

    // Modification simultanée du même souhait
    await a.editItem(velo, { title: 'Vélo rouge' });
    await expect(b.editItem(velo, { title: 'Vélo bleu' })).rejects.toBeInstanceOf(ConflictError);

    // Report annuel atomique
    await a.ensureEdition(created.year + 1);
    const t = await Promise.all([a.transfer(created.memberId, created.year + 1, []), b.transfer(created.memberId, created.year + 1, [])]);
    expect(t.sort()).toEqual([false, true]);

    unsub();
    unsubA();
  }, 30000);
});
