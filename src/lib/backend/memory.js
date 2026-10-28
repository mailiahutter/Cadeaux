// Stockage local (mode démo et tests). Reproduit fidèlement les règles de
// supabase/schema.sql. En mode démo, les données sont gardées dans le
// navigateur et partagées entre onglets, pour essayer l'application sans
// compte Supabase.

const STORAGE_KEY = 'wl-demo-db';

function emptyDb() {
  return { groups: [], members: [], editions: [], items: [], reservations: [], transfers: [] };
}

// Horodatage strictement croissant (ordre d'arrivée fiable, comme en base)
let lastTs = 0;
const now = () => {
  lastTs = Math.max(Date.now(), lastTs + 1);
  return new Date(lastTs).toISOString();
};
const clone = (v) => JSON.parse(JSON.stringify(v));

export function createMemoryBackend({ persist = false } = {}) {
  const storage = persist && typeof localStorage !== 'undefined' ? localStorage : null;
  let mem = emptyDb();
  const listeners = new Set();

  const load = () => {
    if (!storage) return mem;
    try {
      return JSON.parse(storage.getItem(STORAGE_KEY)) || emptyDb();
    } catch {
      return emptyDb();
    }
  };
  const save = (db) => {
    if (storage) storage.setItem(STORAGE_KEY, JSON.stringify(db));
    else mem = db;
  };
  const tx = (fn) => {
    const db = load();
    const result = fn(db);
    save(db);
    return result;
  };

  if (storage && typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEY) listeners.forEach((l) => l.onChange());
    });
  }

  return {
    kind: 'memory',

    async createGroup({ id, enc }) {
      tx((db) => db.groups.push({ id, enc, created_at: now() }));
    },

    async fetchGroup(groupId) {
      const db = load();
      const group = db.groups.find((g) => g.id === groupId);
      if (!group) return null;
      const by = (t) => db[t].filter((r) => r.group_id === groupId);
      return clone({
        group,
        members: by('members'),
        editions: by('editions'),
        items: by('items'),
        reservations: by('reservations'),
        transfers: by('transfers'),
      });
    },

    async ensureEdition(groupId, year) {
      tx((db) => {
        if (!db.editions.some((e) => e.group_id === groupId && e.year === year)) {
          db.editions.push({ group_id: groupId, year, created_at: now() });
        }
      });
    },

    async insertMember(row) {
      tx((db) => db.members.push({ version: 1, created_at: now(), updated_at: now(), ...row }));
    },

    async updateMember(id, version, patch) {
      return tx((db) => {
        const m = db.members.find((r) => r.id === id && r.version === version);
        if (!m) return false;
        Object.assign(m, patch, { version: version + 1, updated_at: now() });
        return true;
      });
    },

    async deleteMember(id) {
      tx((db) => {
        const itemIds = new Set(db.items.filter((i) => i.owner_id === id || i.created_by === id).map((i) => i.id));
        db.members = db.members.filter((m) => m.id !== id);
        db.items = db.items.filter((i) => !itemIds.has(i.id));
        db.reservations = db.reservations.filter((r) => r.member_id !== id && !itemIds.has(r.item_id));
        db.transfers = db.transfers.filter((t) => t.member_id !== id);
      });
    },

    async insertItem(row) {
      tx((db) =>
        db.items.push({
          hidden: false, received: false, deleted: false, from_item: null, version: 1,
          created_at: now(), updated_at: now(), ...row,
        }),
      );
    },

    async updateItem(id, version, patch) {
      return tx((db) => {
        const it = db.items.find((r) => r.id === id && r.version === version);
        if (!it) return false;
        Object.assign(it, patch, { version: version + 1, updated_at: now() });
        return true;
      });
    },

    async reserve(itemId, memberId, mode) {
      return tx((db) => {
        const it = db.items.find((i) => i.id === itemId);
        if (!it || it.deleted) return 'missing';
        if (!db.members.some((m) => m.id === memberId && m.group_id === it.group_id)) return 'missing';
        if (it.owner_id === memberId) return 'own';
        const rs = db.reservations.filter((r) => r.item_id === itemId);
        if (rs.some((r) => r.member_id === memberId)) return 'already';
        if (rs.some((r) => r.kind === 'solo')) return 'taken';
        const add = (kind) =>
          db.reservations.push({ item_id: itemId, member_id: memberId, group_id: it.group_id, kind, given: false, created_at: now() });
        if (rs.some((r) => r.kind === 'lead')) {
          if (mode === 'join') { add('join'); return 'ok'; }
          return 'shared';
        }
        if (mode === 'join') return 'changed';
        add(mode === 'shared' ? 'lead' : 'solo');
        return 'ok';
      });
    },

    async cancelReservation(itemId, memberId) {
      return tx((db) => {
        const r = db.reservations.find((x) => x.item_id === itemId && x.member_id === memberId);
        if (!r) return 'missing';
        db.reservations = db.reservations.filter((x) => x !== r);
        if (r.kind === 'lead') {
          const next = db.reservations
            .filter((x) => x.item_id === itemId && x.kind === 'join')
            .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.member_id.localeCompare(b.member_id))[0];
          if (next) next.kind = 'lead';
        }
        return 'ok';
      });
    },

    async setGiven(itemId, memberId, given) {
      tx((db) => {
        const r = db.reservations.find((x) => x.item_id === itemId && x.member_id === memberId);
        if (r) r.given = given;
      });
    },

    async claimTransfer(groupId, year, memberId) {
      return tx((db) => {
        if (db.transfers.some((t) => t.group_id === groupId && t.year === year && t.member_id === memberId)) return false;
        db.transfers.push({ group_id: groupId, year, member_id: memberId, created_at: now() });
        return true;
      });
    },

    subscribe(groupId, onChange, onStatus) {
      const l = { onChange };
      listeners.add(l);
      onStatus?.('SUBSCRIBED');
      return () => listeners.delete(l);
    },

    notify() {
      // Les autres onglets sont prévenus par l'événement "storage".
    },
  };
}
