// Landing page behaviour. No framework, no tracking. The only network call is to GitHub's public API,
// to show the latest version, direct download links and the total download count.
(() => {
  const REPO = "abidkakkur11/damu-companion";
  const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;
  const $ = (id) => document.getElementById(id);
  document.documentElement.classList.add("js");

  // ----- scroll reveal -----
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const items = [...document.querySelectorAll(".reveal")];
  if (reduced || !("IntersectionObserver" in window)) {
    items.forEach((el) => el.classList.add("in"));
  } else {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      }
    }, { rootMargin: "0px 0px -8% 0px" });
    items.forEach((el, i) => {
      el.style.transitionDelay = `${(i % 3) * 70}ms`;
      io.observe(el);
    });
  }

  $("year").textContent = new Date().getFullYear();

  // ----- Damu says things -----
  const lines = [
    { pose: "neutral", text: "ഞാൻ ദശമൂലം ദാമു.. എന്നെ വിശ്വസിക്കാം.." },
    { pose: "looking-up", text: "ഒരു പ്രൊട്ടക്ഷൻ എന്ന നിലയിൽ ഒരു കാവൽ പട്ടിയെപ്പോലെ എന്നും ഞാൻ ഉണ്ടാവും.." },
    { pose: "warning", text: "ചില മുതലാളിമാർ ഒക്കെ അങ്ങനാ പരമു പിള്ളേ.." },
    { pose: "nail-look", text: "ഇനി നമ്മള് എന്ത് സെയ്യും മല്ലയ്യ?" },
  ];
  let idx = 0;
  let timer;
  const bubble = $("bubble");
  const text = $("bubble-text");
  const img = $("damu-img");
  lines.forEach((l) => { const i = new Image(); i.src = `assets/damu-${l.pose}.webp`; }); // preload poses

  function say(i) {
    idx = (i + lines.length) % lines.length;
    const l = lines[idx];
    text.textContent = l.text;
    img.src = `assets/damu-${l.pose}.webp`;
    bubble.classList.add("swap");
    void bubble.offsetWidth;
    bubble.classList.remove("swap");
  }
  function auto() {
    clearInterval(timer);
    if (!reduced) timer = setInterval(() => say(idx + 1), 6500);
  }
  $("damu").addEventListener("click", () => { say(idx + 1); auto(); });
  auto();

  // ----- OS detection -----
  const ua = navigator.userAgent || "";
  const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
  const isMobile = /Android|iPhone|iPad|iPod/i.test(ua);
  const os = isMobile ? "other" : /Mac/i.test(platform) || /Mac OS X/i.test(ua) ? "mac" : /Win/i.test(platform) || /Windows/i.test(ua) ? "win" : "other";

  const fmtSize = (b) => `${(b / 1048576).toFixed(0)} MB`;
  const fmtNum = (n) => new Intl.NumberFormat().format(n);

  // ----- latest release, direct links, download count -----
  async function loadReleases() {
    const key = "damu-releases-v1";
    try {
      const cached = JSON.parse(sessionStorage.getItem(key) || "null");
      if (cached && Date.now() - cached.t < 10 * 60 * 1000) return cached.d;
    } catch {}
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const data = await res.json();
    try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), d: data })); } catch {}
    return data;
  }

  function setPrimary(label, meta, href) {
    $("dl-primary-label").textContent = label;
    $("dl-primary-meta").textContent = meta;
    $("dl-primary").href = href;
  }

  loadReleases().then((releases) => {
    const published = releases.filter((r) => !r.draft && !r.prerelease);
    const latest = published[0];
    if (!latest) throw new Error("no release yet");

    const win = latest.assets.find((a) => /\.exe$/i.test(a.name));
    const mac = latest.assets.find((a) => /\.dmg$/i.test(a.name));
    const version = latest.tag_name.replace(/^v/, "");
    const date = new Date(latest.published_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    $("release-line").textContent = `Version ${version} · released ${date}`;

    if (win) {
      $("dl-win").href = win.browser_download_url;
      $("meta-win").textContent = `${win.name} · ${fmtSize(win.size)}`;
    }
    if (mac) {
      $("dl-mac").href = mac.browser_download_url;
      $("meta-mac").textContent = `${mac.name} · ${fmtSize(mac.size)}`;
    }

    const cards = { win: $("card-win"), mac: $("card-mac") };
    if (cards[os]) cards[os].classList.add("is-you");
    const mine = os === "win" ? win : os === "mac" ? mac : null;
    if (mine) {
      setPrimary(`Download for ${os === "win" ? "Windows" : "Mac"}`, `Version ${version} · ${fmtSize(mine.size)}`, mine.browser_download_url);
    } else {
      setPrimary("Download Damu", `Version ${version} · Windows and macOS`, "#download");
    }

    const total = releases.flatMap((r) => r.assets).filter((a) => /\.(exe|dmg)$/i.test(a.name)).reduce((s, a) => s + a.download_count, 0);
    if (total > 0) {
      $("stat-count").textContent = fmtNum(total);
      $("stat").hidden = false;
    }
  }).catch(() => {
    // Offline, rate-limited or no release yet: the buttons fall back to the releases page.
    $("release-line").textContent = "See the releases page for the latest version.";
    if (os === "win" || os === "mac") {
      setPrimary(`Download for ${os === "win" ? "Windows" : "Mac"}`, "Latest version on GitHub", RELEASES_URL);
    }
  });
})();
