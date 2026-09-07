// Icône d'onglet et d'écran d'accueil, posée depuis le JavaScript.
//
// POURQUOI PAS UN `<link>` DANS LES PAGES HTML. Le projet inline ses images en
// data URI au build (`vite.config.ts`) et `publicDir` est désactivé en mode
// démonstration : un chemin de fichier statique se casserait en démo, et le
// site est servi sous un sous-chemin. La data URI, elle, vaut dans tous les
// modes, et la CSP autorise déjà `img-src data:`.
//
// POURQUOI UN MONOGRAMME ET NON LE LOGO. Le logo officiel porte quatre lignes
// de texte et un dégradé de montagne : à 16 px, la taille réelle d'une icône
// d'onglet, il ne reste qu'une tache grise. Le monogramme est tracé dans
// l'Amaranth du projet, lettres converties en contours.
//
// Deux formats déclarés : le SVG pour les navigateurs qui l'acceptent, le PNG
// en repli. Le 180 px sert quand un agent ajoute la page à l'écran d'accueil
// de son téléphone.

function pose(rel: string, type: string, href: string, sizes?: string): void {
  const lien = document.createElement('link');
  lien.rel = rel;
  lien.type = type;
  lien.href = href;
  if (sizes) lien.setAttribute('sizes', sizes);
  document.head.appendChild(lien);
}

export function poseFavicon(): void {
  pose('icon', 'image/svg+xml', __FAVICON_SVG__);
  pose('icon', 'image/png', __FAVICON_PNG__, '64x64');
  pose('apple-touch-icon', 'image/png', __FAVICON_TACTILE__, '180x180');
}
