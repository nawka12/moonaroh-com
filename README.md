# Moonaroh - Moona Activity Tracker

Moonaroh (**Moo**na **N**otices & **A**nnouncements: **R**ealtime **O**bservational **H**ub) is a fan-made web application designed to track the live streams, recent videos, music releases, merchandise, and social media updates for the VTuber **Moona Hoshinova** from hololive Indonesia.

It fetches data from Holodex and a self-hosted Nitter instance to provide a consolidated view of Moona's recent activities.

## Features

*   **Live Status:** Shows if Moona is currently live streaming on YouTube.
*   **Upcoming Streams:** Lists scheduled upcoming streams.
*   **Recent Videos:** Displays the latest VODs from Moona's channel.
*   **Recent Tweets:** Fetches recent tweets via a Nitter instance.
*   **Recent Collaborations:** Shows recent videos where Moona collaborated on other channels.
*   **Recent Clips:** Displays recent clips featuring Moona from clipper channels.
*   **Music:** Separate sections for Original Songs and Cover Songs.
*   **Merchandise:** Pulls merchandise data from the official hololive shop.
*   **Career Timeline:** Highlights major milestones in Moona's career.
*   **Time Since Last Activity:** A counter showing how long it's been since the last detected video upload or tweet.
*   **Pull-to-Refresh:** On mobile, pull down to force a refresh of all data.
*   **Background Music:** Plays a looped BGM (can be muted).

## Local Development

For local development and testing:

1.  **Install Dependencies:**
    ```bash
    npm install
    ```
2.  **Configure Environment (Optional but Recommended):**
    *   You might want to temporarily replace `YOUR_HOLODEX_API_KEY` in `script.js` or use environment variables if your setup supports it (Vite uses `.env` files, see Vite documentation).
    *   Update `NITTER_INSTANCE_URL` in `js/tweets.js` to a working public or local instance.
3.  **Run the Development Server:**
    ```bash
    npm run dev
    ```
    This will usually start a local server (often at `http://localhost:5173` or similar - check the terminal output).

## Deployment

This project uses Docker and Docker Compose for deployment. Nginx is used as a web server and reverse proxy, and Certbot is used for obtaining Let's Encrypt SSL certificates. It also includes setup for a self-hosted Nitter instance via Docker.

### Prerequisites

*   Docker
*   Docker Compose
*   A server/VPS with a public IP address
*   Domain names pointing to your server's IP address (for the main app, beta [optional], and optionally Nitter)

### Nitter Setup Options

This project includes scripts to set up a self-hosted Nitter instance using Docker alongside the main application. This is the recommended approach for privacy and reliability. However, you have alternatives:

