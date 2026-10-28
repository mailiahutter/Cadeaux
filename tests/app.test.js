import { describe, expect, it } from 'vitest';
import { createMemoryBackend } from '../src/lib/backend/memory.js';
import { ConflictError, GroupSession } from '../src/lib/session.js';
import { daysUntilBirthday, listFor, needsTransfer, statusFor, transferCandidates } from '../src/lib/model.js';

async function setup() {
  const backend = createMemoryBackend();
  const { session, groupId, keyString, memberId: alice, year } = await GroupSession.create(backend, 'Famille', {
    name: 'Alice', pin: '1111', birthday: '1990-12-24',
  });
  const bob = await session.addMember({ name: 'Bob', pin: '2222' });
  const carla = await session.addMember({ name: 'Carla', pin: '3333' });
  await session.addItem({ year, ownerId: alice, createdBy: alice, data: { title: 'Vélo', priority: 3 } });
  await session.addItem({ year, ownerId: alice, createdBy: bob, data: { title: 'Surprise de Bob' } });
  const snap = await session.load();
  const velo = snap.items.find((i) => i.data.title === 'Vélo');
  return { backend, session, groupId, keyString, alice, bob, carla, year, velo };
}

describe('chiffrement', () => {
  it('ne stocke que des données illisibles et refuse une mauvaise clé', async () => {
    const { backend, groupId } = await setup();
    const raw = await backend.fetchGroup(groupId);
    const dump = JSON.stringify(raw);
    expect(dump).not.toContain('Vélo');
    expect(dump).not.toContain('Alice');
    const intruder = await GroupSession.open(backend, groupId, 'A'.repeat(43));
    await expect(intruder.load()).rejects.toThrow(/clé/);
  });

  it('vérifie le code secret', async () => {
    const { session, alice } = await setup();
    const me = (await session.load()).members.find((m) => m.id === alice);
    expect(await session.checkPin(me, '1111')).toBe(true);
    expect(await session.checkPin(me, '9999')).toBe(false);
  });
});

describe('surprise', () => {
  it('le destinataire ne voit ni les idées hors liste ni les réservations', async () => {
    const { session, alice, bob, year, velo } = await setup();
    expect(await session.reserve(velo.id, bob, 'solo')).toBe('ok');
    const snap = await session.load();

    const aliceView = listFor(snap, alice, alice, year);
    expect(aliceView.map((i) => i.data.title)).toEqual(['Vélo']);
    expect(statusFor(snap, aliceView[0], alice)).toEqual({ kind: 'owner' });

    const bobView = listFor(snap, bob, alice, year);
    expect(bobView.map((i) => i.data.title)).toEqual(['Vélo', 'Surprise de Bob']);
    expect(statusFor(snap, bobView[0], bob)).toMatchObject({ kind: 'solo', by: bob, mine: true });
  });

  it('un cadeau réservé puis retiré par le destinataire reste visible aux autres', async () => {
    const { session, alice, bob, carla, year, velo } = await setup();
    await session.reserve(velo.id, bob, 'solo');
    await session.setItemFlags(velo, { deleted: true });
    const snap = await session.load();
    expect(listFor(snap, alice, alice, year)).toHaveLength(0);
    expect(listFor(snap, carla, alice, year).find((i) => i.id === velo.id).deleted).toBe(true);
  });
});

describe('réservations et conflits', () => {
  it('deux réservations simultanées : une seule gagne', async () => {
    const { session, bob, carla, velo } = await setup();
    const results = await Promise.all([session.reserve(velo.id, bob, 'solo'), session.reserve(velo.id, carla, 'solo')]);
    expect(results.sort()).toEqual(['ok', 'taken']);
  });

  it('on ne réserve pas sa propre liste', async () => {
    const { session, alice, velo } = await setup();
    expect(await session.reserve(velo.id, alice, 'solo')).toBe('own');
  });

  it('cadeau commun : participation et transmission', async () => {
    const { session, alice, bob, carla, velo } = await setup();
    const dan = await session.addMember({ name: 'Dan', pin: '4444' });
    expect(await session.reserve(velo.id, bob, 'shared')).toBe('ok');
    expect(await session.reserve(velo.id, carla, 'solo')).toBe('shared');
    expect(await session.reserve(velo.id, carla, 'join')).toBe('ok');
    expect(await session.reserve(velo.id, dan, 'join')).toBe('ok');
    let st = statusFor(await session.load(), velo, alice);
    expect(st.kind).toBe('owner');
    st = statusFor(await session.load(), velo, dan);
    expect(st).toMatchObject({ kind: 'shared', lead: bob, mine: true });
    await session.cancel(velo.id, bob);
    st = statusFor(await session.load(), velo, dan);
    expect(st.lead).toBe(carla);
    expect(st.members).toEqual([carla, dan]);
  });

  it('modification simultanée détectée', async () => {
    const { session, velo } = await setup();
    await session.editItem(velo, { title: 'Vélo rouge' });
    await expect(session.editItem(velo, { title: 'Vélo bleu' })).rejects.toBeInstanceOf(ConflictError);
    const snap = await session.load();
    expect(snap.items.find((i) => i.id === velo.id).data.title).toBe('Vélo rouge');
  });
});

describe('report annuel', () => {
  it('propose les souhaits non reçus et ne reporte qu’une fois', async () => {
    const { session, alice, bob, year, velo } = await setup();
    await session.addItem({ year, ownerId: alice, createdBy: alice, data: { title: 'Livre' } });
    await session.addItem({ year, ownerId: alice, createdBy: alice, data: { title: 'Montre' } });
    let snap = await session.load();
    const livre = snap.items.find((i) => i.data.title === 'Livre');
    const montre = snap.items.find((i) => i.data.title === 'Montre');
    await session.setItemFlags(livre, { received: true });
    await session.reserve(montre.id, bob, 'solo');
    await session.setGiven(montre.id, bob, true);

    await session.ensureEdition(year + 1);
    snap = await session.load();
    expect(needsTransfer(snap, alice, year + 1)).toBe(true);
    const cands = transferCandidates(snap, alice, year + 1);
    expect(cands.map((c) => [c.item.data.title, c.preselected])).toEqual([
      ['Vélo', true],
      ['Livre', false],
      ['Montre', false],
    ]); // l'idée hors liste de Bob n'est pas proposée

    expect(await session.transfer(alice, year + 1, [velo])).toBe(true);
    expect(await session.transfer(alice, year + 1, [velo])).toBe(false); // 2e appareil
    snap = await session.load();
    expect(needsTransfer(snap, alice, year + 1)).toBe(false);
    const next = listFor(snap, alice, alice, year + 1);
    expect(next.map((i) => i.data.title)).toEqual(['Vélo']);
    expect(statusFor(snap, next[0], bob).kind).toBe('free'); // réservations remises à zéro
  });
});

describe('anniversaires', () => {
  it('compte les jours jusqu’au prochain anniversaire', () => {
    const today = new Date(2026, 9, 28);
    expect(daysUntilBirthday('1990-10-28', today)).toBe(0);
    expect(daysUntilBirthday('1990-10-30', today)).toBe(2);
    expect(daysUntilBirthday('1990-10-27', today)).toBe(364);
    expect(daysUntilBirthday('', today)).toBe(null);
  });
});
