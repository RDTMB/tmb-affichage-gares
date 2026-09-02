// Import des horaires depuis l'Excel exploitation — PUR et testé.
//
// Contrat de format : docs/format-excel-horaires.md. Ce module ne voit qu'un
// tableau de lignes de cellules (nombres, textes, vides) : la conversion du
// fichier .xlsx vers ces cellules est faite par src/core/lecture-xlsx.ts, et
// les tests n'ont besoin d'aucun fichier binaire (src/core/__fixtures__).
//
// Deux niveaux de problèmes : les ERREURS bloquent l'enregistrement (rien
// n'est jamais enregistré à moitié), les AVERTISSEMENTS s'acquittent. Chaque
// message nomme le train, la gare et la cellule (feuille, ligne, colonne).
import { formatHeure, heureVersSecondes } from './horaires';
import { ecarts } from './ecarts-grille';
import { ORDRE_GARES } from './types';
import type {
  GareGrille,
  GareId,
  Grille,
  PassageGrille,
  Periode,
  Sens,
  TrainGrille,
} from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Valeur d'une cellule : nombre (heure Excel = fraction de jour), texte, ou vide. */
export type Cellule = string | number | null;

export interface FeuilleCellules {
  nom: string;
  /** lignes[i][j] = cellule de la ligne Excel i + 1, colonne j (0 = A). */
  lignes: Cellule[][];
}

export type NiveauProbleme = 'erreur' | 'avertissement';

export interface Probleme {
  niveau: NiveauProbleme;
  /** Phrase complète pour l'agent, localisation comprise. */
  message: string;
  feuille?: string;
  /** Numéro de ligne Excel (1 = première ligne). */
  ligne?: number;
  /** Lettre de colonne Excel. */
  colonne?: string;
  train?: number;
  gare?: GareId;
}

export interface ResultatFeuille {
  nom: string;
  /** Titre lu en A1 (dates de validité en prose). */
  titre: string | null;
  /** « JJ/MM/AAAA » de la cellule « Mise à jour du … », si présente. */
  miseAJour: string | null;
  /** Périodes lues dans le titre — à CONFIRMER par l'agent ; vide si illisible. */
  periodesProposees: Periode[];
  /**
   * Grille lue, pour l'APERÇU. Ne doit JAMAIS être enregistrée tant que
   * `erreurs` n'est pas vide : elle peut être incomplète. null si la
   * structure de la feuille n'a pas permis de la construire.
   */
  grille: Grille | null;
  erreurs: Probleme[];
  avertissements: Probleme[];
}

export interface ResultatClasseur {
  feuilles: ResultatFeuille[];
  /** Erreurs qui concernent le classeur entier (aucune feuille d'horaires…). */
  erreurs: Probleme[];
}

// ---------------------------------------------------------------------------
// Constantes de la ligne (jamais lues dans le fichier)
// ---------------------------------------------------------------------------

/** Gares et altitudes : constantes de la ligne, définies ici et non dans l'Excel. */
export const GARES_LIGNE: readonly GareGrille[] = [
  { id: 'le-fayet', nom: 'Le Fayet', altitude_m: 580 },
  { id: 'saint-gervais', nom: 'Saint-Gervais', altitude_m: 786 },
  { id: 'motivon', nom: 'Motivon', altitude_m: 1375 },
  { id: 'col-de-voza', nom: 'Col de Voza', altitude_m: 1653 },
  { id: 'bellevue', nom: 'Bellevue', altitude_m: 1794 },
  { id: 'nid-daigle', nom: "Nid d'Aigle", altitude_m: 2412 },
];

/** Repli du moteur si une arrivée manque (docs/01 §2.1). */
export const ARRET_INTERMEDIAIRE_S = 60;

export const REGLES_GRILLE: Readonly<Record<string, string>> = {
  express:
    'ne dessert ni col-de-voza ni bellevue (passages absents) ; picto motrice + mention bilingue',
  facultatif:
    "opéré selon météo et affluence, confirmé au plus tard la veille au soir ; n'apparaît sur les écrans que s'il est activé en supervision",
  velos: 'train accessible aux vélos (5 max, selon affluence)',
  'mont-lachat':
    'halte de SERVICE non desservie : volontairement absente des grilles et des écrans',
};

/**
 * Durées d'arrêt habituelles, par sens (contrôle → avertissement si
 * différent) : 5 min à Saint-Gervais en montée, 2 min en descente ; 1 min à
 * Motivon ; 2 min à Col de Voza et Bellevue.
 */
export const ARRETS_HABITUELS_S: Readonly<Record<Sens, Readonly<Partial<Record<GareId, number>>>>> =
  {
    montee: { 'saint-gervais': 300, motivon: 60, 'col-de-voza': 120, bellevue: 120 },
    descente: { 'saint-gervais': 120, motivon: 60, 'col-de-voza': 120, bellevue: 120 },
  };

