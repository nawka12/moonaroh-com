#!/bin/bash

domains=(YOUR_DOMAIN.COM YOUR_BETA_DOMAIN.COM YOUR_NITTER_DOMAIN.COM)
email="YOUR_EMAIL@example.com"
staging=0

echo "### Creating directories..."
mkdir -p certbot/conf
mkdir -p certbot/www
mkdir -p nitter

# Function to check if certificate exists and is not expired
check_cert() {
    local domain=$1
    local cert_path="certbot/conf/live/$domain/fullchain.pem"
    
    if [ -f "$cert_path" ]; then
        # Check expiration date
        local exp_date=$(openssl x509 -enddate -noout -in "$cert_path" | cut -d= -f2)
        local exp_epoch=$(date -d "$exp_date" +%s)
        local now_epoch=$(date +%s)
        local days_left=$(( ($exp_epoch - $now_epoch) / 86400 ))
        
        if [ $days_left -gt 30 ]; then
            echo "Certificate for $domain is still valid for $days_left days. Skipping renewal."
            return 0
        fi
    fi
    return 1
}

echo "### Stopping existing containers..."
sudo docker-compose down

# Create a shared network for containers to communicate
echo "### Creating Docker network for container communication..."
sudo docker network create mnrh-network || true

echo "### Building and starting app service..."
sudo docker-compose up -d --build app

# Connect the app container to the network
echo "### Connecting app container to the shared network..."
sudo docker network connect mnrh-network vite-app || true

echo "### Waiting for app service to start..."
sleep 10

echo "### Checking and requesting Let's Encrypt certificates..."
for domain in "${domains[@]}"; do
    if check_cert "$domain"; then
        # Certificate exists and is valid - create SSL config
        echo "### Using existing certificate for $domain..."
        echo "ssl_certificate /etc/letsencrypt/live/$domain/fullchain.pem;" > "ssl-$domain.conf"
        echo "ssl_certificate_key /etc/letsencrypt/live/$domain/privkey.pem;" >> "ssl-$domain.conf"
    else
        echo "### Requesting certificate for $domain..."
        sudo docker-compose run --rm certbot \
            certonly \
            --webroot \
            --webroot-path /var/www/certbot \
            --email $email \
            -d $domain \
            --agree-tos \
            --no-eff-email \
            --keep-until-expiring \
            --cert-name $domain \
            -v || {
                echo "### Warning: Certificate request failed for $domain"
                # Use default certificate if request fails
                echo "ssl_certificate /etc/nginx/ssl/default.pem;" > "ssl-$domain.conf"
                echo "ssl_certificate_key /etc/nginx/ssl/default.key;" >> "ssl-$domain.conf"
            }
    fi
    
    # Check if the SSL config file was created
    if [ ! -f "ssl-$domain.conf" ]; then
        echo "### Creating missing SSL config for $domain..."
        echo "ssl_certificate /etc/letsencrypt/live/$domain/fullchain.pem;" > "ssl-$domain.conf"
        echo "ssl_certificate_key /etc/letsencrypt/live/$domain/privkey.pem;" >> "ssl-$domain.conf"
    fi
    
    # Copy SSL config to nginx
    sudo docker cp "ssl-$domain.conf" vite-app:/etc/nginx/conf.d/
done

echo "### Reloading nginx..."
sudo docker-compose exec app nginx -s reload || {
    echo "### Warning: Failed to reload nginx. Restarting container..."
    sudo docker-compose restart app
}

# Setup Nitter - IMPROVED VERSION
echo "### Setting up Nitter..."

# Fix nitter.conf if it's a directory
if [ -d "nitter/nitter.conf" ]; then
    echo "### Fixing nitter.conf (was a directory, should be a file)..."
    sudo rm -rf nitter/nitter.conf
fi

# Create proper nitter.conf
echo "### Creating nitter.conf..."
cat > nitter/nitter.conf << 'EOF'
[Server]
hostname = "YOUR_NITTER_DOMAIN.COM"
title = "Nitter"
address = "0.0.0.0"
port = 8080
https = true
httpMaxConnections = 100
staticDir = "./public"

