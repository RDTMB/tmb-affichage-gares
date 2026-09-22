// Grille enregistrée → cellules au FORMAT DU DOCUMENT D'EXPLOITATION — PUR
// et testé. L'écriture du .xlsx lui-même est ailleurs (ecriture-xlsx.ts) :
// ici, uniquement la mise en page, en cellules neutres.
//
// Ce module est l'INVERSE exact de import-grille.ts, et c'est ainsi qu'il se
// teste : exporter la grille de l'été 2026, la relire par parseFeuille(),
// zéro écart. Le contrat de format n'est donc pas décrit deux fois — il est
// vérifié en boucle fermée (export-grille.test.ts).
//
// CE QUI NE REVIENT PAS, et qui doit être dit : le document d'exploitation
// porte Mont Lachat, halte de SERVICE que l'import ignore volontairement
// (docs/format-excel-horaires.md §3). Ses heures n'existent nulle part dans
// l'application : le fichier exporté ne peut pas les réinventer, et le dit en
// bas de feuille.
import {
  GARES_LIGNE,
  lettreColonne,
  nomGare,
  type Cellule,
  type FeuilleCellules,
} from './import-grille';
import { heureVersSecondes } from './horaires';
import { ORDRE_GARES } from './types';
import type { GareId, Grille, Periode, Sens, TrainGrille } from './types';

export { lettreColonne };

/** Lettres de la légende du document — les mêmes que celles que l'import lit. */
const LETTRE_FACULTATIF = 'R';
const LETTRE_VELOS = 'b';
const LETTRE_EXPRESS = 'ÿ';

/** Colonne A = gares, colonne B = A/D, les trains commencent en C. */
const COLONNE_PREMIER_TRAIN = 2;
/**
 * Première colonne de la légende. Elle est en L dans le document, qui compte
 * huit trains ; une grille plus fournie la POUSSE à droite des colonnes de
 * trains — sinon la légende tombe dans le tableau, et l'import relit « Trains
 * accessibles aux vélos » comme une heure de départ. Payé en test, une fois.
 */
function colonneLegende(g: Grille): number {
  return Math.max(11, COLONNE_PREMIER_TRAIN + Math.max(g.montees.length, g.descentes.length) + 1);
}

const MOIS_MAJUSCULES = [
  'JANVIER',
  'FEVRIER',
  'MARS',
  'AVRIL',
  'MAI',
  'JUIN',
  'JUILLET',
  'AOUT',
  'SEPTEMBRE',
  'OCTOBRE',
  'NOVEMBRE',
  'DECEMBRE',
];

/**
 * « 2026-07-04 » → « 4 JUILLET 2026 ». L'ANNÉE EST TOUJOURS ÉCRITE, sur les
 * deux bornes : le lecteur de titres sait la déduire, mais un document qu'on
 * imprime et qu'on diffuse ne se lit pas par déduction.
 */
export function dateEnProse(iso: string): string {
  const jour = Number(iso.slice(8, 10));
  const mois = MOIS_MAJUSCULES[Number(iso.slice(5, 7)) - 1] ?? '?';
  return `${jour} ${mois} ${iso.slice(0, 4)}`;
}

/**
 * Titre de la feuille, en A1, dans la prose du document : c'est LUI qui porte
 * les dates de validité, et c'est par lui qu'elles reviennent à l'import.
 */
export function titreFeuille(libelle: string, periodes: Periode[]): string {
  const plages = periodes.map((p) => `DU ${dateEnProse(p.du)} AU ${dateEnProse(p.au)}`);
  const nom = libelle.trim().toUpperCase();
  return plages.length === 0 ? `HORAIRES ${nom}` : `HORAIRES ${nom} ${plages.join(' ET ')}`;
}

/** Gares dans l'ordre du parcours : du Fayet au sommet en montée, l'inverse en descente. */
function garesDansLeSens(sens: Sens): GareId[] {
  return sens === 'montee' ? [...ORDRE_GARES] : [...ORDRE_GARES].reverse();
}

/** Heure « HH:MM:SS » → fraction de jour, ce qu'Excel appelle une heure. */
export function fractionDeJour(h: string): number {
  return heureVersSecondes(h) / 86400;
}