1.  **Use the Included Self-Hosted Setup (Recommended):** Follow the steps below directly. Requires a dedicated domain/subdomain for Nitter.
2.  **Use a Public Nitter Instance:** Find a reliable public Nitter instance (note: public instances can be unstable). You will need to modify the configuration as described in the "Using an External Nitter Instance" section below.
3.  **Install Nitter Separately:** Follow the official Nitter installation guide ([https://github.com/zedeus/nitter](https://github.com/zedeus/nitter)) to set it up independently (e.g., on a different server or using their manual build process). You will also need to modify this project's configuration as described below.

### Steps (with Included Self-Hosted Nitter)

1.  **Clone the Repository:**
    ```bash
    git clone https://github.com/nawka12/moonaroh-com
    cd moonaroh-com
    ```

2.  **Configure Placeholders:**
    Before deploying, you **MUST** replace the placeholder values in the following files:

    *   **`init-letsencrypt.sh`:**
        *   `domains=(YOUR_DOMAIN.COM YOUR_BETA_DOMAIN.COM YOUR_NITTER_DOMAIN.COM)`: Replace with your actual domain names. **Include your Nitter domain here.**
        *   `email="YOUR_EMAIL@example.com"`: Replace with your email address for Let's Encrypt registration.
        *   `hostname = "YOUR_NITTER_DOMAIN.COM"` (inside `nitter.conf` generation): Ensure this matches your Nitter domain.
        *   `replaceTwitter = "YOUR_NITTER_DOMAIN.COM"` (inside `nitter.conf` generation): Ensure this matches your Nitter domain.
    *   **`nginx.conf`:**
        *   Replace `YOUR_DOMAIN.COM`, `www.YOUR_DOMAIN.COM`, `YOUR_BETA_DOMAIN.COM` with your actual domains in the `server_name` directives.
        *   Update the `include` paths for SSL config if your domain names differ significantly (e.g., `include /etc/nginx/conf.d/ssl-YOUR_DOMAIN.COM.conf*;`).
    *   **`init-letsencrypt.conf`:** (Likely used by the script, ensure consistency)
        *   Replace `YOUR_DOMAIN.COM` and `www.YOUR_DOMAIN.COM` with your main domain.
        *   Update the `ssl_certificate` and `ssl_certificate_key` paths if needed.
    *   **`script.js`:**
        *   `apiKey: 'YOUR_HOLODEX_API_KEY'`: Replace with your actual Holodex API key. You can request one from Holodex. Consider using environment variables or a more secure method instead of hardcoding in production.
    *   **`nitter/sessions.jsonl` (created by `init-letsencrypt.sh` if not present):**
        *   You **MUST** replace the placeholder `ct0` and `auth_token` values with valid Twitter account tokens for Nitter to function reliably. See Nitter documentation for how to obtain these.
    *   **`js/tweets.js`:**
        *   Ensure the `NITTER_INSTANCE_URL` points to your self-hosted Nitter domain (e.g., `https://YOUR_NITTER_DOMAIN.COM`).

3.  **Run the Initialization Script:**
    This script will:
    *   Stop any existing containers defined in `docker-compose.yml`.
    *   Build and start the main application container (`vite-app`).
    *   Request Let's Encrypt certificates for your domains (including Nitter).
    *   Configure Nginx with the SSL certificates.
    *   Set up Nitter configuration files (`nitter.conf`, `sessions.jsonl`, `docker-compose.yml` inside the `nitter` directory).
    *   Create an Nginx virtual host for Nitter within the main app container.
    *   Start the Nitter and Nitter-Redis containers.
    *   Reload Nginx.

    ```bash
    sudo chmod +x init-letsencrypt.sh
    sudo ./init-letsencrypt.sh
    ```
    *Note: The script uses `sudo` for Docker commands and file operations in system directories within the container.*

    **Important Disclaimer:** The provided `init-letsencrypt.sh` script was written to address specific quirks and configurations encountered on the original author's VPS setup for `moonaroh.com`. It includes workarounds and steps tailored to that environment. **This script is NOT guaranteed to work on your server out-of-the-box.** You may encounter issues related to file paths, permissions, specific Docker/Nginx/Certbot versions, or OS differences. It is **strongly recommended** that you review the script thoroughly, understand its commands, and adapt it to your own server environment, or preferably, write your own deployment script based on the steps outlined here.

4.  **Access the Site:**
    *   Your main application should be available at `https://YOUR_DOMAIN.COM`.
    *   Your Nitter instance should be available at `https://YOUR_NITTER_DOMAIN.COM`.

### Using an External Nitter Instance (Public or Separate Self-Host)

If you are *not* using the included self-hosted Nitter setup:

1.  **Modify `init-letsencrypt.sh`:**
    *   **Remove** your Nitter domain from the `domains=(...)` array.
    *   **Remove** the sections related to creating `nitter/nitter.conf`, `nitter/docker-compose.yml`, and `nitter-vhost.conf`.
    *   **Remove** the lines that run `cd nitter && sudo docker-compose ...` and `cd ..`.
    *   **Remove** the `docker cp nitter-vhost.conf ...` line.
    *   **Remove** the final Nginx reload command related to Nitter (or ensure Nginx reloads only once at the end).
2.  **Modify `js/tweets.js`:**
    *   Change the `NITTER_INSTANCE_URL` constant to the URL of the public or separate Nitter instance you want to use (e.g., `https://nitter.net`).
3.  **Configure Placeholders:** Follow Step 2 of the main deployment guide, but **skip** the Nitter-specific parts mentioned there (like `hostname` and `replaceTwitter` in `init-letsencrypt.sh` and the `nitter/sessions.jsonl` file).
4.  **Run the Modified Initialization Script:**
    ```bash
    sudo chmod +x init-letsencrypt.sh
    sudo ./init-letsencrypt.sh
    ```
5.  **Access the Site:** Your main application should be available at `https://YOUR_DOMAIN.COM`. Twitter data will be pulled from the external Nitter instance configured in `js/tweets.js`.

### Updating

To update the application:

1.  Pull the latest changes: `git pull`
2.  Rebuild and restart the containers: `sudo docker-compose down && sudo docker-compose up -d --build`
3.  If Nitter configuration or dependencies changed, you might need to navigate to the `nitter` directory and run `sudo docker-compose down && sudo docker-compose up -d --build`.
4.  If Nginx configuration changed, reload it: `sudo docker exec vite-app nginx -s reload`

## Customizing for Other Talents (e.g., Airani Iofifteen)

To adapt this project for a different VTuber:

1.  **Find the Talent's YouTube Channel ID:** You can usually find this in the URL of their YouTube channel (e.g., `https://www.youtube.com/channel/UCAoy6rzhSf4ydcYjJw3WoVg` -> `UCAoy6rzhSf4ydcYjJw3WoVg`).
2.  **Update `js/constants.js`:**
    *   Change the `TALENT_CHANNEL_ID` constant to the new channel ID.
    *   Update `NON_VTUBER_COVER_COLLABS` if the new talent has similar hardcoded collaborations you want to include.
3.  **Update `js/career-timeline.js`:**
    *   Replace the `CAREER_TIMELINE` array content with milestones relevant to the new talent.
4.  **Update Talent-Specific Info:**
    *   **`index.html`:** Change the OG image (`og:image`, `twitter:image`), meta descriptions, titles, and potentially the Nitter link in the credits popup footer.
    *   **`assets/`:** Replace the background music (`ada_moona_peko.mp3`) if desired.
    *   **`script.js`:** Review the logic for filtering original/cover songs (lines ~180-400). There might be specific video IDs or titles hardcoded for Moona that need removal or adjustment for the new talent. Also review the `showSpecialPopup` function if you want to adapt the birthday message.
    *   **`js/get-merch.js`:** Update the `SHOP_URL` to the new talent's official merchandise page URL on `shop.hololivepro.com` or modify the scraping logic if the source is different.
    *   **`js/tweets.js`:** Update the `TWITTER_PROFILE_URL` to the new talent's profile URL on your Nitter instance.
5.  **Rebuild and Deploy:** Follow the deployment steps above.

## Contributing

This is a personal project. Contributions are welcome, but please open an issue first to discuss proposed changes.

## Disclaimer

This is a fan-made project and is not affiliated with Moona Hoshinova, hololive, COVER Corp, Holodex, or Twitter/X Corp. Data accuracy depends on the availability and reliability of the APIs used. 