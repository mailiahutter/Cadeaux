// Stockage partagé via Supabase. Seules des données chiffrées et des
// identifiants aléatoires y transitent.
import { createClient } from '@supabase/supabase-js';

export class NetworkError extends Error {
  constructor(message = 'Connexion Internet indisponible') {
    super(message);
    this.name = 'NetworkError';
  }
}

const TABLES = ['groups', 'members', 'editions', 'items', 'reservations', 'transfers'];

function fail(error) {
  const msg = `${error?.message || error}`;
  if (/fetch|network|Load failed|timeout|ECONNREFUSED/i.test(msg)) throw new NetworkError();
  throw new Error(msg);
}

function check({ data, error }) {
  if (error) fail(error);
  return data;
}

async function run(promise) {
  let res;
  try {
    res = await promise;
  } catch (e) {
    fail(e);
  }
  return check(res);
}

export function createSupabaseBackend(url, anonKey) {
  const sb = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const channels = new Map();

  return {
    kind: 'supabase',

    async createGroup({ id, enc }) {
      await run(sb.from('groups').insert({ id, enc }));
    },

    async fetchGroup(groupId) {
      const [groups, members, editions, items, reservations, transfers] = await Promise.all(
        TABLES.map((t) =>
          run(sb.from(t).select('*').eq(t === 'groups' ? 'id' : 'group_id', groupId).limit(5000)),
        ),
      );
      if (!groups.length) return null;
      return { group: groups[0], members, editions, items, reservations, transfers };
    },

    async ensureEdition(groupId, year) {
      await run(
        sb.from('editions').upsert({ group_id: groupId, year }, { onConflict: 'group_id,year', ignoreDuplicates: true }),
      );
    },

    async insertMember(row) {
      await run(sb.from('members').insert(row));
    },

    async updateMember(id, version, patch) {
      const rows = await run(
        sb.from('members').update({ ...patch, version: version + 1 }).eq('id', id).eq('version', version).select('id'),
      );
      return rows.length === 1;
    },

    async deleteMember(id) {
      await run(sb.from('members').delete().eq('id', id));
    },

    async insertItem(row) {
      await run(sb.from('items').insert(row));
    },

    async updateItem(id, version, patch) {
      const rows = await run(
        sb.from('items').update({ ...patch, version: version + 1 }).eq('id', id).eq('version', version).select('id'),
      );
      return rows.length === 1;
    },

    async reserve(itemId, memberId, mode) {
      return run(sb.rpc('reserve_item', { p_item: itemId, p_member: memberId, p_mode: mode }));
    },

    async cancelReservation(itemId, memberId) {
      return run(sb.rpc('cancel_reservation', { p_item: itemId, p_member: memberId }));
    },

    async setGiven(itemId, memberId, given) {
      await run(sb.from('reservations').update({ given }).eq('item_id', itemId).eq('member_id', memberId));
    },

    async claimTransfer(groupId, year, memberId) {
      const { error } = await sb.from('transfers').insert({ group_id: groupId, year, member_id: memberId });
      if (!error) return true;
      if (error.code === '23505') return false; // déjà fait (autre appareil)
      fail(error);
    },

    // Temps réel : changements de la base + signal "changed" envoyé par les
    // autres téléphones après chaque modification (couvre les suppressions).
    subscribe(groupId, onChange, onStatus) {
      const ch = sb.channel(`group-${groupId}`, { config: { broadcast: { self: false } } });
      for (const table of TABLES) {
        ch.on(
          'postgres_changes',
          { event: '*', schema: 'public', table, filter: `${table === 'groups' ? 'id' : 'group_id'}=eq.${groupId}` },
          () => onChange(),
        );
      }
      ch.on('broadcast', { event: 'changed' }, () => onChange());
      ch.subscribe((status) => onStatus?.(status));
      channels.set(groupId, ch);
      return () => {
        channels.delete(groupId);
        sb.removeChannel(ch);
      };
    },

    notify(groupId) {
      channels.get(groupId)?.send({ type: 'broadcast', event: 'changed', payload: {} }).catch(() => {});
    },
  };
}