function lettresIndicateurs(t: TrainGrille): string {
  return (
    (t.facultatif ? LETTRE_FACULTATIF : '') +
    (t.velos ? LETTRE_VELOS : '') +
    (t.express ? LETTRE_EXPRESS : '')
  );
}

/** Une ligne dense de `largeur` cellules, remplie de null. */
function ligneVide(largeur: number): Cellule[] {
  return Array.from({ length: largeur }, () => null);
}

/**
 * Un bloc (montées ou descentes) : le titre, la ligne des numéros de train,
 * la ligne des lettres, puis une ligne par gare et par A/D. Une gare qu'un
 * train ne dessert pas porte un TIRET sur ses deux lignes — c'est ainsi que
 * le document dit « ne s'arrête pas », et c'est ce que l'import relit.
 */
function lignesBloc(sens: Sens, trains: TrainGrille[], largeur: number): Cellule[][] {
  const lignes: Cellule[][] = [];
  const titre = ligneVide(largeur);
  titre[0] = sens === 'montee' ? 'HORAIRES DES MONTEES' : 'HORAIRES DES DESCENTES';
  lignes.push(titre);

  const numeros = ligneVide(largeur);
  const indicateurs = ligneVide(largeur);
  trains.forEach((t, i) => {
    numeros[COLONNE_PREMIER_TRAIN + i] = `Train ${t.numero}`;
    const lettres = lettresIndicateurs(t);
    if (lettres !== '') indicateurs[COLONNE_PREMIER_TRAIN + i] = lettres;
  });
  lignes.push(numeros, indicateurs);

  const gares = garesDansLeSens(sens).filter((g) =>
    trains.some((t) => t.passages.some((p) => p.gare === g)),
  );
  for (const gare of gares) {
    // Une gare ne porte une ligne A (ou D) que si au moins un train y a cette
    // heure : ni arrivée à l'origine, ni départ au terminus, comme le document.
    const champs = (['a', 'd'] as const).filter((champ) =>
      trains.some((t) => t.passages.find((p) => p.gare === gare)?.[champ] !== undefined),
    );
    champs.forEach((champ, i) => {
      const ligne = ligneVide(largeur);
      if (i === 0) ligne[0] = nomGare(gare);
      ligne[1] = champ === 'a' ? 'A' : 'D';
      trains.forEach((t, k) => {
        const passage = t.passages.find((p) => p.gare === gare);
        const h = passage?.[champ];
        ligne[COLONNE_PREMIER_TRAIN + k] = passage
          ? h === undefined
            ? null
            : fractionDeJour(h)
          : '-';
      });
      lignes.push(ligne);
    });
  }
  return lignes;
}

export interface OptionsExport {
  /** « JJ/MM/AAAA » de la mention « Mise à jour du … » ; absente si omise. */
  miseAJour?: string;
  /** Nom de la feuille ; à défaut le libellé de la grille. */
  nomFeuille?: string;
}

/**
 * La grille au format du document : une feuille, deux blocs, la légende à
 * droite et les notes en bas. Le résultat se relit tel quel par
 * `parseFeuille()`.
 */
