// Grilles ENREGISTRÉES (table `grilles`) : passage de la ligne de base à
// l'objet Grille du moteur, et retour — PUR et testé.
//
// Le contenu est du jsonb : la base n'en garantit que la forme minimale
// (contrainte grilles_contenu_forme, supabase/ajout-grilles.sql). Le front
// vérifie donc ce qu'il lit avant de s'en servir (règle C-01 : aucune valeur
// jsonb crue sur parole). Une grille inutilisable lève une erreur explicite :
// mieux vaut un écran neutre qu'une grille à moitié lue.
import { ORDRE_GARES } from './types';
import type { Grille, PassageGrille, Periode, TrainGrille } from './types';

/** Ligne de la table `grilles` telle que la renvoie la base. */
export interface EnregistrementGrille {
  version: string;
  libelle: string;
  source: string | null;
  /** Recopie de `contenu.periodes`, requêtable ; fait foi sur le contenu. */
  periodes: unknown;
  actif: boolean;
  cree_le: string;
  cree_par: string | null;
  commentaire: string | null;
  /** L'objet Grille complet, tel qu'importé. */
  contenu: unknown;
}

/** Repli si le contenu ne précise pas la durée d'arrêt par défaut. */
const ARRET_INTERMEDIAIRE_DEFAUT_S = 60;

const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;
const HEURE = /^\d{2}:\d{2}(:\d{2})?$/;

function estObjet(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function estPeriode(v: unknown): v is Periode {
  return (
    estObjet(v) &&
    typeof v.du === 'string' &&
    typeof v.au === 'string' &&
    DATE_ISO.test(v.du) &&
    DATE_ISO.test(v.au) &&
    v.du <= v.au
  );
}

function estPassage(v: unknown): v is PassageGrille {
  if (!estObjet(v)) return false;
  if (!(ORDRE_GARES as readonly string[]).includes(String(v.gare))) return false;
  if (v.a !== undefined && !(typeof v.a === 'string' && HEURE.test(v.a))) return false;
  if (v.d !== undefined && !(typeof v.d === 'string' && HEURE.test(v.d))) return false;
  return v.a !== undefined || v.d !== undefined;
}

function estTrain(v: unknown): v is TrainGrille {
  return (
    estObjet(v) &&
    typeof v.numero === 'number' &&
    Number.isInteger(v.numero) &&
    v.numero > 0 &&
    Array.isArray(v.passages) &&
    v.passages.length >= 2 &&
    v.passages.every(estPassage)
  );
}

/** Le contenu a-t-il la forme d'une grille exploitable par le moteur ? */
export function contenuGrilleValide(contenu: unknown): contenu is Grille {
  return (
    estObjet(contenu) &&
    Array.isArray(contenu.montees) &&
    contenu.montees.every(estTrain) &&
    Array.isArray(contenu.descentes) &&
    contenu.descentes.every(estTrain) &&
    Array.isArray(contenu.gares) &&
    contenu.gares.every((g) => estObjet(g) && typeof g.id === 'string' && typeof g.nom === 'string')
  );
}

/**
 * Objet Grille prêt pour le moteur : le contenu jsonb, vérifié, complété par
 * les métadonnées de la ligne. Version, libellé et périodes de la LIGNE font
 * foi sur ceux du contenu : c'est la ligne que l'exploitant active, désactive
 * ou renomme, jamais le contenu.
 */
export function grilleDepuisEnregistrement(ligne: EnregistrementGrille): Grille {
  const contenu = ligne.contenu;
  if (!contenuGrilleValide(contenu)) {
    throw new Error(`Grille « ${ligne.version} » : contenu illisible en base`);
  }
  const periodesLigne = Array.isArray(ligne.periodes) ? ligne.periodes.filter(estPeriode) : [];
  const periodesContenu = Array.isArray(contenu.periodes)
    ? contenu.periodes.filter(estPeriode)
    : [];
  return {
    ...contenu,
    version: ligne.version,
    libelle: ligne.libelle,
    source: ligne.source ?? contenu.source,
    periodes: periodesLigne.length > 0 ? periodesLigne : periodesContenu,
    // Les indicateurs booléens peuvent manquer dans un contenu ancien : un
    // train sans drapeau est un train normal, jamais un express fantôme.
    montees: contenu.montees.map(trainNormalise),
    descentes: contenu.descentes.map(trainNormalise),
    arret_intermediaire_s:
      typeof contenu.arret_intermediaire_s === 'number' && contenu.arret_intermediaire_s >= 0
        ? contenu.arret_intermediaire_s
        : ARRET_INTERMEDIAIRE_DEFAUT_S,
    actif: ligne.actif,
    cree_le: ligne.cree_le,
    cree_par: ligne.cree_par,
    commentaire: ligne.commentaire,
  };
}

function trainNormalise(t: TrainGrille): TrainGrille {
  return {
    numero: t.numero,
    express: t.express === true,
    facultatif: t.facultatif === true,
    velos: t.velos === true,
    passages: t.passages.map((p) => {
      const passage: PassageGrille = { gare: p.gare };
      if (p.a !== undefined) passage.a = p.a;
      if (p.d !== undefined) passage.d = p.d;
      return passage;
    }),
  };
}

/**
 * Contenu à ÉCRIRE en base pour une grille : l'objet sans ses métadonnées
 * d'enregistrement (elles vivent dans les colonnes de la ligne, pas dans le
 * jsonb — sinon deux vérités pour « active » ou « créée le »).
 */
export function contenuSansMetadonnees(g: Grille): Grille {
  const { actif: _actif, cree_le: _creeLe, cree_par: _creePar, commentaire: _comm, ...contenu } = g;
  return contenu;
}
