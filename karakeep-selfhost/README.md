# Karakeep 0.33.2 — toutes les fonctions, zéro euro

Déploiement de Karakeep **complet** : rendu JavaScript des pages, captures
d'écran, archivage intégral, PDF, téléchargement de vidéos, recherche plein
texte, et tagging automatique par IA — **sans aucun abonnement ni clé d'API
payante**.

L'IA tourne en local via Ollama, en remplacement d'OpenAI. C'est prévu par
Karakeep (`OLLAMA_BASE_URL`), ce n'est pas un détournement.

---

## Pourquoi pas directement sur le téléphone

Trois fonctions de Karakeep dépendent d'un **navigateur sans interface** :
le rendu des pages en JavaScript, les captures d'écran, et l'archivage complet.
Sans lui, la documentation officielle est explicite :

> *« If you run without chrome, crawling will still work, but you'll lose
> ability to take screenshots of websites and websites with javascript content
> won't get crawled correctly. »*

Chrome ne tourne pas sur Android. Aucune installation sur le téléphone — même
via Termux — ne peut donc atteindre 100 % des fonctions. C'est la contrainte qui
impose une machine séparée.

Le téléphone reste ton usage quotidien : l'app Android se connecte au serveur.
Ce dernier n'a pas besoin d'être « constamment consulté », juste allumé quand tu
enregistres un lien.

---

## L'hébergement gratuit

**Oracle Cloud — offre « Always Free »**, la seule qui soit à la fois gratuite
*à vie* et assez dimensionnée pour Karakeep complet :

| | |
|---|---|
| Processeur | 4 cœurs ARM Ampere A1 |
| Mémoire | 24 Go |
| Disque | 200 Go |
| Durée | illimitée, pas d'essai de 12 mois |
| Coût | 0 € (une carte bancaire est demandée pour vérifier l'identité, sans prélèvement) |

Les images `karakeep` et `karakeep-chrome` sont publiées pour **linux/arm64** —
vérifié dans leur workflow de build — donc compatibles avec cette VM.

Alternatives si tu préfères : un vieux PC ou un Raspberry Pi 4/5 (4 Go minimum,
8 Go confortable) à la maison. Le même `docker-compose.yml` fonctionne.

---

## Installation

### 1. Créer la machine

Sur Oracle Cloud : **Compute → Instances → Create instance**

- Image : **Ubuntu 22.04** ou 24.04
- Forme : **VM.Standard.A1.Flex**, 4 OCPU / 24 Go
- Ajoute ta clé SSH publique
- Réseau : autorise le port **3000** en entrée

> La capacité ARM est parfois saturée selon la région. Si la création échoue
> avec « out of capacity », réessaie plus tard ou change de domaine de
> disponibilité.

Ouvre aussi le port dans le pare-feu **de la VM** (Oracle en active un
séparément du pare-feu réseau) :

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 3000 -j ACCEPT
sudo netfilter-persistent save
```

### 2. Installer Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker
```

### 3. Lancer Karakeep

```bash
git clone <ce-dépôt> karakeep && cd karakeep/karakeep-selfhost
./setup.sh
```

Le script demande l'adresse publique du serveur (`http://<ton-ip>:3000`),
génère les secrets dans un `.env` en `chmod 600`, démarre les quatre services,
puis télécharge les modèles Ollama.

**Compte plusieurs minutes** : environ 2 Go pour `qwen2.5:3b` et 4,5 Go pour
`llava:7b`.

### 4. Créer ton compte

Ouvre `http://<ton-ip>:3000` dans un navigateur et inscris-toi. **Le premier
compte créé est l'administrateur.**

Enchaîne ensuite avec :

```bash
echo "DISABLE_SIGNUPS=true" >> .env && docker compose up -d web
```

pour que personne d'autre ne puisse s'inscrire sur ton instance.

### 5. Connecter le téléphone

Installe **Karakeep** depuis le Play Store, puis saisis `http://<ton-ip>:3000`
comme adresse de serveur et connecte-toi.

---

## Ce qui est activé

| Fonction | Réglage | Service requis |
|---|---|---|
| Rendu JavaScript | `BROWSER_WEB_URL` | chrome |
| Captures d'écran pleine page | `CRAWLER_FULL_PAGE_SCREENSHOT` | chrome |
| Archivage intégral | `CRAWLER_FULL_PAGE_ARCHIVE` | chrome + monolith |
| Export PDF | `CRAWLER_STORE_PDF` | chrome |
| Téléchargement de vidéos | `CRAWLER_VIDEO_DOWNLOAD` | yt-dlp (inclus) |
| Blocage pub et bandeaux cookies | `CRAWLER_ENABLE_ADBLOCKER`, `..._AUTOCONSENT` | chrome |
| Recherche plein texte | `MEILI_ADDR` | meilisearch |
| Tagging automatique | `OLLAMA_BASE_URL` | ollama |
| Résumés automatiques | `INFERENCE_ENABLE_AUTO_SUMMARIZATION` | ollama |

### Deux réglages non évidents

**Les délais d'inférence sont très allongés** (`INFERENCE_JOB_TIMEOUT_SEC=600`
au lieu de 30). Sans carte graphique, un modèle 3B met plusieurs dizaines de
secondes à répondre ; les valeurs par défaut feraient échouer chaque tagging.

**Le contexte est porté à 8192 jetons** (défaut : 2048), pour que le modèle voie
une part utile de l'article plutôt que ses premières lignes.

---

## Sécurité

En l'état, l'instance est en **HTTP nu sur une IP publique** : mot de passe et
contenus circulent en clair. Acceptable pour tester, pas pour durer.

Pour du HTTPS gratuit, place un Caddy devant — il obtient un certificat
Let's Encrypt tout seul, à condition d'avoir un nom de domaine (un
sous-domaine DuckDNS gratuit suffit) :

```caddy
karakeep.exemple.duckdns.org {
    reverse_proxy localhost:3000
}
```

Pense alors à passer `NEXTAUTH_URL` en `https://…` dans le `.env`.

---

## Exploitation

```bash
docker compose logs -f web        # journaux
docker compose ps                 # état des services
docker compose pull && docker compose up -d   # mise à jour
```

Sauvegarde : tout tient dans le volume `data` (base et fichiers).

```bash
docker run --rm -v karakeep-selfhost_data:/data -v "$PWD":/sortie \
  alpine tar czf /sortie/karakeep-backup.tgz /data
```

## Si le tagging ne produit rien

Regarde les journaux : `docker compose logs -f web | grep -i inference`.

Cause la plus fréquente : le modèle n'a pas été téléchargé. Vérifie avec
`docker compose exec ollama ollama list`.

Si le modèle répond mais que les tags restent vides, il rend probablement un
format que Karakeep ne sait pas lire. Bascule alors en mode JSON simple :

```bash
echo "INFERENCE_OUTPUT_SCHEMA=json" >> .env && docker compose up -d web
```
