#!/bin/sh
set -eu

umask 077
: "${AUTH_DIR:=/data/auth}"

mkdir -p "$AUTH_DIR"
chown -R node:node "$AUTH_DIR"
chmod 700 "$AUTH_DIR"

exec gosu node "$@"
