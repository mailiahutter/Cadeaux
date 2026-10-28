import { useCallback, useEffect, useState } from 'react';
import { forgetGroup, getBackend, inviteLink, saveGroup, savedGroups } from '../lib/device.js';
import {
  currentYear, formatBirthday, listFor, memberName, myReservations, needsTransfer, previousYear,
  statusFor, transferCandidates,
} from '../lib/model.js';
import { go } from '../lib/nav.js';
import { ConflictError, GroupSession, RESERVE_MESSAGES } from '../lib/session.js';
import { NetworkError } from '../lib/backend/supabase.js';
import { Modal, OfflineScreen, PinInput, Toast, shareLink } from './ui.jsx';

export default function GroupApp({ groupId, route }) {
  const saved = savedGroups()[groupId];
  const [session, setSession] = useState(null);
  const [snap, setSnap] = useState(null);
  const [fatal, setFatal] = useState('');
  const [offline, setOffline] = useState(false);
  const [toast, setToast] = useState('');
  const [meId, setMeId] = useState(saved.memberId || null);
  const [viewYear, setViewYear] = useState(null);
  const [transferLater, setTransferLater] = useState(false);
  const [live, setLive] = useState(false);

  useEffect(() => {
    GroupSession.open(getBackend(), groupId, saved.key).then(setSession, () => setFatal('Lien invalide.'));
  }, [groupId, saved.key]);

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      const s = await session.load();
      if (!s) return setFatal('Ce groupe est introuvable. Le lien est peut-être erroné.');
      setSnap(s);
      setOffline(false);
      saveGroup(groupId, { name: s.group.data.name });
    } catch (e) {
      if (e instanceof NetworkError || !navigator.onLine) setOffline(true);
      else setFatal(e.message);
    }
  }, [session, groupId]);

  // Toute modification passe par act() : gestion des conflits et du réseau,
  // puis rechargement de la version à jour.
  const act = useCallback(
    async (fn) => {
      try {
        const msg = await fn();
        if (typeof msg === 'string') setToast(msg);
      } catch (e) {
        if (e instanceof ConflictError) setToast(e.message);
        else if (e instanceof NetworkError || !navigator.onLine) setOffline(true);
        else setToast(`Erreur : ${e.message}`);
      }
      await refresh();
    },
    [refresh],
  );

  // Synchronisation : temps réel + vérification toutes les 30 s + au retour sur l'appli.
  useEffect(() => {
    if (!session) return;
    let timer;
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 250);
    };
    refresh();
    const unsub = session.subscribe(soon, (status) => {
      setLive(status === 'SUBSCRIBED');
      if (status === 'SUBSCRIBED') soon();
    });
    const poll = setInterval(refresh, 30000);
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', refresh);
    return () => {
      clearTimeout(timer);
      unsub();
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', refresh);
    };
  }, [session, refresh]);

  // Nouvelle année civile : l'édition de l'année s'ouvre automatiquement.
  useEffect(() => {
    if (!snap || !session) return;
    const cal = new Date().getFullYear();
    if (!snap.editions.length || Math.max(...snap.editions) < cal) act(() => session.ensureEdition(cal));
  }, [snap, session, act]);

  if (fatal) {
    return (
      <div className="page">
        <div className="card">
          <h2>Oups</h2>
          <p>{fatal}</p>
          <button className="btn" onClick={() => go('')}>Accueil</button>
        </div>
      </div>
    );
  }
  if (offline) return <OfflineScreen onRetry={refresh} />;
  if (!snap) return <div className="center muted">Chargement…</div>;

  const me = snap.members.find((m) => m.id === meId);
  if (!me) {
    return (
      <Login
        snap={snap}
        session={session}
        act={act}
        onLogged={(id) => {
          saveGroup(groupId, { memberId: id });
          setMeId(id);
        }}
      />
    );
  }

  const cur = currentYear(snap);
  const year = viewYear && snap.editions.includes(viewYear) ? viewYear : cur;
  const readOnly = year < cur;
  const ctx = { snap, me, year, readOnly, act, session, groupId, setToast };
  const [view, param] = route;

  return (
    <div className="app">
      <header className="topbar">
        <button className="icon-btn" onClick={() => go('')} aria-label="Mes groupes">⌂</button>
        <div className="topbar-title">
          <strong>{snap.group.data.name}</strong>
          <span className={`dot ${live ? 'on' : ''}`} title={live ? 'Synchronisé en direct' : 'Connexion…'} />
        </div>
        {snap.editions.length > 1 ? (
          <select className="year" value={year} onChange={(e) => setViewYear(Number(e.target.value))} aria-label="Année">
            {[...snap.editions].reverse().map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        ) : (
          <span className="year">{year}</span>
        )}
      </header>

      {readOnly && (
        <div className="notice">
          Tu consultes les archives {year} (lecture seule).{' '}
          <button className="link-btn" onClick={() => setViewYear(cur)}>Revenir à {cur}</button>
        </div>
      )}

      <main className="page">
        {view === 'me' && <ListView ctx={ctx} ownerId={me.id} />}
        {view === 'm' && param && <ListView ctx={ctx} ownerId={param} />}
        {view === 'res' && <MyReservations ctx={ctx} />}
        {view === 'settings' && (
          <Settings ctx={ctx} welcome={param === 'welcome'} keyString={saved.key} onSwitchUser={() => {
            saveGroup(groupId, { memberId: null });
            setMeId(null);
            go(`group/${groupId}`);
          }} />
        )}
        {!view && <Overview ctx={ctx} linkYear={saved.linkYear} keyString={saved.key} />}
      </main>

      <nav className="tabbar">
        <Tab label="Famille" icon="👪" active={!view || view === 'm'} to={`group/${groupId}`} />
        <Tab label="Ma liste" icon="📝" active={view === 'me'} to={`group/${groupId}/me`} />
        <Tab label="Mes achats" icon="🛍️" active={view === 'res'} to={`group/${groupId}/res`} />
        <Tab label="Réglages" icon="⚙️" active={view === 'settings'} to={`group/${groupId}/settings`} />
      </nav>

      {!readOnly && !transferLater && needsTransfer(snap, me.id, cur) && (
        <TransferDialog ctx={ctx} year={cur} onLater={() => setTransferLater(true)} />
      )}
      <Toast message={toast} onDone={() => setToast('')} />
    </div>
  );
}

