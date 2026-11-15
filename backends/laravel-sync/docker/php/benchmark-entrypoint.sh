#!/bin/sh
# Entrypoint de produção para o baseline (sync). Prepara os caches do Laravel uma única vez
# antes de servir, para que o caminho quente de GET /usuarios/{id} não pague bootstrap repetido.
# Idempotente: cada subida regenera os caches a partir do código/ambiente atuais.
set -eu

cd /var/www/html

# Autoloader classmap otimizado (sem dev). O vendor/ vem montado do host; --optimize regenera o mapa.
composer dump-autoload --optimize --no-dev --no-interaction 2>/dev/null || \
  composer dump-autoload --optimize --no-interaction

# Cache de configuração e de rotas (produção). clear antes evita cache obsoleto de execuções anteriores.
php artisan config:clear
php artisan route:clear
php artisan config:cache
php artisan route:cache

exec php-fpm
