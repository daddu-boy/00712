// relay.js — broadcast a matter to everyone on the same wifi.
//
// This whole module is inert unless the page was served by relay.py. Loaded from
// Netlify there is no /api/whoami, the probe fails, and nothing appears in the
// interface. So the hosted app is exactly what it was.
//
// Who gets the Play control is decided by the relay, not by this code: a request
// from 127.0.0.1 is the Mac running it, anything else is a viewer, and the write
// endpoints refuse viewers outright. There is no token to guard and none to leak.
//
// What travels is the matter, not the picture: outlines, structures, findings and
// which outline is selected. Each viewer renders it themselves and looks wherever
// they like, which is the only workable arrangement in a headset — mirroring one
// person's camera into someone else's head is how you make them ill.

const POLL_MS = 1800;
const PUSH_DEBOUNCE_MS = 400;

export class Relay {
  /**
   * @param {object} io
   *   getProject()  -> the current project object
   *   getSelected() -> the selected layer id
   *   applyState(project, selectedLayerId) -> load a received matter
   *   toast(msg, ms)
   */
  constructor(io) {
    this.io = io;
    this.available = false;
    this.isHost = false;
    this.broadcasting = false;
    this.lastSeenVersion = -1;
    this._pushTimer = null;
    this._pollTimer = null;
  }

  /** Probe for the relay. Resolves to false when served from anywhere else. */
  async init() {
    try {
      const res = await fetch('/api/whoami', { cache: 'no-store' });
      if (!res.ok) return false;
      const info = await res.json();
      if (!info?.relay) return false;
      this.available = true;
      this.isHost = !!info.host;
    } catch {
      return false;                       // not served by the relay: stay invisible
    }

    if (this.isHost) this.#mountHostControl();
    else this.#startWatching();
    return true;
  }

  /* ------------------------------ the host ------------------------------ */

  #mountHostControl() {
    const btn = document.createElement('button');
    btn.id = 'btnBroadcast';
    btn.textContent = 'Broadcast';
    btn.title = 'Show this matter to everyone on your wifi who has the relay address open';
    btn.addEventListener('click', () => this.toggle());
    const anchor = document.querySelector('#btnTheme');
    anchor.parentNode.insertBefore(btn, anchor);
    this.btn = btn;
  }

  async toggle() {
    if (this.broadcasting) return this.stop();
    return this.start();
  }

  async start() {
    const ok = await this.push();
    if (!ok) return;
    this.broadcasting = true;
    this.#paintHostButton();
    this.io.toast('Broadcasting. Anyone on this wifi with the relay address open can see it, and can enter VR from it.', 7000);
  }

  async stop() {
    this.broadcasting = false;
    this.#paintHostButton();
    try {
      await fetch('/api/state', { method: 'DELETE' });
      this.io.toast('Broadcast stopped. It has disappeared from their screens.', 5000);
    } catch {
      this.io.toast('Could not reach the relay to stop it. Quit relay.py to be certain.', 8000);
    }
  }

  /** Send the current matter. Debounced, so a flurry of edits is one push. */
  schedulePush() {
    if (!this.broadcasting) return;
    clearTimeout(this._pushTimer);
    this._pushTimer = setTimeout(() => this.push(), PUSH_DEBOUNCE_MS);
  }

  async push() {
    try {
      const res = await fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: this.io.getProject(),
          selectedLayerId: this.io.getSelected(),
        }),
      });
      if (!res.ok) {
        const why = await res.json().catch(() => ({}));
        this.io.toast(why.error || `The relay refused the update (${res.status}).`, 8000);
        return false;
      }
      return true;
    } catch {
      this.io.toast('Lost the relay. Is relay.py still running?', 8000);
      return false;
    }
  }

  #paintHostButton() {
    if (!this.btn) return;
    this.btn.textContent = this.broadcasting ? 'Stop' : 'Broadcast';
    this.btn.classList.toggle('primary', this.broadcasting);
    this.btn.classList.toggle('live', this.broadcasting);
  }

  /* ----------------------------- the viewers ----------------------------- */

  #startWatching() {
    this.banner = document.createElement('div');
    this.banner.id = 'watchBanner';
    document.body.appendChild(this.banner);
    this.#paintBanner('waiting');
    // The next poll is scheduled in a finally, so a single bad payload or a
    // throw inside applyState cannot silently kill the loop and leave a viewer
    // frozen on an old frame while the banner still claims to be live.
    const tick = async () => {
      try {
        await this.#poll();
      } catch (err) {
        console.warn('relay poll failed', err);
        this.#paintBanner('lost');
      } finally {
        this._pollTimer = setTimeout(tick, POLL_MS);
      }
    };
    tick();
  }

  async #poll() {
    let s;
    try {
      const res = await fetch('/api/state', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      s = await res.json();
    } catch {
      this.#paintBanner('lost');
      return;
    }

    if (!s.live) {
      if (this.wasLive) {
        this.wasLive = false;
        this.io.toast('The broadcast has ended.', 5000);
      }
      this.#paintBanner('waiting');
      return;
    }

    this.wasLive = true;
    this.#paintBanner('live');
    if (s.version === this.lastSeenVersion) return;   // nothing changed
    this.lastSeenVersion = s.version;
    if (s.project) {
      try {
        this.io.applyState(s.project, s.selectedLayerId);
      } catch (err) {
        console.warn('could not apply the broadcast state', err);
        this.io.toast('That update could not be read. Still listening for the next one.', 5000);
      }
    }
  }

  #paintBanner(mode) {
    if (!this.banner || this.bannerMode === mode) return;
    this.bannerMode = mode;
    this.banner.className = mode;
    this.banner.innerHTML = {
      live: '<b>Live</b> Following the host&rsquo;s matter. Look around freely, and enter VR if you like &mdash; your own edits will be replaced on the next update.',
      waiting: '<b>Waiting</b> Nothing is being broadcast yet. This will fill in by itself when the host presses Broadcast.',
      lost: '<b>Disconnected</b> Cannot reach the relay. Check you are still on the same wifi and that it is still running.',
    }[mode];
  }
}