export function cellulesGrille(g: Grille, options: OptionsExport = {}): FeuilleCellules {
  const lettre = colonneLegende(g);
  const texte = lettre + 1;
  const largeur = texte + 1;
  const lignes: Cellule[][] = [];

  const titre = ligneVide(largeur);
  titre[0] = titreFeuille(g.libelle, g.periodes);
  if (options.miseAJour) titre[lettre] = `Mise à jour du ${options.miseAJour}`;
  lignes.push(titre);

  const sousTitre = ligneVide(largeur);
  const sommet = [...g.montees, ...g.descentes].some((t) =>
    t.passages.some((p) => p.gare === 'nid-daigle'),
  )
    ? "LE NID D'AIGLE"
    : 'BELLEVUE';
  sousTitre[0] = `LE FAYET <> ${sommet}`;
  sousTitre[lettre] = 'LEGENDE';
  lignes.push(sousTitre, ligneVide(largeur));

  const montees = lignesBloc('montee', g.montees, largeur);
  // La légende se pose à droite du bloc des montées, comme dans le document.
  const legende: Array<[string, string]> = [
    [
      LETTRE_FACULTATIF,
      'Train opéré selon conditions météorologiques et affluence. Confirmation de circulation disponible au plus tard la veille au soir du départ.',
    ],
    [LETTRE_VELOS, 'Trains accessibles aux vélos (5 maximum, selon affluence).'],
    [
      LETTRE_EXPRESS,
      'Train direct : ne dessert ni Col de Voza ni Bellevue. / Direct train: does not serve Col de Voza or Bellevue.',
    ],
  ];
  legende.forEach(([symbole, phrase], i) => {
    const ligne = montees[i + 2];
    if (!ligne) return;
    ligne[lettre] = symbole;
    ligne[texte] = phrase;
  });
  lignes.push(...montees, ligneVide(largeur));
  lignes.push(...lignesBloc('descente', g.descentes, largeur), ligneVide(largeur));

  for (const note of notesBasDeFeuille(g)) {
    const ligne = ligneVide(largeur);
    ligne[0] = note;
    lignes.push(ligne);
  }
  return { nom: options.nomFeuille?.trim() || g.libelle, lignes };
}

/**
 * Ce que le format du document ne sait PAS écrire, et qui empêcherait donc
 * de recharger le fichier exporté.
 *
 * Le document range les heures en lignes « A » et « D » communes à tous les
 * trains d'un bloc. Une case vide au croisement d'une ligne qui existe et
 * d'un train qui la dessert n'y a pas de sens : l'import la refuse (« Heure
 * manquante »). Cela n'arrive que pour un train dont l'origine ou le terminus
 * diffère de celui de ses voisins — un cas que le document d'exploitation n'a
 * jamais eu à écrire, et que l'éditeur, lui, permet de fabriquer.
 *
 * On ne l'empêche pas : on le DIT avant le téléchargement. Une grille
 * exportable telle quelle est le cas courant ; celle-là demande d'abord de
 * mettre les trains d'accord sur leur parcours.
 */
export function problemesExport(g: Grille): string[] {
  const problemes: string[] = [];
  for (const [sens, trains] of [
    ['montee', g.montees],
    ['descente', g.descentes],
  ] as const) {
    const gares = garesDansLeSens(sens).filter((gare) =>
      trains.some((t) => t.passages.some((p) => p.gare === gare)),
    );
    for (const gare of gares) {
      for (const champ of ['a', 'd'] as const) {
        const existe = trains.some(
          (t) => t.passages.find((p) => p.gare === gare)?.[champ] !== undefined,
        );
        if (!existe) continue;
        for (const t of trains) {
          const passage = t.passages.find((p) => p.gare === gare);
          if (passage && passage[champ] === undefined) {
            problemes.push(
              `TRAIN ${t.numero} : ${nomGare(gare)} sans ${champ === 'a' ? 'arrivée' : 'départ'} alors que les autres trains en ont un — le document d'exploitation ne sait pas écrire cette case, et le fichier exporté ne pourrait pas être rechargé tel quel.`,
            );
          }
        }
      }
    }
  }
  return problemes;
}

/**
 * Les lignes de bas de feuille. La première n'est pas décorative : elle dit
 * que Mont Lachat manque, et pourquoi — sans elle, le document rediffusé
 * paraîtrait simplement avoir perdu une gare.
 */
export function notesBasDeFeuille(g: Grille): string[] {
  const notes = [
    'Halte de service de Mont Lachat : non desservie par les voyageurs, ses heures ne figurent pas dans ce document.',
  ];
  const gares = GARES_LIGNE.filter((gare) =>
    [...g.montees, ...g.descentes].some((t) => t.passages.some((p) => p.gare === gare.id)),
  );
  const sommet = gares[gares.length - 1];
  if (sommet && sommet.id !== 'nid-daigle') {
    notes.push(`Cette grille s'arrête à ${sommet.nom} : aucun train ne monte au Nid d'Aigle.`);
  }
  notes.push(
    "ATTENTION : En cas de mauvaises conditions météorologiques (vent fort et/ou risque élevé d'orages), le tronçon Bellevue - Nid d'Aigle est susceptible de fermer pour des raisons de sécurité.",
  );
  return notes;
}
