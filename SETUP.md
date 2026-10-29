# Setup

Three things, in this order: test locally, set up Firebase, publish on GitHub Pages.

## 1. Test locally (today, no accounts needed)

```sh
cd ~/code/halloween
python3 -m http.server 8000
```

- Brain: <http://localhost:8000/>. Press **START ROBOT**, allow the camera, and watch the simulator.
- Guest page: <http://localhost:8000/mind.html?relay=local>, in a second tab of the **same** browser.
- In the brain's Setup panel, set **Relay → local** and reload. Thoughts now show up in the guest tab, and riddle answers go to the brain.
- Paste your Anthropic key into **Setup → Anthropic API key → SAVE KEY**. Without a key, reactions use canned lines and the guest game won't render emotes, which is the fail-safe behaviour.
- Useful buttons: **REACT NOW** forces a reaction, **CRASH GAG** runs the crash, and **TALK MODE** does what covering the lens does.

### On your Android phone, before Pages is live

Camera and Bluetooth need HTTPS or `localhost`. Use Chrome's port forwarding:

1. Phone: Settings → About phone → tap *Build number* 7× → Developer options → enable **USB debugging**.
2. Plug the phone into the laptop. On the laptop, open `chrome://inspect/#devices` and allow the prompt on the phone.
3. Click **Port forwarding…**, add `8000` → `localhost:8000`, tick *Enable port forwarding* and click Done.
4. On the phone, open `http://localhost:8000/` in Chrome. It counts as a secure origin.

## 2. Firebase relay (about 10 minutes)

1. Go to <https://console.firebase.google.com/> and click **Create a project** (or *Add project*).
   - Name: `halloween-robot`. Continue.
   - Google Analytics: **off** (not needed). Click **Create project**, then Continue.
2. In the left sidebar, open **Build → Realtime Database** and click **Create Database**.
   - Location: the default (`us-central1`) is fine. Next.
   - Choose **Start in test mode** and click **Enable**. You'll replace these rules in step 6.
3. Click the gear ⚙ next to *Project overview*, then **Project settings → General**. Scroll to *Your apps* and click the **Web** icon `</>`.
   - Nickname: `mind`. Leave *Firebase Hosting* **unticked**. Click **Register app**.
   - Copy the `firebaseConfig = { … }` object it shows. Make sure it contains `databaseURL`. If it doesn't, copy the URL shown at the top of the Realtime Database *Data* tab (like `https://halloween-robot-default-rtdb.firebaseio.com`) and add it as `databaseURL`.
   - **Paste only that config object back to Claude.** It's public and safe to commit, and it goes into `firebase-config.js`.
4. Create the phone's write token, **on the phone**:
   - Open the brain page and go to **Setup → Relay write token**. Tap **GENERATE**, then **SAVE**, then **SHOW / COPY**.
   - Get it to the laptop privately (for example, type it in). Don't paste it into the repo or into chat.
5. Store the token in the database, in the **Realtime Database → Data** tab:
   - Hover over the root and click **+**. Name `admin`, leave the value empty, and click **+** on that new row to add a child with name `token` and value set to the token string. Click **Add**.
   - Result: `admin/token = "<your token>"`.
6. In the **Realtime Database → Rules** tab, replace everything with the contents of [`database.rules.json`](database.rules.json) and click **Publish**.
7. On the phone, set **Setup → Relay → firebase** and reload. The status pill should read `RELAY FIREBASE`, and the guest page should say `● ONLINE` within a minute.

How the rules work:
- Anyone can read `thoughts` and `status`.
- Guests can only add small, shape-checked `requests`.
- Each guest reads only `replies/<their random id>`.
- Phone writes carry an unreadable `proof/<nonce>` that must equal `admin/token`, so only a device that knows the token can post thoughts or replies.
- The token is never stored anywhere readable, and the repo doesn't contain it.
- Guest request texts are readable by anyone who has the database URL for the few seconds before the phone deletes them. That's fine for a party toy.

To rotate the token: generate a new one on the phone, save it, and replace `admin/token` in the console.

## 3. GitHub Pages (Claude asks before pushing)

1. On github.com, create a new **public**, **empty** repo named `halloween` under `juelg`, with no README, license or .gitignore. This doesn't touch the `juelg.github.io` repo.
2. Tell Claude. It adds the remote and pushes `main`.
3. In the repo, open **Settings → Pages → Build and deployment**. Set *Source* to **Deploy from a branch**, *Branch* to **main** and folder **/ (root)**, then Save.
4. After about a minute, open:
   - brain: <https://juelg.github.io/halloween/> (bookmark it on the phone)
   - guests: <https://juelg.github.io/halloween/mind.html>, which is what the QR code points to.

   If your user site has a custom domain, project pages redirect to it. The QR code points at the github.io URL, which still redirects correctly.
5. Print `qr.html`. It's 4 tags per page with a PRINT button, or use `qr.png`.

## Friday: mask lab (once the mask arrives)

1. Charge the mask, switch it on, and close the *Shining Mask* app so it isn't holding the Bluetooth connection.
2. On the brain page, tap **CONNECT MASK**, pick your mask (`MASK-xxxx`) in Chrome's chooser, then open **MASK LAB**.
3. **Brightness:** the slider sends `LIGHT`. Around 60–100 is the sweet spot; above ~128 it flickers.
4. **Built-in faces:** with *IMAG* selected, step through ids with − / +. When an image fits an expression, choose that expression and tap **ASSIGN**. Do the same with *ANIM* for `thinking`, `sleep`, `glitch` and `scan`. Run **CYCLE ALL FACES** to check them all.
5. **Scrolling text:** tap **SCROLL TEXT**. If nothing shows, try toggling *pad upload packets*.
6. **Custom bitmap:** tap **UPLOAD TEST BITMAP**. You should see a smiley with a rainbow bar.
   - If it's cut off or offset, set **Mask width** to the number of LED columns you count and tap SAVE & RELOAD.
   - If the upload fails, guest emotes fall back to scrolling their caption, and everything else still works.
7. Optional: set *Faces on real mask* to **upload our pixels** to use the simulator's faces instead of built-ins. It looks consistent, but each face change takes a short upload.

## Wearing it

- **START ROBOT** holds a wake lock so the screen stays on. Turn **Battery saver** on to halve detection fps, slow the simulator and dim the mask.
- **Talk mode:** cover the lens for ~2 s to pause reactions, and cover again to resume. While a guest emote is queued or showing, covering the lens **vetoes** it instead. During a selfie offer, it cancels the selfie.
- Selfies are taken only with ≥ 3 people and a 👍. They're saved to the phone's Downloads and to the *Selfies* panel, and never uploaded.
- To change any timing, edit `js/config.js`.
