FROM node:20-alpine AS build
WORKDIR /app

# Copy package files first
COPY package*.json ./

# Install dependencies with specific flags
RUN npm install

# Copy rest of the files
COPY . .

# Build with specific memory allocation
RUN NODE_OPTIONS="--max-old-space-size=512" npm run build

FROM nginx:alpine
# Create default self-signed certificate
RUN apk add --no-cache openssl && \
    mkdir -p /etc/nginx/ssl && \
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /etc/nginx/ssl/default.key \
    -out /etc/nginx/ssl/default.pem \
    -subj "/CN=localhost"

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY moonaroh.html /usr/share/nginx/html/moonaroh.html
COPY assets/ada_moona_peko.mp3 /usr/share/nginx/html/assets/ada_moona_peko.mp3
