/* Protection contre l'affichage d'immo dans le cadre d'un autre site (clickjacking). */
(function () {
  if (window.top !== window.self) {
    document.documentElement.className += ' framed';
    try { window.top.location.replace(window.self.location.href); } catch (e) { /* cadre bloqué : la page reste masquée */ }
  }
})();
