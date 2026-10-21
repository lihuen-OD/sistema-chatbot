#!/bin/sh
# Roles y bases del proyecto (plan de P1-T3, §5.1 y §5.7). La imagen oficial ejecuta este script
# una sola vez, al inicializar un volumen vacío.
# - sistema_chatbot_dev: dueño de la base de desarrollo; no crea bases ni roles.
# - sistema_chatbot_test: crea bases temporales; no es superusuario, así que PostgreSQL solo le
#   deja borrar las bases de las que es dueño.
set -eu
: "${SISTEMA_CHATBOT_DEV_PASSWORD:?Falta SISTEMA_CHATBOT_DEV_PASSWORD}"
: "${SISTEMA_CHATBOT_TEST_PASSWORD:?Falta SISTEMA_CHATBOT_TEST_PASSWORD}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v dev_password="$SISTEMA_CHATBOT_DEV_PASSWORD" \
  -v test_password="$SISTEMA_CHATBOT_TEST_PASSWORD" <<'SQL'
CREATE ROLE sistema_chatbot_dev LOGIN PASSWORD :'dev_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE sistema_chatbot_dev OWNER sistema_chatbot_dev;
REVOKE CONNECT ON DATABASE sistema_chatbot_dev FROM PUBLIC;

CREATE ROLE sistema_chatbot_test LOGIN PASSWORD :'test_password'
  NOSUPERUSER CREATEDB NOCREATEROLE;
CREATE DATABASE sistema_chatbot_test OWNER sistema_chatbot_test;
REVOKE CONNECT ON DATABASE sistema_chatbot_test FROM PUBLIC;
SQL