function Tab({ label, icon, active, to }) {
  return (
    <button className={`tab ${active ? 'active' : ''}`} onClick={() => go(to)}>
      <span className="tab-icon">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------- Connexion

function Login({ snap, session, act, onLogged }) {
  const [selected, setSelected] = useState(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(snap.members.length === 0);
  const [form, setForm] = useState({ name: '', birthday: '' });
  const members = [...snap.members].sort((a, b) => a.data.name.localeCompare(b.data.name, 'fr'));

  const login = async (e) => {
    e.preventDefault();
    if (await session.checkPin(selected, pin)) onLogged(selected.id);
    else setError('Code incorrect. Si tu l’as oublié, un autre membre peut le changer dans Réglages.');
  };

  const join = async (e) => {
    e.preventDefault();
    const name = form.name.trim();
    if (pin.length < 4) return setError('Le code doit avoir au moins 4 chiffres.');
    if (snap.members.some((m) => m.data.name.toLowerCase() === name.toLowerCase())) {
      return setError('Ce prénom existe déjà dans le groupe : choisis-le dans la liste, ou ajoute l’initiale de ton nom.');
    }
    let id;
    await act(async () => {
      id = await session.addMember({ name, pin, birthday: form.birthday });
    });
    if (id) onLogged(id);
  };

  return (
    <div className="page">
      <header className="hero">
        <div className="big-emoji">🎁</div>
        <h1>{snap.group.data.name}</h1>
      </header>

      {!creating && !selected && (
        <section className="stack">
          <h2>Qui es-tu ?</h2>
          {members.map((m) => (
            <button key={m.id} className="card card-btn" onClick={() => { setSelected(m); setPin(''); setError(''); }}>
              <strong>{m.data.name}</strong>
              <span className="chev">›</span>
            </button>
          ))}
          <button className="btn" onClick={() => { setCreating(true); setPin(''); setError(''); }}>
            ＋ Je ne suis pas dans la liste
          </button>
        </section>
      )}

      {selected && (
        <form className="card stack" onSubmit={login}>
          <h2>Bonjour {selected.data.name} 👋</h2>
          <PinInput value={pin} onChange={setPin} autoFocus label="Ton code secret" />
          {error && <p className="error">{error}</p>}
          <button className="btn primary">Entrer</button>
          <button type="button" className="link-btn" onClick={() => setSelected(null)}>‹ Ce n’est pas moi</button>
        </form>
      )}

      {creating && (
        <form className="card stack" onSubmit={join}>
          <h2>Rejoindre le groupe</h2>
          <label className="field">
            <span>Ton prénom</span>
            <input required maxLength={40} autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <PinInput value={pin} onChange={setPin} label="Choisis un code secret (4 chiffres ou plus)" />
          <label className="field">
            <span>Ta date d’anniversaire (facultatif)</span>
            <input type="date" value={form.birthday} onChange={(e) => setForm({ ...form, birthday: e.target.value })} />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="btn primary">Rejoindre</button>
          {snap.members.length > 0 && (
            <button type="button" className="link-btn" onClick={() => setCreating(false)}>‹ Je suis déjà dans la liste</button>
          )}
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Accueil du groupe

function Overview({ ctx, linkYear, keyString }) {
  const { snap, me, year, groupId, setToast, readOnly } = ctx;
  const cur = currentYear(snap);
  const others = snap.members
    .filter((m) => m.id !== me.id)
    .sort((a, b) => a.data.name.localeCompare(b.data.name, 'fr'));
  const mine = listFor(snap, me.id, me.id, year);

  const shareNew = async () => {
    const msg = await shareLink(inviteLink(groupId, keyString, cur), `${snap.group.data.name} ${cur}`);
    saveGroup(groupId, { linkYear: cur });
    if (msg) setToast(msg);
  };

  return (
    <div className="stack">
      {linkYear && linkYear < cur && !readOnly && (
        <div className="notice">
          🎉 L’édition {cur} est ouverte ! Le lien {linkYear} reste valable, mais tu peux partager le nouveau.{' '}
          <button className="link-btn" onClick={shareNew}>Partager le lien {cur}</button>
        </div>
      )}
      <h2>Bonjour {me.data.name} !</h2>
      <button className="card card-btn" onClick={() => go(`group/${groupId}/me`)}>
        <div>
          <strong>📝 Ma liste {year}</strong>
          <div className="muted small">{mine.length} souhait{mine.length > 1 ? 's' : ''}</div>
        </div>
        <span className="chev">›</span>
      </button>
      <h2>Les listes des autres</h2>
      {others.length === 0 && (
        <p className="muted">
          Personne d’autre pour l’instant. Invite ta famille depuis{' '}
          <button className="link-btn" onClick={() => go(`group/${groupId}/settings`)}>Réglages</button>.
        </p>
      )}
      {others.map((m) => {
        const items = listFor(snap, me.id, m.id, year);
        const taken = items.filter((i) => statusFor(snap, i, me.id).kind !== 'free').length;
        const bday = formatBirthday(m.data.birthday);
        return (
          <button key={m.id} className="card card-btn" onClick={() => go(`group/${groupId}/m/${m.id}`)}>
            <div>
              <strong>{m.data.name}</strong>
              <div className="muted small">
                {items.length} cadeau{items.length > 1 ? 'x' : ''} · {taken} déjà pris
                {bday && <> · {bday}</>}
              </div>
            </div>
            <span className="chev">›</span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- Liste d'une personne

function ListView({ ctx, ownerId }) {
  const { snap, me, year, readOnly, groupId } = ctx;
  const [editing, setEditing] = useState(null); // null | 'new' | item
  const owner = snap.members.find((m) => m.id === ownerId);
  if (!owner) {
    return (
      <div className="card">
        <p>Ce membre n’existe plus.</p>
        <button className="btn" onClick={() => go(`group/${groupId}`)}>Retour</button>
      </div>
    );
  }
  const isMe = ownerId === me.id;
  const items = listFor(snap, me.id, ownerId, year);
  const wish = items.filter((i) => !i.hidden);
  const ideas = items.filter((i) => i.hidden);

  return (
    <div className="stack">
      {!isMe && <button className="link-btn" onClick={() => go(`group/${groupId}`)}>‹ Famille</button>}
      <h1>{isMe ? `Ma liste ${year}` : `Liste de ${owner.data.name}`}</h1>
      {!isMe && formatBirthday(owner.data.birthday) && <p className="muted">{formatBirthday(owner.data.birthday)}</p>}
      {isMe && !readOnly && (
        <p className="muted small">
          Ajoute tes envies toute l’année. Tu ne verras jamais qui a pris quoi : la surprise reste entière 🤫
        </p>
      )}
      {!readOnly && (
        <button className="btn primary" onClick={() => setEditing('new')}>
          {isMe ? '＋ Ajouter un souhait' : `＋ Idée cadeau hors liste pour ${owner.data.name}`}
        </button>
      )}
      {!isMe && !readOnly && (
        <p className="muted small">Les idées hors liste sont visibles par tout le groupe, sauf {owner.data.name}.</p>
      )}

      {wish.length === 0 && <p className="muted">{isMe ? 'Ta liste est vide pour le moment.' : 'Pas encore de souhait.'}</p>}
      {wish.map((it) => (
        <ItemCard key={it.id} item={it} ctx={ctx} onEdit={() => setEditing(it)} />
      ))}

      {ideas.length > 0 && (
        <>
          <h2>🤫 Idées hors liste</h2>
          {ideas.map((it) => (
            <ItemCard key={it.id} item={it} ctx={ctx} onEdit={() => setEditing(it)} />
          ))}
        </>
      )}

      {editing && (
        <ItemForm ctx={ctx} owner={owner} item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function ItemCard({ item, ctx, onEdit, showOwner }) {
  const { snap, me, readOnly, act, session } = ctx;
  const isOwner = item.owner_id === me.id;
  const st = statusFor(snap, item, me.id);
  const reserved = st.kind === 'solo' || st.kind === 'shared';
  const name = (id) => (id === me.id ? 'toi' : memberName(snap, id));
  const d = item.data;
  const canEditIdea = item.hidden && item.created_by === me.id && !item.deleted;
  const ownerName = memberName(snap, item.owner_id);

  const reserve = (mode) =>
    act(async () => {
      const s = await session.reserve(item.id, me.id, mode);
      if (s !== 'ok') return RESERVE_MESSAGES[s];
      if (mode === 'join') return 'Tu participes au cadeau commun 👥';
      if (mode === 'shared') return 'Cadeau commun lancé : les autres peuvent y participer 👥';
      return 'C’est noté : tu offres ce cadeau 🎁';
    });
  const cancel = () => {
    if (!window.confirm('Annuler ta réservation pour ce cadeau ?')) return;
    act(async () => {
      await session.cancel(item.id, me.id);
      return 'Réservation annulée.';
    });
  };
  const myRes = snap.reservations.find((r) => r.item_id === item.id && r.member_id === me.id);
  const toggleGiven = () => act(() => session.setGiven(item.id, me.id, !myRes.given));
  const remove = () => {
    if (!window.confirm(`Supprimer « ${d.title} » ?`)) return;
    act(async () => {
      await session.setItemFlags(item, { deleted: true });
      return 'Supprimé.';
    });
  };

  return (
    <article className={`item ${reserved ? 'crossed' : ''} ${item.received ? 'received' : ''}`}>
      <div className="item-main">
        {!isOwner && <span className={`check ${reserved ? 'on' : ''}`}>{reserved ? '✓' : ''}</span>}
        <div className="item-body">
          {showOwner && <div className="muted small">Pour {ownerName}</div>}
          <div className="item-title">
            {d.url ? (
              <a href={d.url} target="_blank" rel="noopener noreferrer">{d.title}</a>
            ) : (
              d.title
            )}
            {d.priority === 3 && <span className="prio" title="Très envie"> ❤️</span>}
          </div>
          <div className="item-meta">
            {d.price && <span>{d.price}</span>}
            {d.priority === 1 && <span className="muted">si possible</span>}
          </div>
          {d.notes && <p className="item-notes">{d.notes}</p>}
          {item.hidden && (
            <div className="badge secret">Idée de {name(item.created_by)} · invisible pour {ownerName}</div>
          )}
          {item.deleted && (
            <div className="badge warn">
              {item.hidden ? `Idée retirée par ${name(item.created_by)}` : `${ownerName} l’a retiré de sa liste`}
            </div>
          )}
          {item.received && <div className="badge ok">🎉 {isOwner ? 'Reçu' : `${ownerName} l’a reçu`}</div>}
          {st.kind === 'solo' && (
            <div className="badge taken">
              Pris par {name(st.by)}{st.given ? ' · offert ✓' : ''}
            </div>
          )}
          {st.kind === 'shared' && (
            <div className="badge taken">
              👥 Cadeau commun : {st.members.map(name).join(', ')}{st.given ? ' · offert ✓' : ''}
            </div>
          )}
        </div>
      </div>

      {!readOnly && (
        <div className="actions">
          {isOwner && (
            <>
              <button className="btn small" onClick={onEdit}>Modifier</button>
              <button className="btn small" onClick={() => act(() => session.setItemFlags(item, { received: !item.received }))}>
                {item.received ? 'Pas encore reçu' : 'Je l’ai reçu'}
              </button>
              <button className="btn small danger" onClick={remove}>Supprimer</button>
            </>
          )}
          {!isOwner && canEditIdea && (
            <>
              <button className="btn small" onClick={onEdit}>Modifier</button>
              <button className="btn small danger" onClick={remove}>Supprimer</button>
            </>
          )}
          {st.kind === 'free' && !item.deleted && !item.received && (
            <>
              <button className="btn small primary" onClick={() => reserve('solo')}>🎁 Je le prends</button>
              <button className="btn small" onClick={() => reserve('shared')}>👥 Cadeau commun</button>
            </>
          )}
          {st.kind === 'shared' && !st.mine && !item.deleted && (
            <button className="btn small primary" onClick={() => reserve('join')}>👥 Participer</button>
          )}
          {st.mine && (
            <>
              <button className="btn small" onClick={toggleGiven}>{myRes?.given ? 'Pas encore offert' : 'Marquer offert'}</button>
              <button className="btn small danger" onClick={cancel}>{st.kind === 'shared' ? 'Me retirer' : 'Annuler'}</button>
            </>
          )}
        </div>
      )}
    </article>
  );
}

function ItemForm({ ctx, owner, item, onClose }) {
  const { me, year, act, session } = ctx;
  const [d, setD] = useState(item?.data ?? { title: '', url: '', price: '', notes: '', priority: 2 });
  const set = (k) => (e) => setD({ ...d, [k]: e.target.value });
  const isIdea = owner.id !== me.id;

  const submit = async (e) => {
    e.preventDefault();
    let url = d.url.trim();
    if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
    const data = { ...d, url };
    onClose();
    await act(async () => {
      if (item) await session.editItem(item, data);
      else await session.addItem({ year, ownerId: owner.id, createdBy: me.id, data });
      return item ? 'Modifié.' : isIdea ? `Idée ajoutée (invisible pour ${owner.data.name}).` : 'Ajouté à ta liste.';
    });
  };

  return (
    <Modal title={item ? 'Modifier' : isIdea ? `Idée pour ${owner.data.name}` : 'Nouveau souhait'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label className="field">
          <span>Quoi ?</span>
          <input required maxLength={120} autoFocus value={d.title} onChange={set('title')} placeholder="Ex. : Livre « Le Petit Prince »" />
        </label>
        <label className="field">
          <span>Lien (facultatif)</span>
          <input type="url" inputMode="url" maxLength={1000} value={d.url} onChange={set('url')} placeholder="https://…" />
        </label>
        <label className="field">
          <span>Prix indicatif (facultatif)</span>
          <input maxLength={30} value={d.price} onChange={set('price')} placeholder="25 €" />
        </label>
        <label className="field">
          <span>Envie</span>
          <select value={d.priority} onChange={(e) => setD({ ...d, priority: Number(e.target.value) })}>
            <option value={3}>❤️ Très envie</option>
            <option value={2}>Envie</option>
            <option value={1}>Si possible</option>
          </select>
        </label>
        <label className="field">
          <span>Précisions (taille, couleur…)</span>
          <textarea maxLength={500} rows={3} value={d.notes} onChange={set('notes')} />
        </label>
        {isIdea && <p className="muted small">🤫 {owner.data.name} ne verra pas cette idée.</p>}
        <button className="btn primary">Enregistrer</button>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- Mes achats

function MyReservations({ ctx }) {
  const { snap, me, year } = ctx;
  const items = myReservations(snap, me.id, year);
  const byOwner = new Map();
  for (const it of items) byOwner.set(it.owner_id, [...(byOwner.get(it.owner_id) || []), it]);
  return (
    <div className="stack">
      <h1>Mes achats {year}</h1>
      <p className="muted small">Les cadeaux que tu as réservés, pour ne rien oublier.</p>
      {items.length === 0 && <p className="muted">Tu n’as encore rien réservé.</p>}
      {[...byOwner.entries()].map(([ownerId, list]) => (
        <section key={ownerId} className="stack">
          <h2>Pour {memberName(snap, ownerId)}</h2>
          {list.map((it) => (
            <ItemCard key={it.id} item={it} ctx={ctx} />
          ))}
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Report annuel

function TransferDialog({ ctx, year, onLater }) {
  const { snap, me, act, session } = ctx;
  const candidates = transferCandidates(snap, me.id, year);
  const prev = previousYear(snap, year);
  const [selected, setSelected] = useState(() => new Set(candidates.filter((c) => c.preselected).map((c) => c.item.id)));
  const toggle = (id) => {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setSelected(s);
  };
  const submit = () =>
    act(async () => {
      const chosen = candidates.filter((c) => selected.has(c.item.id)).map((c) => c.item);
      const ok = await session.transfer(me.id, year, chosen);
      if (!ok) return 'Le report avait déjà été fait depuis un autre appareil.';
      return chosen.length ? `${chosen.length} souhait(s) reporté(s) dans ta liste ${year} 🎉` : `Ta liste ${year} démarre à zéro.`;
    });

  return (
    <Modal title={`Bienvenue en ${year} ! 🎉`}>
      <p>
        Coche les souhaits de ta liste {prev} que tu veux garder dans ta liste {year}. Ceux que tu as reçus ne sont pas
        cochés.
      </p>
      <div className="stack">
        {candidates.map(({ item }) => (
          <label key={item.id} className="check-row">
            <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} />
            <span>{item.data.title}{item.received && <span className="muted small"> (reçu)</span>}</span>
          </label>
        ))}
      </div>
      <div className="stack">
        <button className="btn primary" onClick={submit}>
          Reporter {selected.size} souhait{selected.size > 1 ? 's' : ''}
        </button>
        <button className="link-btn" onClick={onLater}>Plus tard</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Réglages

function Settings({ ctx, welcome, keyString, onSwitchUser }) {
  const { snap, me, act, session, groupId, setToast } = ctx;
  const cur = currentYear(snap);
  const link = inviteLink(groupId, keyString, cur);
  const [profile, setProfile] = useState({ name: me.data.name, birthday: me.data.birthday || '', pin: '' });
  const others = snap.members.filter((m) => m.id !== me.id).sort((a, b) => a.data.name.localeCompare(b.data.name, 'fr'));

  const saveProfile = (e) => {
    e.preventDefault();
    if (profile.pin && profile.pin.length < 4) return setToast('Le code doit avoir au moins 4 chiffres.');
    const name = profile.name.trim();
    if (others.some((m) => m.data.name.toLowerCase() === name.toLowerCase())) return setToast('Ce prénom est déjà pris.');
    act(async () => {
      await session.updateMember(me, profile);
      setProfile({ ...profile, pin: '' });
      return 'Profil enregistré.';
    });
  };
  const resetPin = (m) => {
    const pin = window.prompt(`Nouveau code pour ${m.data.name} (4 chiffres ou plus) :`);
    if (!pin) return;
    if (!/^\d{4,8}$/.test(pin)) return setToast('Le code doit contenir 4 à 8 chiffres.');
    act(async () => {
      await session.updateMember(m, { pin });
      return `Code de ${m.data.name} modifié. Préviens-le !`;
    });
  };
  const removeMember = (m) => {
    if (!window.confirm(`Retirer ${m.data.name} du groupe ? Sa liste et ses réservations seront supprimées.`)) return;
    act(async () => {
      await session.removeMember(m);
      return `${m.data.name} a été retiré du groupe.`;
    });
  };
  const nextEdition = () => {
    if (!window.confirm(`Ouvrir l’édition ${cur + 1} pour tout le groupe ? Chacun pourra choisir les souhaits à reporter.`)) return;
    act(async () => {
      await session.ensureEdition(cur + 1);
      return `Édition ${cur + 1} ouverte !`;
    });
  };
  const share = async () => {
    const msg = await shareLink(link, snap.group.data.name);
    saveGroup(groupId, { linkYear: cur });
    if (msg) setToast(msg);
  };

  return (
    <div className="stack">
      <h1>Réglages</h1>

      <section className={`card stack ${welcome ? 'highlight' : ''}`}>
        <h2>🔗 Inviter la famille</h2>
        {welcome && <p><strong>Groupe créé !</strong> Envoie ce lien à chaque membre : il ouvre l’application directement.</p>}
        <p className="muted small">
          Lien de l’édition {cur}. Garde-le en favori ou sur l’écran d’accueil : il ouvre l’application à chaque clic.
          Ne le partage qu’avec le groupe : il contient la clé de chiffrement.
        </p>
        <input className="linkbox" readOnly value={link} onFocus={(e) => e.target.select()} />
        <button className="btn primary" onClick={share}>Partager le lien</button>
      </section>

      <form className="card stack" onSubmit={saveProfile}>
        <h2>👤 Mon profil</h2>
        <label className="field">
          <span>Prénom</span>
          <input required maxLength={40} value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
        </label>
        <label className="field">
          <span>Anniversaire</span>
          <input type="date" value={profile.birthday} onChange={(e) => setProfile({ ...profile, birthday: e.target.value })} />
        </label>
        <label className="field">
          <span>Nouveau code (laisser vide pour garder l’actuel)</span>
          <input type="password" inputMode="numeric" maxLength={8} value={profile.pin}
            onChange={(e) => setProfile({ ...profile, pin: e.target.value.replace(/\D/g, '') })} />
        </label>
        <button className="btn primary">Enregistrer</button>
      </form>

      {others.length > 0 && (
        <section className="card stack">
          <h2>👪 Membres</h2>
          {others.map((m) => (
            <div key={m.id} className="row">
              <span>{m.data.name}</span>
              <span className="row-actions">
                <button className="btn small" onClick={() => resetPin(m)}>Changer son code</button>
                <button className="btn small danger" onClick={() => removeMember(m)}>Retirer</button>
              </span>
            </div>
          ))}
        </section>
      )}

      <section className="card stack">
        <h2>📅 Années</h2>
        <p className="muted small">
          Une nouvelle liste s’ouvre automatiquement chaque 1er janvier. Chacun choisit alors les souhaits à reporter.
          Tu peux aussi l’ouvrir en avance (par exemple juste après Noël).
        </p>
        <button className="btn" onClick={nextEdition}>Ouvrir l’édition {cur + 1}</button>
      </section>

      <section className="card stack">
        <h2>📱 Cet appareil</h2>
        <button className="btn" onClick={onSwitchUser}>Changer d’utilisateur</button>
        <button
          className="btn danger"
          onClick={() => {
            if (!window.confirm('Retirer ce groupe de cet appareil ? Tu pourras revenir avec le lien d’invitation.')) return;
            forgetGroup(groupId);
            go('', true);
          }}
        >
          Retirer ce groupe de cet appareil
        </button>
      </section>

      <p className="muted small center-text">
        🔒 Listes chiffrées de bout en bout : l’hébergeur ne peut pas les lire.
      </p>
    </div>
  );
}