/** Reconnaissance des gares par mot-clé (docs/format-excel-horaires.md §3). */
const MOTS_CLES_GARES: ReadonlyArray<[RegExp, GareId]> = [
  [/fayet/, 'le-fayet'],
  [/gervais/, 'saint-gervais'],
  [/motivon/, 'motivon'],
  [/voza/, 'col-de-voza'],
  [/bellevue/, 'bellevue'],
  [/aigle/, 'nid-daigle'],
];

/** Halte de service : lue puis ignorée. */
const GARES_IGNOREES: readonly RegExp[] = [/lachat/];

const TITRE_MONTEES = 'horaires des montees';
const TITRE_DESCENTES = 'horaires des descentes';

/** Lettres de la légende du document (police sans importance : le caractère compte). */
const LETTRE_FACULTATIF = 'R';
const LETTRE_VELOS = 'b';
const LETTRE_EXPRESS = 'ÿ';

const MOIS = [
  'janvier',
  'fevrier',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'aout',
  'septembre',
  'octobre',
  'novembre',
  'decembre',
];

// ---------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------

/** Texte comparable : sans accents, espaces (et retours à la ligne) réduits, minuscules. */
export function normalise(v: Cellule | undefined): string {
  if (v === null || v === undefined) return '';
  return String(v).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Index de colonne (0 = A) → lettre Excel (« A », « Z », « AA »). */
export function lettreColonne(index: number): string {
  let lettres = '';
  let n = index + 1;
  while (n > 0) {
    const reste = (n - 1) % 26;
    lettres = String.fromCharCode(65 + reste) + lettres;
    n = Math.floor((n - 1) / 26);
  }
  return lettres;
}

function texteBrut(v: Cellule | undefined): string {
  return v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim();
}

function estVide(v: Cellule | undefined): boolean {
  return v === null || v === undefined || String(v).trim() === '';
}

export function nomGare(id: GareId): string {
  return GARES_LIGNE.find((g) => g.id === id)?.nom ?? id;
}

function localisation(p: Pick<Probleme, 'feuille' | 'ligne' | 'colonne'>): string {
  const morceaux: string[] = [];
  if (p.feuille) morceaux.push(`feuille « ${p.feuille} »`);
  if (p.ligne !== undefined) morceaux.push(`ligne ${p.ligne}`);
  if (p.colonne) morceaux.push(`colonne ${p.colonne}`);
  return morceaux.length > 0 ? ` (${morceaux.join(', ')})` : '';
}

function probleme(
  niveau: NiveauProbleme,
  message: string,
  detail: Omit<Probleme, 'niveau' | 'message'> = {},
): Probleme {
  return { niveau, message: message + localisation(detail), ...detail };
}

/** Durée en secondes → « 5 min », « 1 min 30 s », « 45 s ». */
export function formatDuree(s: number): string {
  const minutes = Math.floor(s / 60);
  const secondes = s % 60;
  if (minutes === 0) return `${secondes} s`;
  return secondes === 0 ? `${minutes} min` : `${minutes} min ${secondes} s`;
}

// ---------------------------------------------------------------------------
// Heures
// ---------------------------------------------------------------------------

export type HeureLue =
  | { type: 'heure'; texte: string; s: number }
  | { type: 'vide' }
  | { type: 'sansArret' }
  | { type: 'invalide'; brut: string };

/**
 * Interprète une cellule d'heure : nombre Excel (fraction de jour, secondes
 * conservées), texte « 7:26 », « 07:26:30 », « 7h26 », tiret = pas d'arrêt.
 */
export function interpreteHeure(v: Cellule | undefined): HeureLue {
  if (estVide(v)) return { type: 'vide' };
  if (typeof v === 'number') {
    if (v < 0 || v >= 1) return { type: 'invalide', brut: String(v) };
    return heureDepuisSecondes(Math.round(v * 86400));
  }
  const texte = String(v).trim();
  if (/^[-–—]+$/.test(texte)) return { type: 'sansArret' };
  const m = /^(\d{1,2})\s*[:hH]\s*(\d{2})(?:\s*:\s*(\d{2}))?$/.exec(texte);
  if (!m) return { type: 'invalide', brut: texte };
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = m[3] === undefined ? 0 : Number(m[3]);
  if (hh > 23 || mm > 59 || ss > 59) return { type: 'invalide', brut: texte };
  return heureDepuisSecondes(hh * 3600 + mm * 60 + ss);
}

function heureDepuisSecondes(s: number): HeureLue {
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const deux = (n: number): string => String(n).padStart(2, '0');
  return { type: 'heure', texte: `${deux(hh)}:${deux(mm)}:${deux(ss)}`, s };
}

// ---------------------------------------------------------------------------
// Feuilles et classeur
// ---------------------------------------------------------------------------

function indexTitre(lignes: Cellule[][], titre: string): number {
  return lignes.findIndex((l) => normalise(l[0]).startsWith(titre));
}

/** Une feuille d'horaires porte les deux titres en colonne A. */
export function estFeuilleHoraires(feuille: FeuilleCellules): boolean {
  return (
    indexTitre(feuille.lignes, TITRE_MONTEES) >= 0 &&
    indexTitre(feuille.lignes, TITRE_DESCENTES) >= 0
  );
}

/** Lit toutes les feuilles d'horaires d'un classeur (les autres sont ignorées). */
export function parseClasseur(feuilles: FeuilleCellules[]): ResultatClasseur {
  const horaires = feuilles.filter(estFeuilleHoraires);
  if (horaires.length === 0) {
    const noms = feuilles.map((f) => `« ${f.nom} »`).join(', ') || 'aucune';
    return {
      feuilles: [],
      erreurs: [
        probleme(
          'erreur',
          `Aucune feuille ne contient les titres « HORAIRES DES MONTEES » et « HORAIRES DES DESCENTES » en colonne A (feuilles lues : ${noms})`,
        ),
      ],
    };
  }
  return { feuilles: horaires.map(parseFeuille), erreurs: [] };
}

export function parseFeuille(feuille: FeuilleCellules): ResultatFeuille {
  const { nom, lignes } = feuille;
  const erreurs: Probleme[] = [];
  const avertissements: Probleme[] = [];
  const a1 = lignes[0]?.[0];
  const titre = typeof a1 === 'string' && a1.trim() !== '' ? texteBrut(a1) : null;
  const miseAJour = chercheMiseAJour(lignes);
  const periodesProposees = titre ? periodesDepuisTitre(titre) : [];

  const iMontees = indexTitre(lignes, TITRE_MONTEES);
  const iDescentes = indexTitre(lignes, TITRE_DESCENTES);
  if (iMontees < 0) {
    erreurs.push(
      probleme('erreur', 'Titre « HORAIRES DES MONTEES » absent de la colonne A', { feuille: nom }),
    );
  }
  if (iDescentes < 0) {
    erreurs.push(
      probleme('erreur', 'Titre « HORAIRES DES DESCENTES » absent de la colonne A', {
        feuille: nom,
      }),
    );
  }
  if (iMontees < 0 || iDescentes < 0) {
    return { nom, titre, miseAJour, periodesProposees, grille: null, erreurs, avertissements };
  }

  const ctx = { feuille: nom, lignes, erreurs, avertissements };
  const montees = lireBloc(
    ctx,
    iMontees,
    iDescentes > iMontees ? iDescentes : lignes.length,
    'montee',
  );
  const descentes = lireBloc(
    ctx,
    iDescentes,
    iMontees > iDescentes ? iMontees : lignes.length,
    'descente',
  );
  valideTrains(nom, montees, descentes, erreurs, avertissements);

  const grille: Grille = {
    version: slug(nom),
    libelle: nom,
    source: miseAJour ? `Mise à jour du ${miseAJour}` : undefined,
    periodes: periodesProposees,
    gares: GARES_LIGNE.map((g) => ({ ...g })),
    arret_intermediaire_s: ARRET_INTERMEDIAIRE_S,
    regles: { ...REGLES_GRILLE },
    montees,
    descentes,
  };
  return { nom, titre, miseAJour, periodesProposees, grille, erreurs, avertissements };
}

/** « Mise à jour du JJ/MM/AAAA » dans les premières lignes de la feuille. */
function chercheMiseAJour(lignes: Cellule[][]): string | null {
  for (const ligne of lignes.slice(0, 4)) {
    for (const cellule of ligne) {
      if (typeof cellule !== 'string') continue;
      const m = /mise a jour du (\d{1,2}\/\d{1,2}\/\d{4})/.exec(normalise(cellule));
      if (m?.[1]) return m[1];
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Lecture d'un bloc (montées ou descentes)
// ---------------------------------------------------------------------------

interface ContexteFeuille {
  feuille: string;
  lignes: Cellule[][];
  erreurs: Probleme[];
  avertissements: Probleme[];
}

interface ColonneTrain {
  colonne: number;
  numero: number;
}

interface LectureCellule {
  valeur: Cellule;
  ligne: number;
  colonne: number;
}

type EtatGare = GareId | 'ignoree' | 'inconnue' | null;

function resoudGare(texteNormalise: string): EtatGare {
  if (GARES_IGNOREES.some((m) => m.test(texteNormalise))) return 'ignoree';
  for (const [motif, id] of MOTS_CLES_GARES) if (motif.test(texteNormalise)) return id;
  return 'inconnue';
}

function estLigneDeGare(ligne: Cellule[]): boolean {
  const b = normalise(ligne[1]);
  return b === 'a' || b === 'd';
}

function lireBloc(ctx: ContexteFeuille, debut: number, fin: number, sens: Sens): TrainGrille[] {
  const { feuille, lignes, erreurs } = ctx;
  const titre = sens === 'montee' ? 'HORAIRES DES MONTEES' : 'HORAIRES DES DESCENTES';
  const ligneEntete = debut + 1;
  const entete = lignes[ligneEntete] ?? [];

  // 1. La ligne des trains
  const colonnes: ColonneTrain[] = [];
  entete.forEach((v, c) => {
    if (c < 2) return; // A = gares, B = A/D
    const n = normalise(v);
    if (!n) return;
    const m = /^train\s*(\d+)$/.exec(n);
    if (m) {
      colonnes.push({ colonne: c, numero: Number(m[1]) });
    } else if (/^train\b/.test(n) && n.length <= 14) {
      erreurs.push(
        probleme(
          'erreur',
          `« ${texteBrut(v)} » n'est pas un numéro de train reconnu : écrire « Train 1 », « Train 3 »…`,
          { feuille, ligne: ligneEntete + 1, colonne: lettreColonne(c) },
        ),
      );
    }
  });
  if (colonnes.length === 0) {
    erreurs.push(
      probleme(
        'erreur',
        `Aucun numéro de train (« Train 1 », « Train 3 »…) sous le titre « ${titre} »`,
        {
          feuille,
          ligne: ligneEntete + 1,
        },
      ),
    );
    return [];
  }
  const doublons = new Set<number>();
  const vus = new Map<number, number>();
  for (const { colonne, numero } of colonnes) {
    const premiere = vus.get(numero);
    if (premiere !== undefined) {
      doublons.add(colonne);
      erreurs.push(
        probleme(
          'erreur',
          `TRAIN ${numero} apparaît deux fois (colonnes ${lettreColonne(premiere)} et ${lettreColonne(colonne)})`,
          { feuille, ligne: ligneEntete + 1, colonne: lettreColonne(colonne), train: numero },
        ),
      );
      continue;
    }
    vus.set(numero, colonne);
    if (sens === 'montee' && numero % 2 === 0) {
      erreurs.push(
        probleme('erreur', `TRAIN ${numero} : une montée porte un numéro impair (1, 3, 5…)`, {
          feuille,
          ligne: ligneEntete + 1,
          colonne: lettreColonne(colonne),
          train: numero,
        }),
      );
    }
    if (sens === 'descente' && numero % 2 === 1) {
      erreurs.push(
        probleme('erreur', `TRAIN ${numero} : une descente porte un numéro pair (2, 4, 6…)`, {
          feuille,
          ligne: ligneEntete + 1,
          colonne: lettreColonne(colonne),
          train: numero,
        }),
      );
    }
  }

  // 2. La ligne des lettres (facultative)
  let r = ligneEntete + 1;
  const indicateurs = new Map<number, string>();
  const ligneIndicateurs = lignes[r] ?? [];
  if (r < fin && !estLigneDeGare(ligneIndicateurs) && normalise(ligneIndicateurs[0]) === '') {
    for (const { colonne, numero } of colonnes) {
      const v = ligneIndicateurs[colonne];
      if (estVide(v)) continue;
      const lettres = String(v).replace(/\s+/g, '');
      const inconnues = [...lettres].filter(
        (l) => l !== LETTRE_FACULTATIF && l !== LETTRE_VELOS && l !== LETTRE_EXPRESS,
      );
      if (inconnues.length > 0) {
        erreurs.push(
          probleme(
            'erreur',
            `TRAIN ${numero} : indicateur « ${lettres} » inconnu (lettres acceptées : R facultatif, b vélos, ÿ express)`,
            { feuille, ligne: r + 1, colonne: lettreColonne(colonne), train: numero },
          ),
        );
      }
      indicateurs.set(colonne, lettres);
    }
    r++;
  }

  // 3. Les lignes de gares
  const lectures = new Map<number, Map<GareId, { a?: LectureCellule; d?: LectureCellule }>>();
  const ordreGares: GareId[] = [];
  let gareCourante: EtatGare = null;
  for (; r < fin; r++) {
    const l = lignes[r] ?? [];
    const a = normalise(l[0]);
    const b = normalise(l[1]);
    const aDesValeurs = colonnes.some(({ colonne }) => !estVide(l[colonne]));

    if (b === 'a' || b === 'd') {
      if (a) {
        gareCourante = resoudGare(a);
        if (gareCourante === 'inconnue') {
          erreurs.push(
            probleme(
              'erreur',
              `Gare inconnue « ${texteBrut(l[0])} » — noms attendus : Le Fayet, Saint-Gervais, Motivon, Col de Voza, Bellevue, Nid d'Aigle (Mont Lachat est ignoré)`,
              { feuille, ligne: r + 1, colonne: 'A' },
            ),
          );
        }
      } else if (gareCourante === null) {
        erreurs.push(
          probleme('erreur', 'Ligne d’heures sans nom de gare en colonne A', {
            feuille,
            ligne: r + 1,
            colonne: 'A',
          }),
        );
        continue;
      }
      if (gareCourante === 'ignoree' || gareCourante === 'inconnue' || gareCourante === null) {
        continue;
      }
      const gare: GareId = gareCourante;
      if (!ordreGares.includes(gare)) ordreGares.push(gare);
      for (const { colonne } of colonnes) {
        let parGare = lectures.get(colonne);
        if (!parGare) {
          parGare = new Map();
          lectures.set(colonne, parGare);
        }
        let entree = parGare.get(gare);
        if (!entree) {
          entree = {};
          parGare.set(gare, entree);
        }
        const lecture: LectureCellule = { valeur: l[colonne] ?? null, ligne: r + 1, colonne };
        if (b === 'a') entree.a = lecture;
        else entree.d = lecture;
      }
      continue;
    }
    if (!a && !b && !aDesValeurs) continue; // ligne vide
    if (aDesValeurs) {
      erreurs.push(
        probleme('erreur', 'Des heures sur une ligne dont la colonne B n’indique ni A ni D', {
          feuille,
          ligne: r + 1,
          colonne: 'B',
        }),
      );
      continue;
    }
    break; // texte en colonne A sans A/D : notes de bas de tableau, fin du bloc
  }
  if (ordreGares.length === 0) {
    erreurs.push(
      probleme('erreur', `Aucune ligne de gare (colonne B = A ou D) sous le titre « ${titre} »`, {
        feuille,
        ligne: ligneEntete + 1,
      }),
    );
    return [];
  }

  // 4. Construction des trains
  const trains: TrainGrille[] = [];
  for (const { colonne, numero } of colonnes) {
    if (doublons.has(colonne)) continue;
    const lettres = indicateurs.get(colonne) ?? '';
    const parGare =
      lectures.get(colonne) ?? new Map<GareId, { a?: LectureCellule; d?: LectureCellule }>();
    const passages: PassageGrille[] = [];
    for (const gare of ordreGares) {
      const entree = parGare.get(gare);
      if (!entree) continue;
      const a = entree.a ? interpreteHeure(entree.a.valeur) : undefined;
      const d = entree.d ? interpreteHeure(entree.d.valeur) : undefined;
      const sauteA = a === undefined || a.type === 'sansArret';
      const sauteD = d === undefined || d.type === 'sansArret';
      if (sauteA && sauteD) continue; // tirets sur toutes les lignes de la gare : pas d'arrêt
      const passage: PassageGrille = { gare };
      const paires: Array<['a' | 'd', HeureLue | undefined, LectureCellule | undefined]> = [
        ['a', a, entree.a],
        ['d', d, entree.d],
      ];
      for (const [champ, heure, lecture] of paires) {
        if (!heure || !lecture) continue;
        const ou = {
          feuille,
          ligne: lecture.ligne,
          colonne: lettreColonne(colonne),
          train: numero,
          gare,
        };
        const quoi = champ === 'a' ? 'arrivée' : 'départ';
        switch (heure.type) {
          case 'heure':
            passage[champ] = heure.texte;
            break;
          case 'vide':
            erreurs.push(
              probleme(
                'erreur',
                `Heure manquante : TRAIN ${numero}, ${nomGare(gare)}, ${quoi}`,
                ou,
              ),
            );
            break;
          case 'sansArret':
            erreurs.push(
              probleme(
                'erreur',
                `TRAIN ${numero}, ${nomGare(gare)} : tiret sur la ligne ${champ.toUpperCase()} mais une heure sur l'autre — un train qui ne s'arrête pas porte un tiret sur les deux lignes`,
                ou,
              ),
            );
            break;
          case 'invalide':
            erreurs.push(
              probleme(
                'erreur',
                `« ${heure.brut} » n'est pas une heure (TRAIN ${numero}, ${nomGare(gare)}, ${quoi}) — formats acceptés : 7:26, 07:26:30, 7h26`,
                ou,
              ),
            );
            break;
        }
      }
      if (passage.a !== undefined || passage.d !== undefined) passages.push(passage);
    }
    // Point de départ : jamais d'arrivée ; terminus : jamais de départ.
    const premier = passages[0];
    if (premier && premier.a !== undefined && passages.length > 1) {
      ctx.avertissements.push(
        probleme(
          'avertissement',
          `TRAIN ${numero} : heure d'arrivée au point de départ (${nomGare(premier.gare)}) ignorée`,
          { feuille, train: numero, gare: premier.gare },
        ),
      );
      delete premier.a;
    }
    const dernier = passages[passages.length - 1];
    if (dernier && dernier.d !== undefined && passages.length > 1) {
      ctx.avertissements.push(
        probleme(
          'avertissement',
          `TRAIN ${numero} : heure de départ au terminus (${nomGare(dernier.gare)}) ignorée`,
          { feuille, train: numero, gare: dernier.gare },
        ),
      );
      delete dernier.d;
    }
    trains.push({
      numero,
      express: lettres.includes(LETTRE_EXPRESS),
      facultatif: lettres.includes(LETTRE_FACULTATIF),
      velos: lettres.includes(LETTRE_VELOS),
      passages,
    });
  }
  return trains;
}

// ---------------------------------------------------------------------------
// Validation sémantique
// ---------------------------------------------------------------------------

function indexGare(id: GareId): number {
  return ORDRE_GARES.indexOf(id);
}

function hhmm(h: string | undefined): string {
  return h === undefined ? '—' : formatHeure(heureVersSecondes(h));
}

/**
 * Contrôles qui portent sur la grille lue, indépendamment des cellules :
 * ordre des gares, chronologie, express, appariement, rotations, arrêts.
 * Exportée pour pouvoir tester des grilles construites à la main.
 */
export function valideTrains(
  feuille: string,
  montees: TrainGrille[],
  descentes: TrainGrille[],
  erreurs: Probleme[],
  avertissements: Probleme[],
): void {
  const listes: Array<[Sens, TrainGrille[]]> = [
    ['montee', montees],
    ['descente', descentes],
  ];
  for (const [sens, trains] of listes) {
    for (const train of trains) {
      valideTrain(feuille, sens, train, erreurs, avertissements);
    }
  }

  // Appariement : la descente n suit la montée n − 1 (même rame).
  for (const descente of descentes) {
    const montee = montees.find((m) => m.numero === descente.numero - 1);
    if (!montee) {
      erreurs.push(
        probleme(
          'erreur',
          `TRAIN ${descente.numero} : descente sans montée appariée (TRAIN ${descente.numero - 1} absent)`,
          { feuille, train: descente.numero },
        ),
      );
      continue;
    }
    // Rotation : la rame doit être arrivée avant de repartir, du bon endroit.
    const arrivee = montee.passages[montee.passages.length - 1];
    const depart = descente.passages[0];
    if (!arrivee || !depart) continue;
    if (arrivee.gare !== depart.gare) {
      avertissements.push(
        probleme(
          'avertissement',
          `Rotation TRAIN ${montee.numero} / TRAIN ${descente.numero} : la montée arrive à ${nomGare(arrivee.gare)}, la descente part de ${nomGare(depart.gare)}`,
          { feuille, train: descente.numero },
        ),
      );
    } else if (arrivee.a !== undefined && depart.d !== undefined && depart.d < arrivee.a) {
      avertissements.push(
        probleme(
          'avertissement',
          `Rotation TRAIN ${montee.numero} / TRAIN ${descente.numero} : la descente part à ${hhmm(depart.d)} avant l'arrivée de la montée à ${hhmm(arrivee.a)}`,
          { feuille, train: descente.numero },
        ),
      );
    }
  }
  for (const montee of montees) {
    if (!descentes.some((d) => d.numero === montee.numero + 1)) {
      avertissements.push(
        probleme(
          'avertissement',
          `TRAIN ${montee.numero} : montée sans descente appariée (TRAIN ${montee.numero + 1} absent)`,
          { feuille, train: montee.numero },
        ),
      );
    }
  }
}

function valideTrain(
  feuille: string,
  sens: Sens,
  train: TrainGrille,
  erreurs: Probleme[],
  avertissements: Probleme[],
): void {
  const ou = { feuille, train: train.numero };
  const { numero, passages } = train;
  if (passages.length < 2) {
    erreurs.push(probleme('erreur', `TRAIN ${numero} : moins de deux gares desservies`, ou));
    return;
  }

  // Ordre des gares le long de la ligne
  const indices = passages.map((p) => indexGare(p.gare));
  const croissant = indices.every((i, k) => k === 0 || i > (indices[k - 1] ?? -1));
  const decroissant = indices.every((i, k) => k === 0 || i < (indices[k - 1] ?? 99));
  if ((sens === 'montee' && !croissant) || (sens === 'descente' && !decroissant)) {
    erreurs.push(
      probleme(
        'erreur',
        `TRAIN ${numero} : l'ordre des gares (${passages.map((p) => nomGare(p.gare)).join(' → ')}) ne correspond pas à une ${sens === 'montee' ? 'montée (du Fayet vers le sommet)' : 'descente (du sommet vers Le Fayet)'}`,
        ou,
      ),
    );
    return;
  }

  // Chronologie et durées d'arrêt
  let precedent: { gare: GareId; heure: string } | null = null;
  for (const passage of passages) {
    if (passage.a !== undefined && passage.d !== undefined && passage.a > passage.d) {
      erreurs.push(
        probleme(
          'erreur',
          `TRAIN ${numero}, ${nomGare(passage.gare)} : arrivée ${hhmm(passage.a)} après le départ ${hhmm(passage.d)}`,
          { ...ou, gare: passage.gare },
        ),
      );
    }
    const debut = passage.a ?? passage.d;
    if (debut !== undefined && precedent !== null && debut <= precedent.heure) {
      erreurs.push(
        probleme(
          'erreur',
          `TRAIN ${numero} : ${nomGare(passage.gare)} (${hhmm(debut)}) n'est pas après ${nomGare(precedent.gare)} (${hhmm(precedent.heure)}) — les heures doivent se suivre le long de la ligne`,
          { ...ou, gare: passage.gare },
        ),
      );
    }
    const finPassage = passage.d ?? passage.a;
    if (finPassage !== undefined) precedent = { gare: passage.gare, heure: finPassage };

    if (passage.a !== undefined && passage.d !== undefined) {
      const duree = heureVersSecondes(passage.d) - heureVersSecondes(passage.a);
      const attendu = ARRETS_HABITUELS_S[sens][passage.gare];
      if (attendu !== undefined && duree >= 0 && duree !== attendu) {
        avertissements.push(
          probleme(
            'avertissement',
            `TRAIN ${numero} : arrêt de ${formatDuree(duree)} à ${nomGare(passage.gare)} (habituellement ${formatDuree(attendu)})`,
            { ...ou, gare: passage.gare },
          ),
        );
      }
    }
  }

  // Express : symbole et passages doivent dire la même chose
  const min = Math.min(...indices);
  const max = Math.max(...indices);
  const present = new Set(passages.map((p) => p.gare));
  const sautees = ORDRE_GARES.filter((g, i) => i > min && i < max && !present.has(g));
  const sauteVoza = sautees.includes('col-de-voza');
  const sauteBellevue = sautees.includes('bellevue');
  if (train.express && (present.has('col-de-voza') || present.has('bellevue'))) {
    const gares = (['col-de-voza', 'bellevue'] as const).filter((g) => present.has(g)).map(nomGare);
    erreurs.push(
      probleme(
        'erreur',
        `TRAIN ${numero} : symbole express (ÿ) mais des heures à ${gares.join(' et ')} — un express ne s'y arrête pas`,
        ou,
      ),
    );
  }
  if (!train.express && sauteVoza && sauteBellevue) {
    erreurs.push(
      probleme(
        'erreur',
        `TRAIN ${numero} : passages absents à Col de Voza et Bellevue sans le symbole express (ÿ)`,
        ou,
      ),
    );
  } else if (!train.express && (sauteVoza || sauteBellevue)) {
    erreurs.push(
      probleme(
        'erreur',
        `TRAIN ${numero} : passage absent à ${nomGare(sauteVoza ? 'col-de-voza' : 'bellevue')} — seul un express (ÿ) saute des gares, et il saute Col de Voza ET Bellevue`,
        ou,
      ),
    );
  }
  const autresSautees = sautees.filter((g) => g !== 'col-de-voza' && g !== 'bellevue');
  if (autresSautees.length > 0) {
    erreurs.push(
      probleme(
        'erreur',
        `TRAIN ${numero} : passage absent à ${autresSautees.map(nomGare).join(' et ')} — tous les trains desservent ${autresSautees.length > 1 ? 'ces gares' : 'cette gare'}`,
        ou,
      ),
    );
  }
}

/**
 * Avertissements de comparaison avec la grille précédente couvrant les mêmes
 * dates : trains disparus, indicateurs différents (le fichier fait foi).
 */
export function avertissementsGrillePrecedente(nouvelle: Grille, precedente: Grille): Probleme[] {
  const e = ecarts(precedente, nouvelle);
  const resultat: Probleme[] = [];
  for (const t of e.trainsRetires) {
    resultat.push(
      probleme(
        'avertissement',
        `TRAIN ${t.numero} (${t.sens === 'montee' ? 'montée' : 'descente'}) présent dans la grille précédente « ${precedente.libelle} », absent de la nouvelle`,
        { train: t.numero },
      ),
    );
  }
  for (const i of e.indicateurs) {
    const ouiNon = (b: boolean): string => (b ? 'oui' : 'non');
    resultat.push(
      probleme(
        'avertissement',
        `TRAIN ${i.numero} : ${i.champ} ${ouiNon(i.avant)} → ${ouiNon(i.apres)} dans le fichier (le fichier fait foi)`,
        { train: i.numero },
      ),
    );
  }
  return resultat;
}

// ---------------------------------------------------------------------------
// Périodes, saison, identifiant
// ---------------------------------------------------------------------------

function dateISO(annee: number, mois: number, jour: number): string | null {
  const d = new Date(Date.UTC(annee, mois - 1, jour));
  if (d.getUTCFullYear() !== annee || d.getUTCMonth() !== mois - 1 || d.getUTCDate() !== jour) {
    return null;
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Dates de validité écrites en prose dans le titre : « DU 13 JUIN AU 3
 * JUILLET 2026 ET DU 31 AOUT AU 27 SEPTEMBRE 2026 ». Une date sans année
 * prend celle de l'autre borne (année suivante si la période franchit le
 * Nouvel An). Sans aucune année : rien n'est proposé.
 */
export function periodesDepuisTitre(titre: string): Periode[] {
  const t = normalise(titre);
  const motif =
    /du (\d{1,2})(?:er)?\s+([a-z]+)(?:\s+(\d{4}))?\s+au (\d{1,2})(?:er)?\s+([a-z]+)(?:\s+(\d{4}))?/g;
  const periodes: Periode[] = [];
  for (const m of t.matchAll(motif)) {
    const mois1 = MOIS.indexOf(m[2] ?? '');
    const mois2 = MOIS.indexOf(m[5] ?? '');
    if (mois1 < 0 || mois2 < 0) continue;
    let annee1 = m[3] ? Number(m[3]) : Number.NaN;
    let annee2 = m[6] ? Number(m[6]) : Number.NaN;
    if (Number.isNaN(annee1) && Number.isNaN(annee2)) continue;
    if (Number.isNaN(annee2)) annee2 = mois2 < mois1 ? annee1 + 1 : annee1;
    if (Number.isNaN(annee1)) annee1 = mois1 > mois2 ? annee2 - 1 : annee2;
    const du = dateISO(annee1, mois1 + 1, Number(m[1]));
    const au = dateISO(annee2, mois2 + 1, Number(m[4]));
    if (du === null || au === null || du > au) continue;
    periodes.push({ du, au });
  }
  return periodes;
}

export type Saison = 'ete' | 'hiver';

/** Saison déduite de la première période : mai → octobre = été, sinon hiver. */
export function saisonDepuisPeriodes(periodes: Periode[]): Saison | null {
  const premiere = [...periodes].sort((a, b) => a.du.localeCompare(b.du))[0];
  if (!premiere) return null;
  const mois = Number(premiere.du.slice(5, 7));
  return mois >= 5 && mois <= 10 ? 'ete' : 'hiver';
}

/** « 2026 », ou « 2026-2027 » si les périodes franchissent le Nouvel An. */
export function anneesDepuisPeriodes(periodes: Periode[]): string | null {
  if (periodes.length === 0) return null;
  const debut = Math.min(...periodes.map((p) => Number(p.du.slice(0, 4))));
  const fin = Math.max(...periodes.map((p) => Number(p.au.slice(0, 4))));
  return debut === fin ? String(debut) : `${debut}-${fin}`;
}

/** « Grand service » → « grand-service ». */
export function slug(texte: string): string {
  return normalise(texte)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Identifiant proposé : `année-saison-nom-de-feuille` (ex. 2026-ete-grand-
 * service, 2026-2027-hiver). null tant que les périodes ne sont pas connues.
 */
export function versionProposee(nomFeuille: string, periodes: Periode[]): string | null {
  const saison = saisonDepuisPeriodes(periodes);
  const annees = anneesDepuisPeriodes(periodes);
  if (!saison || !annees) return null;
  const nom = slug(nomFeuille);
  return nom === saison || nom === '' ? `${annees}-${saison}` : `${annees}-${saison}-${nom}`;
}

/** Libellé proposé : « Grand service — été 2026 », « Hiver 2026-2027 ». */
export function libelleProposee(nomFeuille: string, periodes: Periode[]): string {
  const nom = nomFeuille.trim();
  const saison = saisonDepuisPeriodes(periodes);
  const annees = anneesDepuisPeriodes(periodes);
  if (!saison || !annees) return nom;
  const libelleSaison = saison === 'ete' ? 'été' : 'hiver';
  return slug(nom) === saison ? `${nom} ${annees}` : `${nom} — ${libelleSaison} ${annees}`;
}

/** Première version libre : base, puis base-v2, base-v3… (jamais d'écrasement). */
export function versionDisponible(base: string, existantes: readonly string[]): string {
  const prises = new Set(existantes);
  if (!prises.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-v${n}`;
    if (!prises.has(candidate)) return candidate;
  }
}

/** Deux périodes se recouvrent-elles (bornes incluses) ? */
export function periodesSeChevauchent(a: Periode, b: Periode): boolean {
  return a.du <= b.au && b.du <= a.au;
}

/**
 * Dans un même classeur, deux feuilles ne peuvent pas être valides les mêmes
 * jours. Contrôle à faire sur les périodes CONFIRMÉES par l'agent.
 */
export function chevauchementsPeriodes(
  feuilles: Array<{ nom: string; periodes: Periode[] }>,
): Probleme[] {
  const problemes: Probleme[] = [];
  for (let i = 0; i < feuilles.length; i++) {
    for (let j = i + 1; j < feuilles.length; j++) {
      const a = feuilles[i];
      const b = feuilles[j];
      if (!a || !b) continue;
      for (const pa of a.periodes) {
        for (const pb of b.periodes) {
          if (periodesSeChevauchent(pa, pb)) {
            problemes.push(
              probleme(
                'erreur',
                `Les dates de « ${a.nom} » (${pa.du} → ${pa.au}) et de « ${b.nom} » (${pb.du} → ${pb.au}) se chevauchent : une seule grille par jour`,
              ),
            );
          }
        }
      }
    }
  }
  return problemes;
}
