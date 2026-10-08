// Theme toggle (stored choice overrides prefers-color-scheme) and nav section highlight.
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
      });
    },
    { rootMargin: "-40% 0px -55% 0px" }
  );
  Object.keys(byId).forEach(function (id) {
    var section = document.getElementById(id);
    if (section) observer.observe(section);
  });
})();
