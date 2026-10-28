// Règles de visibilité (pures, testées dans tests/model.test.js).
// Principe : le destinataire d'un cadeau ne voit JAMAIS les réservations
// ni les idées "hors liste" qui le concernent.

export function currentYear(snap) {
  return snap.editions.length ? Math.max(...snap.editions) : new Date().getFullYear();
}

export function memberName(snap, id) {
  return snap.members.find((m) => m.id === id)?.data.name ?? 'Ancien membre';
}

export function reservationsFor(snap, itemId) {
  return snap.reservations
    .filter((r) => r.item_id === itemId)
    .sort((a, b) => (a.kind === 'join') - (b.kind === 'join') || a.created_at.localeCompare(b.created_at));
}

const byPriority = (a, b) =>
  (b.data.priority ?? 2) - (a.data.priority ?? 2) || a.created_at.localeCompare(b.created_at);

// Liste de `ownerId` telle que la voit `viewerId` pour une année.
export function listFor(snap, viewerId, ownerId, year) {
  const own = snap.items.filter((i) => i.owner_id === ownerId && i.year === year);
  if (viewerId === ownerId) {
    return own.filter((i) => !i.hidden && !i.deleted).sort(byPriority);
  }
  // Les autres voient aussi les idées hors liste, et les cadeaux retirés
  // par le destinataire alors qu'ils étaient déjà réservés.
  return own
    .filter((i) => !i.deleted || reservationsFor(snap, i.id).length > 0)
    .sort((a, b) => a.hidden - b.hidden || byPriority(a, b));
}

// État d'un cadeau vu par quelqu'un d'autre que le destinataire.
export function statusFor(snap, item, viewerId) {
  if (item.owner_id === viewerId) return { kind: 'owner' };
  const rs = reservationsFor(snap, item.id);
  const mine = rs.find((r) => r.member_id === viewerId);
  const given = rs.some((r) => r.given);
  if (!rs.length) return { kind: 'free', received: item.received };
  if (rs[0].kind === 'solo') {
    return { kind: 'solo', by: rs[0].member_id, mine: !!mine, given };
  }
  return { kind: 'shared', lead: rs.find((r) => r.kind === 'lead')?.member_id, members: rs.map((r) => r.member_id), mine: !!mine, given };
}

// Cadeaux que `viewerId` a réservés (pour sa liste de courses).
export function myReservations(snap, viewerId, year) {
  const ids = new Set(snap.reservations.filter((r) => r.member_id === viewerId).map((r) => r.item_id));
  return snap.items.filter((i) => ids.has(i.id) && i.year === year);
}

// ---- Report de liste ----

export function previousYear(snap, year) {
  const prev = snap.editions.filter((y) => y < year);
  return prev.length ? Math.max(...prev) : null;
}

export function transferCandidates(snap, memberId, year) {
  const prev = previousYear(snap, year);
  if (prev === null) return [];
  return snap.items
    .filter((i) => i.year === prev && i.owner_id === memberId && !i.hidden && !i.deleted)
    .sort(byPriority)
    .map((item) => ({
      item,
      // Pré-coché sauf si déjà reçu ou offert
      preselected: !item.received && !snap.reservations.some((r) => r.item_id === item.id && r.given),
    }));
}

export function needsTransfer(snap, memberId, year) {
  if (snap.transfers.some((t) => t.year === year && t.member_id === memberId)) return false;
  return transferCandidates(snap, memberId, year).length > 0;
}

// ---- Anniversaires ----

export function daysUntilBirthday(birthday, today = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthday || '') || /^(\d{2})-(\d{2})$/.exec(birthday || '');
  if (!m) return null;
  const [month, day] = m.length === 4 ? [+m[2], +m[3]] : [+m[1], +m[2]];
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let next = new Date(today.getFullYear(), month - 1, day);
  if (next < start) next = new Date(today.getFullYear() + 1, month - 1, day);
  return Math.round((next - start) / 86400000);
}

export function formatBirthday(birthday) {
  const days = daysUntilBirthday(birthday);
  if (days === null) return '';
  if (days === 0) return '🎂 Anniversaire aujourd’hui !';
  if (days === 1) return '🎂 Anniversaire demain';
  if (days <= 60) return `🎂 Anniversaire dans ${days} jours`;
  const [, mm, dd] = birthday.split('-');
  return `🎂 ${dd}/${mm}`;
}
