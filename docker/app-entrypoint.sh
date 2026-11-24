#!/bin/sh
# Starts the app. Reads the keys made on first boot (scripts/docker/gen-keys.js)
# from /keys/supabase.env when that file is there. Never print a key here.
set -eu

if [ -f /keys/supabase.env ]; then
  . /keys/supabase.env
  export SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY
fi

exec node server.js "$@"
