#!/bin/bash

# Cô Sign: local development setup.
# Installs the npm dependencies and copies .env.example to .env.local when
# there is no .env.local yet. It sets up no database: see README.md,
# "Getting Started", for the Supabase step.

set -e

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

if ! command_exists node; then
    echo "Node.js is not installed. Install Node.js 20.19 or later from https://nodejs.org/"
    exit 1
fi
if ! command_exists npm; then
    echo "npm is not installed."
    exit 1
fi
echo "Node.js $(node -v), npm $(npm -v)"

echo "Installing npm dependencies..."
npm install

if [ ! -f .env.local ]; then
    cp .env.example .env.local
    echo "Created .env.local from .env.example: fill in your settings there."
else
    echo ".env.local already exists; left as it is."
fi

echo ""
echo "Next: set up the database and start the app (README.md, Getting Started)."
