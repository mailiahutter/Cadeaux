# 🎁 Nos listes de cadeaux

Application web pour téléphone (Android et iPhone) qui permet à une famille de tenir des listes de cadeaux toute l’année : Noël, anniversaires… sans que personne ne gâche la surprise.

## Ce que fait l’application

| Fonction | Détail |
|---|---|
| **Ma liste** | Chacun ajoute ses souhaits toute l’année : titre, lien, prix, niveau d’envie, précisions. |
| **Les listes des autres** | Chacun consulte la liste de tous les membres du groupe. |
| **Je le prends** | Le cadeau apparaît **coché et rayé « Pris par X »** pour tout le monde… **sauf pour le destinataire**, qui ne voit rien. |
| **Cadeau commun** | Plusieurs personnes peuvent se regrouper sur un même cadeau. |
| **Idée hors liste** | Proposer un cadeau qui n’est pas dans la liste de quelqu’un. Tout le monde le voit, **sauf la personne concernée**. |
| **Mes achats** | Récapitulatif de tout ce que j’ai réservé, avec la case « Marquer offert ». |
| **Anniversaires** | Affiche le nombre de jours avant l’anniversaire de chacun. |
| **Plusieurs groupes** | Famille, amis… Chaque groupe a son propre lien. |
| **Une liste par an** | Chaque 1er janvier, une nouvelle édition s’ouvre. Chacun **coche les souhaits à reporter** ; ceux déjà reçus ou offerts sont décochés par défaut. Les années passées restent consultables. |
| **Lien d’invitation** | Il ouvre l’application à chaque clic et reste valable d’une année sur l’autre. L’application propose de partager le nouveau lien de l’année. |
| **Connexion Internet obligatoire** | Hors connexion, l’application se bloque. Tout le monde voit donc toujours la même version. |
| **Conflits gérés** | Si deux personnes réservent le même cadeau à la même seconde, une seule réussit et l’autre est prévenue. Une modification faite en même temps qu’une autre est détectée, puis l’application recharge la version à jour. |
| **Temps réel** | Les changements apparaissent sur les autres téléphones en une seconde environ. |

**Connexion :** chaque membre choisit son prénom puis tape son code (4 chiffres ou plus). Le téléphone s’en souvient ensuite. En cas d’oubli, un autre membre peut changer le code dans **Réglages**.

## Confidentialité

- Toutes les listes, tous les prénoms et toutes les dates sont **chiffrés sur le téléphone** (AES-256) avant d’être envoyés.
- La clé de chiffrement se trouve uniquement dans le lien d’invitation, dans la partie après le `#`. Les navigateurs n’envoient jamais cette partie à un serveur.
- L’hébergeur des données (Supabase) ne voit donc que du texte illisible et des identifiants aléatoires. Il ne peut pas lire les listes, et Google, Amazon ou Facebook non plus.
- ⚠️ **Le lien d’invitation est donc la clé du groupe : ne l’envoyer qu’aux membres.**
- Le masquage des réservations et des idées hors liste est fait par l’application, comme demandé. Une personne qui fouillerait le code technique pourrait le contourner.

## Mise en route (environ 15 minutes, une seule fois)

### 1. Créer la base de données gratuite (Supabase)

1. Aller sur <https://supabase.com>, cliquer sur **Start your project** et créer un compte gratuit.
2. Cliquer sur **New project** :
   - Name : `cadeaux`
   - Database password : cliquer sur *Generate* (il ne servira plus)
   - **Region : Central EU (Frankfurt)**
   - Plan : **Free**
3. Une fois le projet prêt, ouvrir **SQL Editor** dans le menu de gauche, puis **New query**.
4. Copier tout le contenu du fichier [`supabase/schema.sql`](supabase/schema.sql), le coller, puis cliquer sur **Run**. Le message attendu est « Success. No rows returned ».
5. Ouvrir **Project Settings → API Keys** (ou le bouton **Connect** en haut) et noter deux valeurs :
   - **Project URL**, par exemple `https://abcdefgh.supabase.co` ;
   - la clé **publishable** (ou **anon public**), qui commence par `sb_publishable_` ou `eyJ`.

   Ces deux valeurs peuvent être publiques : sans le lien d’invitation, elles ne permettent pas de lire les listes.

### 2. Publier l’application (GitHub Pages, gratuit)

Dans ce dépôt GitHub :

1. **Settings → Secrets and variables → Actions → onglet *Variables* → New repository variable**. Créer :
   - `SUPABASE_URL` : la *Project URL* ;
   - `SUPABASE_ANON_KEY` : la clé *publishable/anon*.
2. **Settings → Pages → Build and deployment → Source : GitHub Actions**.
3. **Settings → Environments → github-pages**. Dans *Deployment branches*, ajouter la branche `claude/wishlist-mobile-app-zgdbb2` (ou fusionner la branche dans `main`).
4. **Actions → « Publier l’application » → Run workflow**.
5. Quelques minutes plus tard, l’adresse de l’application s’affiche dans **Settings → Pages**. Elle a la forme `https://<compte>.github.io/<dépôt>/`.

> 💡 Pour une adresse plus courte, renommer le dépôt (**Settings → General → Repository name**), par exemple `cadeaux`. L’adresse devient alors `https://<compte>.github.io/cadeaux/`.

Le workflow **« Garder Supabase éveillé »** s’exécute tous les 3 jours. Supabase met en pause les projets gratuits inutilisés depuis 7 jours : ce workflow l’en empêche, sans rien à faire de votre côté.

### 3. Créer le groupe et inviter la famille

1. Ouvrir l’adresse de l’application et cliquer sur **Créer un groupe**.
2. Cliquer sur **Partager le lien**, puis l’envoyer par WhatsApp, SMS ou e-mail.
3. Chacun ouvre le lien, clique sur **Je ne suis pas dans la liste**, puis saisit son prénom et son code.

### 4. Mettre l’icône sur l’écran d’accueil (conseillé)

- **Android (Chrome)** : menu **⋮**, puis **Ajouter à l’écran d’accueil**.
- **iPhone (Safari)** : bouton **Partager** (carré avec une flèche), puis **Sur l’écran d’accueil**.

L’application s’ouvre ensuite en plein écran, comme une vraie application.

## Pour les développeurs

```bash
npm install
npm run dev        # sans configuration : mode démo (données locales au navigateur)
npm test           # tests unitaires
```

- `src/lib/crypto.js` : chiffrement AES-GCM et empreinte du code secret.
- `src/lib/session.js` : opérations sur un groupe (tout est chiffré et déchiffré ici).
- `src/lib/model.js` : règles de visibilité (surprise, report annuel, anniversaires).
- `src/lib/backend/supabase.js` : stockage Supabase et temps réel ; `memory.js` : mode démo et tests.
- `supabase/schema.sql` : tables, réservation atomique (`reserve_item`) et annulation (`cancel_reservation`).

Test de bout en bout contre un vrai Supabase local (Docker requis) :

```bash
npx supabase start
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/schema.sql
SUPABASE_TEST_URL=http://127.0.0.1:54321 SUPABASE_TEST_KEY=<clé anon locale> npm test
```
