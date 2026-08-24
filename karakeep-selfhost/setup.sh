#!/usr/bin/env bash
#
# Prépare et démarre Karakeep : génère les secrets, écrit le .env, lance la
# pile, puis télécharge les modèles Ollama.
#
# À exécuter sur le serveur, dans ce répertoire :
#   ./setup.sh

set -euo pipefail

cd "$(dirname "$0")"

command -v docker >/dev/null 2>&1 || {
  echo "Erreur : docker est introuvable. Installe-le d'abord (voir README.md)." >&2
  exit 1
}
docker compose version >/dev/null 2>&1 || {
  echo "Erreur : le plugin 'docker compose' est absent." >&2
  exit 1
}

if [ -f .env ]; then
  echo ".env existe déjà — les secrets sont conservés."
else
  # NEXTAUTH_SECRET signe les jetons de session : le régénérer déconnecterait
  # tous les appareils. On ne l'écrit qu'une fois.
  SECRET="$(openssl rand -base64 36)"
  MEILI_KEY="$(openssl rand -base64 36 | tr -dc 'A-Za-z0-9')"

  read -rp "Adresse publique du serveur (ex. http://123.45.67.89:3000) : " ADDR
  ADDR="${ADDR:-http://localhost:3000}"

  cat > .env <<EOF
# Généré par setup.sh — contient des secrets, ne jamais publier.
KARAKEEP_VERSION=0.33.2

NEXTAUTH_SECRET=$SECRET
NEXTAUTH_URL=$ADDR
MEILI_MASTER_KEY=$MEILI_KEY

# Modèles Ollama. qwen2.5:3b suffit au tagging et tourne correctement sur
# processeur. Pour de meilleurs tags sur une machine confortable, essaie
# qwen2.5:7b.
INFERENCE_TEXT_MODEL=qwen2.5:3b
INFERENCE_IMAGE_MODEL=llava:7b
INFERENCE_LANG=french
EOF
  chmod 600 .env
  echo ".env créé."
fi

# shellcheck disable=SC1091
set -a; . ./.env; set +a

echo
echo "Démarrage de la pile…"
docker compose up -d

echo
echo "Téléchargement des modèles Ollama (plusieurs Go, une seule fois)…"
docker compose exec -T ollama ollama pull "${INFERENCE_TEXT_MODEL}"
# Le modèle de vision ne sert qu'au tagging des images ; son échec ne doit pas
# interrompre l'installation.
docker compose exec -T ollama ollama pull "${INFERENCE_IMAGE_MODEL}" || {
  echo "Avertissement : ${INFERENCE_IMAGE_MODEL} n'a pas pu être téléchargé."
  echo "Le tagging des textes fonctionnera, celui des images non."
}

echo
echo "Terminé."
echo "  Interface web : ${NEXTAUTH_URL}"
echo "  Crée ton compte, puis renseigne cette même adresse dans l'app Android."
echo
echo "Suivre les journaux :  docker compose logs -f web"
