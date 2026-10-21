// Choix du thème de la Supervision (20/10/2026) : Auto / Clair / Sombre,
// retenu sur le POSTE (localStorage), jamais lié au compte — pas de SQL.
//
// Le choix se pose sur <html> en `data-theme` (« clair » / « sombre », absent
// en Auto) ; supervision.css en tire `color-scheme`, qui fait basculer toutes
// les valeurs `light-dark()`. Au chargement, c'est public/theme-supervision.js
// — script CLASSIQUE, donc bloquant, chargé dans le <head> — qui pose
// l'attribut avant le premier rendu : un module (différé) laisserait voir un
// écran clair avant de basculer. Ce script est une COPIE de `lireChoixTheme`
// et `appliqueChoixTheme`, exécutée et confrontée à l'original par
// theme-supervision.test.ts.

export type ChoixTheme = 'auto' | 'clair' | 'sombre';
export type ThemeEffectif = 'clair' | 'sombre';

/** Même préfixe que les autres clés du poste (`tmb-gare-caisse`). */
export const CLE_THEME = 'tmb-theme-supervision';

export const CHOIX_THEME: readonly ChoixTheme[] = ['auto', 'clair', 'sombre'];

/** Ce qu'on lit du stockage : `localStorage`, ou un double de test. */
type Stockage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * Choix retenu sur le poste. Tout ce qui n'est pas « clair » ou « sombre » —
 * rien d'enregistré, une valeur inconnue, un stockage qui lève (navigation
 * privée, stockage bloqué) — vaut Auto, sans erreur.
 */
export function lireChoixTheme(stockage: () => Stockage): ChoixTheme {
  try {
    const valeur = stockage().getItem(CLE_THEME);
    return valeur === 'clair' || valeur === 'sombre' ? valeur : 'auto';
  } catch {
    return 'auto';
  }
}

/**
 * Retient le choix. Auto EFFACE la clé : un poste revenu en Auto ressemble à
 * un poste qui n'a jamais rien choisi. Un stockage indisponible n'empêche pas
 * le choix de s'appliquer — il ne survivra simplement pas au rechargement.
 */
export function ecrireChoixTheme(stockage: () => Stockage, choix: ChoixTheme): void {
  try {
    if (choix === 'auto') stockage().removeItem(CLE_THEME);
    else stockage().setItem(CLE_THEME, choix);
  } catch {
    // stockage indisponible : le choix vaut pour la page ouverte
  }
}

/** Thème réellement affiché : le choix forcé, sinon le réglage de l'appareil. */
export function themeEffectif(choix: ChoixTheme, appareilSombre: boolean): ThemeEffectif {
  if (choix === 'auto') return appareilSombre ? 'sombre' : 'clair';
  return choix;
}

/** Pose le choix sur <html> : `data-theme` en Clair / Sombre, rien en Auto. */
export function appliqueChoixTheme(racine: HTMLElement, choix: ChoixTheme): void {
  if (choix === 'auto') racine.removeAttribute('data-theme');
  else racine.setAttribute('data-theme', choix);
}

/** Le clic fait tourner les trois choix : Auto → Clair → Sombre → Auto. */
export function choixSuivant(choix: ChoixTheme): ChoixTheme {
  return CHOIX_THEME[(CHOIX_THEME.indexOf(choix) + 1) % CHOIX_THEME.length] ?? 'auto';
}

const NOMS: Record<ChoixTheme, string> = { auto: 'Auto', clair: 'Clair', sombre: 'Sombre' };

/** Nom accessible ET info-bulle : l'état choisi, puis ce que fait le clic. */
export function libelleChoixTheme(choix: ChoixTheme): string {
  const etat = choix === 'auto' ? 'Auto (suit le réglage de l’appareil)' : NOMS[choix];
  return `Thème : ${etat} — cliquer pour passer en ${NOMS[choixSuivant(choix)]}`;
}

// Icônes tracées en `currentColor` (aucune ressource chargée, rien pour la
// CSP) : demi-disque = suit l'appareil, soleil = clair, croissant = sombre.
const ICONES: Record<ChoixTheme, string> = {
  auto: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/>',
  clair:
    '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>',
  sombre: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5z"/>',
};

/**
 * Bouton ROND, un par conteneur `[data-choix-theme]` (en-tête et sous la
 * carte de connexion). Trois boutons côte à côte faisaient passer l'en-tête
 * sur deux rangs (décision de Thomas, 20/10/2026) : un seul, à la taille de
 * l'avatar, qui affiche le choix en cours et passe au suivant à chaque clic.
 * Le lecteur d'écran annonce l'état ET l'effet du clic (`aria-label`).
 */
export function monteChoixTheme(options: {
  conteneurs: Iterable<HTMLElement>;
  racine: HTMLElement;
  stockage: () => Stockage;
  appareilSombre: MediaQueryList;
  /** Appelé avec le thème EFFECTIF au montage, à chaque choix et à chaque
   *  bascule de l'appareil. */
  surChangement: (theme: ThemeEffectif) => void;
}): void {
  const { racine, stockage, appareilSombre, surChangement } = options;
  let choix = lireChoixTheme(stockage);
  const boutons: HTMLButtonElement[] = [];

  for (const conteneur of options.conteneurs) {
    conteneur.classList.add('choix-theme');
    conteneur.replaceChildren();
    const bouton = document.createElement('button');
    bouton.type = 'button'; // dans un <form>, un bouton sans type ENVOIE
    bouton.addEventListener('click', () => choisir(choixSuivant(choix)));
    conteneur.append(bouton);
    boutons.push(bouton);
  }

  function rendre(): void {
    for (const bouton of boutons) {
      bouton.dataset.choix = choix;
      bouton.setAttribute('aria-label', libelleChoixTheme(choix));
      bouton.title = libelleChoixTheme(choix);
      bouton.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[choix]}</svg>`;
    }
    appliqueChoixTheme(racine, choix);
    surChangement(themeEffectif(choix, appareilSombre.matches));
  }

  function choisir(c: ChoixTheme): void {
    choix = c;
    ecrireChoixTheme(stockage, c);
    rendre();
  }

  // En Auto, l'appareil peut basculer page ouverte ; forcé, l'appel est
  // inoffensif (le thème effectif ne bouge pas).
  appareilSombre.addEventListener('change', rendre);
  rendre();
}
