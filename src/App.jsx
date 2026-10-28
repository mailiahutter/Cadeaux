import { useEffect, useState } from 'react';
import { isValidKeyString } from './lib/crypto.js';
import { DEMO, getBackend, saveGroup, savedGroups } from './lib/device.js';
import { GroupSession } from './lib/session.js';
import { NetworkError } from './lib/backend/supabase.js';
import { OfflineScreen, PinInput, useOnline } from './components/ui.jsx';
import GroupApp from './components/GroupApp.jsx';
import { go } from './lib/nav.js';

function useHash() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash.replace(/^#\/?/, '').split('/').filter(Boolean);
}

export default function App() {
  const route = useHash();
  const online = useOnline();
  const [, force] = useState(0);

  // Lien d'invitation : #/g/<groupe>/<clé>/<année>
  useEffect(() => {
    if (route[0] === 'g' && route[1] && isValidKeyString(route[2])) {
      saveGroup(route[1], { key: route[2], linkYear: Number(route[3]) || null });
      go(`group/${route[1]}`, true);
    }
  }, [route]);

  if (!online) return <OfflineScreen onRetry={() => force((n) => n + 1)} />;

  if (route[0] === 'g') {
    if (!isValidKeyString(route[2])) return <BadLink />;
    return <div className="center muted">Ouverture du groupe…</div>;
  }
  if (route[0] === 'group' && route[1]) {
    if (!savedGroups()[route[1]]?.key) return <BadLink />;
    return <GroupApp key={route[1]} groupId={route[1]} route={route.slice(2)} />;
  }
  if (route[0] === 'new') return <CreateGroup />;
  return <Home />;
}

function BadLink() {
  return (
    <div className="page">
      <div className="card">
        <h2>Lien incomplet</h2>
        <p>Ce lien d’invitation est incomplet ou abîmé. Demande à un membre du groupe de te le renvoyer en entier.</p>
        <button className="btn" onClick={() => go('')}>
          Accueil
        </button>
      </div>
    </div>
  );
}

function Home() {
  const groups = Object.entries(savedGroups());
  return (
    <div className="page">
      <header className="hero">
        <div className="big-emoji">🎁</div>
        <h1>Nos listes de cadeaux</h1>
        <p className="muted">Noël, anniversaires… chacun sa liste, et la surprise reste entière.</p>
      </header>
      {DEMO && (
        <div className="notice">
          Mode démonstration : les données restent sur cet appareil. Voir le guide d’installation pour partager avec la famille.
        </div>
      )}
      {groups.length > 0 && (
        <section>
          <h2>Mes groupes</h2>
          <div className="stack">
            {groups.map(([id, g]) => (
              <button key={id} className="card card-btn" onClick={() => go(`group/${id}`)}>
                <strong>{g.name || 'Groupe'}</strong>
                <span className="chev">›</span>
              </button>
            ))}
          </div>
        </section>
      )}
      <section className="stack">
        <button className="btn primary" onClick={() => go('new')}>
          ＋ Créer un groupe
        </button>
        <p className="muted small">Pour rejoindre un groupe existant, ouvre simplement le lien d’invitation reçu.</p>
      </section>
    </div>
  );
}

function CreateGroup() {
  const [form, setForm] = useState({ group: '', name: '', pin: '', birthday: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (form.pin.length < 4) return setError('Le code doit avoir au moins 4 chiffres.');
    setBusy(true);
    setError('');
    try {
      const { groupId, keyString, memberId, year } = await GroupSession.create(getBackend(), form.group.trim(), {
        name: form.name,
        pin: form.pin,
        birthday: form.birthday,
      });
      saveGroup(groupId, { key: keyString, memberId, name: form.group.trim(), linkYear: year });
      go(`group/${groupId}/settings/welcome`, true);
    } catch (err) {
      setError(err instanceof NetworkError ? 'Pas de connexion Internet.' : `Erreur : ${err.message}`);
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <button className="link-btn" onClick={() => go('')}>
        ‹ Retour
      </button>
      <h1>Nouveau groupe</h1>
      <form className="card stack" onSubmit={submit}>
        <label className="field">
          <span>Nom du groupe</span>
          <input required maxLength={60} placeholder="Famille Martin" value={form.group} onChange={set('group')} />
        </label>
        <label className="field">
          <span>Ton prénom</span>
          <input required maxLength={40} value={form.name} onChange={set('name')} />
        </label>
        <PinInput value={form.pin} onChange={(pin) => setForm({ ...form, pin })} />
        <label className="field">
          <span>Ta date d’anniversaire (facultatif)</span>
          <input type="date" value={form.birthday} onChange={set('birthday')} />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn primary" disabled={busy}>
          {busy ? 'Création…' : 'Créer le groupe'}
        </button>
      </form>
    </div>
  );
}
