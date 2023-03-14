#!/bin/bash

cd /SERVICE

CONFIG_ARGS="s|CONFIG_SERVER_HOST|${CONFIG_SERVER_HOST}|g;\
            s|CONFIG_SERVER_PORT|${CONFIG_SERVER_PORT}|g;\
        	s|CONFIG_API_PREFIX|${CONFIG_API_PREFIX}|g;\
        	s|CONFIG_STRATEGY|${CONFIG_STRATEGY}|g;\
        	s|CONFIG_WHITELIST_IPS|${CONFIG_WHITELIST_IPS}|g;\
        	s|CONFIG_MSSQL_HOST|${CONFIG_MSSQL_HOST}|g;\
        	s|CONFIG_MSSQL_PORT|${CONFIG_MSSQL_PORT}|g;\
        	s|CONFIG_MSSQL_USERNAME|${CONFIG_MSSQL_USERNAME}|g;\
        	s|CONFIG_MSSQL_PASSWORD|${CONFIG_MSSQL_PASSWORD}|g;\
        	s|CONFIG_MSSQL_DB_NAME|${CONFIG_MSSQL_DB_NAME}|g;\
        	s|CONFIG_SECRET_SIGN_KEY|${CONFIG_SECRET_SIGN_KEY}|g;\
        	s|CONFIG_ACCESS_TOKEN_SECRET|${CONFIG_ACCESS_TOKEN_SECRET}|g;\
        	s|CONFIG_REFRESH_TOKEN_SECRET|${CONFIG_REFRESH_TOKEN_SECRET}|g;\
        	s|CONFIG_EXPIRE_TIME|${CONFIG_EXPIRE_TIME}|g;\
        	s|CONFIG_REDIS_HOST|${CONFIG_REDIS_HOST}|g;\
        	s|CONFIG_REDIS_PORT|${CONFIG_REDIS_PORT}|g;\
        	s|CONFIG_REDIS_PASSWORD|${CONFIG_REDIS_PASSWORD}|g;\
        	s|CONFIG_REDIS_DB|${CONFIG_REDIS_DB}|g"

sed -i -e "$CONFIG_ARGS" .env

npm start

exec "$@"