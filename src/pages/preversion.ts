// Marque de PRÉVERSION — « ceci n'est pas l'affichage en gare ».
//
// POURQUOI CE FICHIER EXISTE. Le site publié a désormais deux moitiés
// (.github/workflows/deploy.yml) : la RACINE, qui est exactement ce que lisent
// les six écrans en gare, et `/preview/`, qui montre la branche `dev` branchée
// sur la base de TEST. Même origine, même code, même allure. La supervision
// porte déjà sa pastille de base (`baseServie()`, src/data/config.ts) et dira
// « BASE DE TEST » sur la préversion ; l'écran de gare et la grille du jour
// n'ont RIEN qui les distingue. Or un tableau de départs issu de la base de
// test est parfaitement crédible : c'est le même défaut que la démonstration
// silencieuse (C-02), sur un autre chemin. Quelqu'un regardera la préversion
// en croyant voir la gare — publier un message d'essai « puisque c'est déjà
// affiché », ou conclure qu'un correctif est en ligne alors qu'il ne l'est
// pas. Il doit être détrompé en une seconde, sans rien avoir à vérifier.
//
// COMMENT LA PAGE LE SAIT. Pas par l'URL lue à l'exécution — une page se
// recopie, se mandate, s'ouvre à travers un tunnel —, mais par le CHEMIN DE
// BASE DU BUILD (`import.meta.env.BASE_URL`), que Vite fige au moment où
// l'artefact est construit. La préversion est bâtie avec
// `--base=/<dépôt>/preview/`, la production avec `--base=/<dépôt>/` : le
// marqueur ne peut donc NI apparaître dans le build de la production, NI
// manquer dans celui de la préversion. Aucun paramètre d'URL ne l'allume et
// aucun ne l'éteint.

import '../styles/preversion.css';

/** Dernier segment du chemin de base qui désigne la préversion. */
export const SEGMENT_PREVERSION = 'preview';

/** Ce que porte l'étiquette. Une seule phrase, lisible de loin, sans jargon. */
export const TEXTE_PREVERSION = 'PRÉVERSION — BASE DE TEST — PAS L’AFFICHAGE EN GARE';

/** Ce qui est ajouté devant le titre de l'onglet. */
export const PREFIXE_TITRE = 'PRÉVERSION — ';

/**
 * Ce build est-il celui de la préversion ?
 *
 * On regarde le DERNIER segment du chemin de base : `/tmb-affichage-gares/`
 * est la production, `/tmb-affichage-gares/preview/` la préversion. Le `/` du
 * serveur de développement et le `./` d'un build local ne sont ni l'un ni
 * l'autre — rien ne s'affiche, ce qui est le bon comportement : il n'y a pas
 * de gare à confondre avec un `npm run dev`.
 */
export function estPreversion(baseUrl: string): boolean {
  const segments = baseUrl.split('/').filter((segment) => segment.length > 0);
  return segments[segments.length - 1] === SEGMENT_PREVERSION;
}

/**
 * Le titre d'un onglet, préfixé si ce build est une préversion.
 *
 * POURQUOI CETTE FONCTION PLUTÔT QU'UN PRÉFIXE POSÉ UNE FOIS. L'écran de gare
 * RÉÉCRIT son titre dès qu'il connaît sa gare (`TMB — Saint-Gervais`) : le
 * préfixe posé au démarrage disparaissait aussitôt, et l'onglet redevenait
 * celui de la gare. Une page qui se renomme doit donc passer par ici. Un
 * observateur de mutations sur `<title>` ferait le même travail sans qu'on
 * ait rien à demander à l'appelant, mais il rattraperait le titre APRÈS coup
 * et vivrait 18 h par jour pour une seule écriture : un appel explicite est
 * plus honnête, et le test le vérifie sur toutes les surfaces.
 */
export function prefixeTitre(titre: string, baseUrl: string): string {
  return estPreversion(baseUrl) ? `${PREFIXE_TITRE}${titre}` : titre;
}

/** `prefixeTitre()` appliqué au chemin de base de CE build. */
export function titrePage(titre: string): string {
  return prefixeTitre(titre, import.meta.env.BASE_URL);
}

/**
 * Pose le cadre et l'étiquette de préversion, si c'en est une.
 *
 * Un CADRE, et pas un bandeau de plus. Les bandeaux de l'écran de gare
 * (démonstration, heure simulée, horloge déréglée) s'empilent en haut, se
 * disputent déjà le `top` et poussent l'en-tête : un quatrième aurait à
 * s'insérer dans cette combinatoire, sur quatre feuilles de style, pour un
 * marqueur qui n'a AUCUNE raison d'être propre à l'écran. Le cadre, lui, est
 * en dehors du flux, identique sur les quatre surfaces, et ne recouvre rien —
 * il ne peut donc masquer ni un départ ni un bouton de publication.
 *
 * Rend `true` si la marque a été posée, pour que l'appelant — et le test —
 * n'aient pas à le redemander.
 */
export function marquePreversion(doc: Document, baseUrl: string): boolean {
  if (!estPreversion(baseUrl)) return false;

  doc.documentElement.classList.add('preversion');
  // Le titre aussi : sur un poste où trois onglets sont ouverts, la barre
  // d'onglets est parfois tout ce qu'on regarde avant de cliquer « Publier ».
  // Une page qui se renomme ensuite repasse par `titrePage()`.
  doc.title = prefixeTitre(doc.title, baseUrl);

  const cadre = doc.createElement('div');
  cadre.className = 'cadre-preversion';
  cadre.id = 'cadre-preversion';
  // Décor, pas contenu : une liseuse d'écran n'a rien à en faire, et le cadre
  // ne doit intercepter aucun clic de la supervision.
  cadre.setAttribute('aria-hidden', 'true');

  const etiquette = doc.createElement('div');
  etiquette.className = 'etiquette-preversion';
  etiquette.textContent = TEXTE_PREVERSION;
  cadre.appendChild(etiquette);

  doc.body.appendChild(cadre);
  return true;
}

/**
 * Appel des quatre pages : la marque, depuis le chemin de base du build.
 *
 * `import.meta.env.BASE_URL` n'existe que dans un module traité par Vite —
 * d'où cette enveloppe, qui laisse `marquePreversion()` pur et testable avec
 * une base quelconque.
 */
export function poseMarquePreversion(): void {
  marquePreversion(document, import.meta.env.BASE_URL);
}
