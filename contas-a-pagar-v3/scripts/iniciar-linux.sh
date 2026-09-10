#!/usr/bin/env sh
set -e
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Crie .env a partir de .env.example"; exit 1; }
[ -d node_modules ] || npm install
npm start
