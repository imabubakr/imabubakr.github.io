// Theme toggle (stored choice overrides prefers-color-scheme), looping figures,
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

  // Timeline: the current job runs to today.
  var now = new Date();
  document.querySelectorAll(".timeline").forEach(function (t) {
    t.style.setProperty("--now", (now.getFullYear() + now.getMonth() / 12).toFixed(2));
  });

  // Looping figures: load and play only while on screen, never autoplay under
  // reduced motion, and always offer a pause/play button (WCAG 2.2.2).
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  document.querySelectorAll(".plate").forEach(function (plate) {
    var video = plate.querySelector("video");
    var button = plate.querySelector(".plate-toggle");
    if (!video || !button) return;
    var userPaused = reduceMotion.matches;
    var visible = false;

    function update() {
      if (visible && !userPaused) {
        var p = video.play();
        if (p && p.catch) p.catch(function () {});
      } else {
        video.pause();
      }
      button.textContent = userPaused ? button.dataset.play : button.dataset.pause;
    }

    button.hidden = false;
    button.addEventListener("click", function () {
      userPaused = !userPaused;
      update();
    });
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        update();
      }, { threshold: 0.25 }).observe(video);
    } else {
      visible = true;
      update();
    }
  });

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
