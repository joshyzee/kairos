# Installing Selah

About 5 minutes, once. Do step 1 on your laptop, then steps 2 and 3.

## 1. Make your private key (laptop, 2 minutes)

This key is what lets only your devices read and write your check-ins.

1. Go to **github.com → your photo → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. **Token name:** `Selah`. **Expiration:** the longest it allows. Put a reminder in your calendar a week before it expires.
3. **Repository access:** *Only select repositories* → pick **selah-data**.
4. **Permissions → Repository permissions → Contents:** *Read and write*. Leave everything else as it is.
5. Click **Generate token** and copy it. Save it in your iPhone **Passwords** app (as "Selah key") so you can paste it on both devices.

Never share this key. If you lose a device, delete the token on GitHub and make a new one.

## 2. iPhone (2 minutes)

1. Open **Safari** (it must be Safari) and go to **joshyzee.github.io/selah**.
2. Tap **Share → Add to Home Screen**. Make sure **Open as Web App** is on, then tap **Add**.
3. Open **Selah from your Home Screen** (not Safari), paste your key and tap **Unlock**.
4. Go to **Settings → Turn on reminders → Allow**.

You'll now get: 06:30 morning check-in, 09:30 nudge if you missed it, 21:30 evening check-in, 22:45 nudge if you missed it. Tapping a reminder opens the right check-in.

## 3. Laptop (1 minute)

1. Open **joshyzee.github.io/selah** in Chrome or Edge.
2. Paste your key and tap **Unlock**.
3. Click the **install icon** at the right of the address bar to give Selah its own window and Start-menu icon.

## Good to know

- **Sunday review** appears on the Today screen from Saturday evening to Monday midday.
- **Missed a night?** The next morning shows a catch-up card for last night.
- **Private journal:** tick "Just for me" and Claude's daily briefing will never read that entry.
- **Offline:** check-ins save on the device and sync when you're back online.
- **Your data** lives in the private repo `joshyzee/selah-data`. Settings → *Download my data* gives you a copy any time.
- **Claude's briefing** runs at 05:00 every day: verse for the season, fact or quote, calendar questions, warnings, question of the week, and on the 1st, your monthly growth score.
