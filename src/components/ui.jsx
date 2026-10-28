import { useEffect, useState } from 'react';

export function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          {onClose && (
            <button className="icon-btn" onClick={onClose} aria-label="Fermer">
              ✕
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

export function Toast({ message, onDone }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDone, 4500);
    return () => clearTimeout(t);
  }, [message, onDone]);
  if (!message) return null;
  return (
    <div className="toast" role="status" onClick={onDone}>
      {message}
    </div>
  );
}

export function PinInput({ value, onChange, autoFocus, label = 'Code secret (4 chiffres ou plus)' }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        pattern="[0-9]*"
        minLength={4}
        maxLength={8}
        required
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
      />
    </label>
  );
}

export function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

export function OfflineScreen({ onRetry }) {
  return (
    <div className="offline">
      <div className="offline-box">
        <div className="big-emoji">📡</div>
        <h2>Pas de connexion Internet</h2>
        <p>L’application fonctionne uniquement avec Internet (Wi-Fi ou réseau mobile), pour que tout le monde voie toujours la même chose.</p>
        <button className="btn primary" onClick={onRetry}>
          Réessayer
        </button>
      </div>
    </div>
  );
}

export async function shareLink(url, title) {
  const text = `Rejoins notre liste de cadeaux « ${title} » 🎁`;
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return null;
    } catch (e) {
      if (e?.name === 'AbortError') return null;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'Lien copié ! Colle-le dans un message (WhatsApp, SMS, e-mail…).';
  } catch {
    window.prompt('Copie ce lien :', url);
    return null;
  }
}
