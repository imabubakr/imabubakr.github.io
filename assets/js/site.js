// Theme toggle (stored choice overrides prefers-color-scheme), plates viewer,
// nav section highlight, and keeping the language switch on the current section.
(function () {
  var root = document.documentElement;
  var themeButtons = document.querySelectorAll("[data-set-theme]");
  var systemDark = window.matchMedia("(prefers-color-scheme: dark)");

  function currentTheme() {
    return root.dataset.theme || (systemDark.matches ? "dark" : "light");
  }

  function sync() {
    var theme = currentTheme();
    themeButtons.forEach(function (btn) {
      btn.setAttribute("aria-pressed", String(btn.dataset.setTheme === theme));
    });
  }

  themeButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var next = btn.dataset.setTheme;
      root.dataset.theme = next;
      try {
        localStorage.setItem("theme", next);
      } catch (e) {}
      sync();
    });
  });
  systemDark.addEventListener("change", sync);
  sync();

  // Plates viewer: clicking a plate opens it large in a <dialog> (animations play
  // there unless reduced motion is on); arrow keys step through, Esc closes.
  var plateLinks = Array.prototype.slice.call(document.querySelectorAll(".plate-link"));
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (plateLinks.length && window.HTMLDialogElement) {
    var de = document.documentElement.lang === "de";
    var box = document.createElement("dialog");
    box.className = "lightbox";
    box.setAttribute("aria-label", de ? "Visualisierung" : "Visualization");
    box.innerHTML =
      '<div class="lb-stage"></div><div class="lb-bar"><span class="lb-no"></span><p class="lb-caption"></p>' +
      '<div class="lb-nav"><button type="button" data-step="-1">' + (de ? "zurück" : "prev") + "</button>" +
      '<button type="button" data-step="1">' + (de ? "weiter" : "next") + "</button>" +
      '<button type="button" class="lb-close">' + (de ? "schließen" : "close") + "</button></div></div>";
    document.body.appendChild(box);
    var stage = box.querySelector(".lb-stage");
    var current = 0;
    var group = plateLinks; // the grid the open item belongs to (plates or certificates)

    var show = function (i) {
      current = (i + group.length) % group.length;
      var a = group[current];
      var media;
      if (a.dataset.webm) {
        media = document.createElement("video");
        media.muted = true;
        media.loop = true;
        media.playsInline = true;
        media.controls = true;
        media.autoplay = !reduceMotion.matches;
        media.poster = a.dataset.thumb || a.querySelector("img").src;
        [["webm", "video/webm"], ["mp4", "video/mp4"]].forEach(function (f) {
          var src = document.createElement("source");
          src.src = a.dataset[f[0]];
          src.type = f[1];
          media.appendChild(src);
        });
      } else {
        media = document.createElement("img");
        media.src = a.dataset.full;
        var tmp = document.createElement("div");
        tmp.innerHTML = a.dataset.caption;
        media.alt = tmp.textContent;
      }
      media.className = "lb-media";
      stage.replaceChildren(media);
      box.querySelector(".lb-no").textContent = a.dataset.no || a.querySelector(".plate-no").textContent;
      box.querySelector(".lb-caption").innerHTML = a.dataset.caption;
    };

    plateLinks.forEach(function (a) {
      a.addEventListener("click", function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
        e.preventDefault();
        group = Array.prototype.slice.call(a.closest(".plates").querySelectorAll(".plate-link"));
        show(group.indexOf(a));
        box.showModal();
      });
    });
    // Plate index: hovering or focusing a title shows it in the large preview;
    // clicking the preview opens that plate. Stills only, nothing moves.
    var pidx = document.querySelector(".pidx");
    if (pidx) {
      var previewImg = pidx.querySelector(".pidx-open img");
      var previewCap = pidx.querySelector(".pidx-cap");
      var pidxLinks = Array.prototype.slice.call(pidx.querySelectorAll(".plate-link"));
      var currentPlate = pidxLinks[0];
      var select = function (a) {
        if (a === currentPlate && a.classList.contains("is-current")) return;
        pidxLinks.forEach(function (l) { l.classList.toggle("is-current", l === a); });
        currentPlate = a;
        previewImg.src = a.dataset.thumb;
        previewCap.innerHTML = a.dataset.caption;
      };
      pidxLinks.forEach(function (a) {
        a.addEventListener("mouseenter", function () { select(a); });
        a.addEventListener("focus", function () { select(a); });
      });
      pidx.querySelector(".pidx-open").addEventListener("click", function () { currentPlate.click(); });
      select(pidxLinks[0]);
      // warm the cache so the preview swaps instantly
      var warm = function () { pidxLinks.forEach(function (a) { new Image().src = a.dataset.thumb; }); };
      pidx.addEventListener("mouseenter", warm, { once: true });
    }

    box.querySelectorAll("[data-step]").forEach(function (b) {
      b.addEventListener("click", function () { show(current + Number(b.dataset.step)); });
    });
    box.querySelector(".lb-close").addEventListener("click", function () { box.close(); });
    box.addEventListener("click", function (e) { if (e.target === box) box.close(); });
    // On document: swapping the media can drop focus out of the dialog.
    document.addEventListener("keydown", function (e) {
      if (!box.open) return;
      if (e.key === "ArrowRight") show(current + 1);
      if (e.key === "ArrowLeft") show(current - 1);
    });
    box.addEventListener("close", function () {
      stage.replaceChildren();
      group[current].focus();
    });
  }

  // Contact: copy the email address (shown only where the clipboard API exists).
  var copyBtn = document.querySelector(".contact-copy");
  if (copyBtn && navigator.clipboard && window.isSecureContext) {
    var copyLabel = copyBtn.textContent;
    var copied = document.documentElement.lang === "de" ? "kopiert" : "copied";
    copyBtn.hidden = false;
    copyBtn.setAttribute("aria-live", "polite");
    copyBtn.addEventListener("click", function () {
      navigator.clipboard.writeText(copyBtn.dataset.copy).then(function () {
        copyBtn.textContent = copied + " ✓";
        copyBtn.classList.add("is-done");
        setTimeout(function () {
          copyBtn.textContent = copyLabel;
          copyBtn.classList.remove("is-done");
        }, 2000);
      });
    });
  }

  // Links to #certificates (and arriving with that hash) unfold the certificates.
  var certs = document.getElementById("certificates");
  if (certs) {
    var openCerts = function () { if (location.hash === "#certificates") certs.open = true; };
    document.querySelectorAll('a[href="#certificates"]').forEach(function (a) {
      a.addEventListener("click", function () { certs.open = true; });
    });
    window.addEventListener("hashchange", openCerts);
    openCerts();
  }

  var langLink = document.querySelector(".lang a[hreflang]");
  var langBase = langLink ? langLink.getAttribute("href").split("#")[0] : "";

  function setLangHash(id) {
    if (langLink) langLink.setAttribute("href", langBase + (id ? "#" + id : ""));
  }

  var links = document.querySelectorAll(".nav-list a[href^='#']");
  if (!("IntersectionObserver" in window) || !links.length) return;

  var byId = {};
  links.forEach(function (a) {
    byId[a.getAttribute("href").slice(1)] = a;
  });

  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        var link = byId[entry.target.id];
        if (!link || !entry.isIntersecting) return;
        links.forEach(function (a) {
          a.removeAttribute("aria-current");
        });
        link.setAttribute("aria-current", "location");
        setLangHash(entry.target.id);
      });
    },
    { rootMargin: "-40% 0px -55% 0px" }
  );
  Object.keys(byId).forEach(function (id) {
    var section = document.getElementById(id);
    if (section) observer.observe(section);
  });
})();
