// Accès à un groupe : chiffre tout ce qui part, déchiffre tout ce qui arrive.
import { decrypt, encrypt, generateKeyString, hashPin, importKey, uuid } from './crypto.js';

export class ConflictError extends Error {
  constructor(message = 'Quelqu’un a modifié cet élément en même temps que toi. La version à jour a été rechargée.') {
    super(message);
    this.name = 'ConflictError';
  }
}

export const RESERVE_MESSAGES = {
  ok: null,
  taken: 'Trop tard : quelqu’un vient de prendre ce cadeau.',
  shared: 'Quelqu’un vient de lancer un cadeau commun pour ce cadeau : tu peux y participer.',
  changed: 'Ce cadeau commun vient d’être annulé. Tu peux le réserver à nouveau.',
  already: 'Tu as déjà réservé ce cadeau.',
  own: 'Tu ne peux pas réserver un cadeau de ta propre liste.',
  missing: 'Ce cadeau n’existe plus.',
};

export class GroupSession {
  constructor(backend, groupId, key) {
    this.backend = backend;
    this.groupId = groupId;
    this.key = key;
  }

  static async open(backend, groupId, keyString) {
    return new GroupSession(backend, groupId, await importKey(keyString));
  }

  static async create(backend, groupName, creator) {
    const groupId = uuid();
    const keyString = generateKeyString();
    const session = await GroupSession.open(backend, groupId, keyString);
    await backend.createGroup({ id: groupId, enc: await encrypt(session.key, { name: groupName }) });
    const year = new Date().getFullYear();
    await backend.ensureEdition(groupId, year);
    const memberId = await session.addMember(creator);
    return { session, groupId, keyString, memberId, year };
  }

  async load() {
    const raw = await this.backend.fetchGroup(this.groupId);
    if (!raw) return null;
    const dec = async (row) => {
      try {
        return { ...row, data: await decrypt(this.key, row.enc) };
      } catch {
        return null; // clé incorrecte ou donnée corrompue : ignorée
      }
    };
    const group = await dec(raw.group);
    if (!group) throw new Error('Lien invalide : la clé de ce groupe ne correspond pas.');
    const members = (await Promise.all(raw.members.map(dec))).filter(Boolean);
    const items = (await Promise.all(raw.items.map(dec))).filter(Boolean);
    return {
      group,
      members,
      items,
      editions: raw.editions.map((e) => e.year).sort((a, b) => a - b),
      reservations: raw.reservations,
      transfers: raw.transfers,
    };
  }

  // Notifie les autres téléphones après chaque modification.
  async #done(result) {
    this.backend.notify(this.groupId);
    return result;
  }

  // ---- Membres ----

  async addMember({ name, pin, birthday = '' }) {
    const id = uuid();
    const data = { name: name.trim(), birthday, pinHash: await hashPin(this.groupId, id, pin) };
    await this.backend.insertMember({ id, group_id: this.groupId, enc: await encrypt(this.key, data) });
    return this.#done(id);
  }

  async checkPin(member, pin) {
    return member.data.pinHash === (await hashPin(this.groupId, member.id, pin));
  }

  async updateMember(member, { name, birthday, pin }) {
    const data = { ...member.data };
    if (name !== undefined) data.name = name.trim();
    if (birthday !== undefined) data.birthday = birthday;
    if (pin) data.pinHash = await hashPin(this.groupId, member.id, pin);
    const ok = await this.backend.updateMember(member.id, member.version, { enc: await encrypt(this.key, data) });
    if (!ok) throw new ConflictError();
    return this.#done();
  }

  async removeMember(member) {
    await this.backend.deleteMember(member.id);
    return this.#done();
  }

  // ---- Éditions annuelles ----

  async ensureEdition(year) {
    await this.backend.ensureEdition(this.groupId, year);
    return this.#done();
  }

  // ---- Cadeaux ----

  async addItem({ year, ownerId, createdBy, data }) {
    const hidden = ownerId !== createdBy; // ajouté par quelqu'un d'autre = invisible pour le destinataire
    await this.backend.insertItem({
      id: uuid(), group_id: this.groupId, year, owner_id: ownerId, created_by: createdBy, hidden,
      enc: await encrypt(this.key, cleanItemData(data)),
    });
    return this.#done();
  }

  async editItem(item, data) {
    const ok = await this.backend.updateItem(item.id, item.version, {
      enc: await encrypt(this.key, cleanItemData({ ...item.data, ...data })),
    });
    if (!ok) throw new ConflictError();
    return this.#done();
  }

  async setItemFlags(item, flags) {
    const ok = await this.backend.updateItem(item.id, item.version, flags);
    if (!ok) throw new ConflictError();
    return this.#done();
  }

  // ---- Réservations (atomiques côté base) ----

  async reserve(itemId, memberId, mode) {
    const status = await this.backend.reserve(itemId, memberId, mode);
    return this.#done(status);
  }

  async cancel(itemId, memberId) {
    const status = await this.backend.cancelReservation(itemId, memberId);
    return this.#done(status);
  }

  async setGiven(itemId, memberId, given) {
    await this.backend.setGiven(itemId, memberId, given);
    return this.#done();
  }

  // ---- Report de liste d'une année sur l'autre ----

  // "claimTransfer" est atomique : si le même membre valide sur deux
  // appareils en même temps, le report n'est fait qu'une seule fois.
  async transfer(memberId, year, items) {
    const claimed = await this.backend.claimTransfer(this.groupId, year, memberId);
    if (!claimed) return this.#done(false);
    for (const it of items) {
      await this.backend.insertItem({
        id: uuid(), group_id: this.groupId, year, owner_id: memberId, created_by: memberId, hidden: false,
        from_item: it.id, enc: await encrypt(this.key, cleanItemData(it.data)),
      });
    }
    return this.#done(true);
  }

  subscribe(onChange, onStatus) {
    return this.backend.subscribe(this.groupId, onChange, onStatus);
  }
}

function cleanItemData(d) {
  return {
    title: String(d.title || '').trim(),
    url: String(d.url || '').trim(),
    price: String(d.price || '').trim(),
    notes: String(d.notes || '').trim(),
    priority: [1, 2, 3].includes(Number(d.priority)) ? Number(d.priority) : 2,
  };
}
