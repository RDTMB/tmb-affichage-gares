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

const LIBELLES: Record<ChoixTheme, { texte: string; titre: string }> = {
  auto: { texte: 'Auto', titre: 'Suivre le réglage de l’appareil' },
  clair: { texte: 'Clair', titre: 'Toujours en clair' },
  sombre: { texte: 'Sombre', titre: 'Toujours en sombre' },
};

/**
 * Sélecteur à trois boutons, monté dans chaque conteneur `[data-choix-theme]`
 * (en-tête et cartes de connexion). Un groupe nommé de boutons à bascule :
 * le lecteur d'écran annonce « Thème d'affichage », puis chaque bouton et
 * son état « enfoncé ».
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
  const boutons: { choix: ChoixTheme; bouton: HTMLButtonElement }[] = [];

  for (const conteneur of options.conteneurs) {
    conteneur.classList.add('choix-theme');
    conteneur.setAttribute('role', 'group');
    conteneur.setAttribute('aria-label', 'Thème d’affichage');
    conteneur.replaceChildren();
    for (const c of CHOIX_THEME) {
      const bouton = document.createElement('button');
      bouton.type = 'button'; // dans un <form>, un bouton sans type ENVOIE
      bouton.textContent = LIBELLES[c].texte;
      bouton.title = LIBELLES[c].titre;
      bouton.dataset.choix = c;
      bouton.addEventListener('click', () => choisir(c));
      conteneur.append(bouton);
      boutons.push({ choix: c, bouton });
    }
  }

  function rendre(): void {
    for (const { choix: c, bouton } of boutons) {
      bouton.setAttribute('aria-pressed', String(c === choix));
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