[Cache]
listMinutes = 240
rssMinutes = 10
redisHost = "nitter-redis"
redisPort = 6379
redisPassword = ""
redisConnections = 20
redisMaxConnections = 30

[Config]
hmacKey = "changeme_with_random_string"
base64Media = false
enableRSS = true
enableDebug = false
proxy = ""
proxyAuth = ""

[Preferences]
theme = "Nitter"
replaceTwitter = "YOUR_NITTER_DOMAIN.COM"
replaceYouTube = "piped.video"
replaceReddit = "teddit.net"
proxyVideos = true
hlsPlayback = false
infiniteScroll = false
EOF

# Fix sessions.jsonl if it's a directory
if [ -d "nitter/sessions.jsonl" ]; then
    echo "### Fixing sessions.jsonl (was a directory, should be a file)..."
    sudo rm -rf nitter/sessions.jsonl
fi

# Check for sessions.jsonl file
if [ ! -f "nitter/sessions.jsonl" ]; then
    echo "### Warning: sessions.jsonl not found. Creating placeholder..."
    echo "### Please replace with real Twitter tokens before deployment."
    echo '{"ct0":"REPLACE_WITH_REAL_CT0","auth_token":"REPLACE_WITH_REAL_AUTH_TOKEN"}' > nitter/sessions.jsonl
fi

# Create docker-compose.yml for Nitter
echo "### Creating docker-compose.yml for Nitter..."
cat > nitter/docker-compose.yml << 'EOF'
version: "3"

services:
  nitter:
    image: zedeus/nitter:latest
    container_name: nitter
    ports:
      - "127.0.0.1:8080:8080"
    volumes:
      - ./nitter.conf:/src/nitter.conf:ro
      - ./sessions.jsonl:/src/sessions.jsonl:ro
    depends_on:
      - nitter-redis
    restart: unless-stopped
    networks:
      - default
      - mnrh-network
    healthcheck:
      test: wget -nv --tries=1 --spider http://127.0.0.1:8080/Jack/status/20 || exit 1
      interval: 30s
      timeout: 5s
      retries: 2

  nitter-redis:
    image: redis:6-alpine
    container_name: nitter-redis
    command: redis-server --save 60 1 --loglevel warning
    volumes:
      - nitter-redis:/data
    restart: unless-stopped
    networks:
      - default
    healthcheck:
      test: redis-cli ping
      interval: 30s
      timeout: 5s
      retries: 2

volumes:
  nitter-redis:

networks:
  default:
  mnrh-network:
    external: true
EOF

# Create Nginx virtual host configuration for Nitter
echo "### Creating Nginx config for Nitter in main app..."
cat > nitter-vhost.conf << 'EOF'
server {
    listen 80;
    server_name YOUR_NITTER_DOMAIN.COM;
    
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    
    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name YOUR_NITTER_DOMAIN.COM;
    
    ssl_certificate /etc/letsencrypt/live/YOUR_NITTER_DOMAIN.COM/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/YOUR_NITTER_DOMAIN.COM/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    
    location / {
        proxy_pass http://nitter:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 90;
        proxy_connect_timeout 90;
    }
}
EOF

# Copy Nginx config to main app container
echo "### Copying Nitter Nginx config to main app container..."
sudo docker cp nitter-vhost.conf vite-app:/etc/nginx/conf.d/nitter.conf

# Start Nitter containers
echo "### Starting Nitter containers..."
cd nitter && sudo docker-compose down && sudo docker-compose up -d && cd ..

# Reload Nginx in the main app container
echo "### Reloading Nginx in main app container..."
sudo docker exec vite-app nginx -t && sudo docker exec vite-app nginx -s reload

echo "### Setup complete!"
echo "Nitter should now be accessible at https://YOUR_NITTER_DOMAIN.COM"
echo "IMPORTANT: Remember to update nitter/sessions.jsonl with valid Twitter tokens!" 