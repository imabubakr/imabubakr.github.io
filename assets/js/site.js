// Theme toggle (stored choice overrides prefers-color-scheme), plates viewer,
// nav section highlight, and keeping the language switch on the current section.
(function () {
  var root = document.documentElement;
  var toggle = document.querySelector(".theme-toggle");
  var systemDark = window.matchMedia("(prefers-color-scheme: dark)");

  function current() {
    return root.dataset.theme || (systemDark.matches ? "dark" : "light");
  }

  function sync() {
    if (toggle) toggle.setAttribute("aria-pressed", String(current() === "dark"));
  }

  if (toggle) {
    toggle.addEventListener("click", function () {
      var next = current() === "dark" ? "light" : "dark";
      root.dataset.theme = next;
      try {
        localStorage.setItem("theme", next);
      } catch (e) {}
      sync();
    });
    systemDark.addEventListener("change", sync);
    sync();
  }

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
        media.poster = a.querySelector("img").src;
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
      box.querySelector(".lb-no").textContent = a.querySelector(".plate-no").textContent;
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

  // CV as PDF: the print stylesheet turns the page into an A4 CV. While printing,
  // the document title becomes the suggested PDF file name.
  var printButton = document.querySelector(".print-cv");
  if (printButton) {
    var pageTitle = document.title;
    printButton.hidden = false;
    printButton.addEventListener("click", function () {
      window.print();
    });
    window.addEventListener("beforeprint", function () {
      document.title = printButton.dataset.pdfTitle;
    });
    window.addEventListener("afterprint", function () {
      document.title = pageTitle;
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

  // Section background layers load only when their section comes near, and never
  // before the page itself has loaded (they must not compete with fonts and hero).
  var layerHeads = document.querySelectorAll(".section-head[data-layer]");
  var startLayers = function () {
    if (!("IntersectionObserver" in window)) {
      layerHeads.forEach(function (h) { h.classList.add("layer-on"); });
      return;
    }
    var layerObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("layer-on");
        layerObserver.unobserve(entry.target);
      });
    }, { rootMargin: "300px 0px" });
    layerHeads.forEach(function (h) { layerObserver.observe(h); });
  };
  if (document.readyState === "complete") startLayers();
  else window.addEventListener("load", startLayers);

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
