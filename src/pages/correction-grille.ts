// Logique PURE de la carte « Corriger cette grille » (et de « Dupliquer »),
// extraite pour être testable sans DOM. Le rendu et les appels au fournisseur
// vivent dans onglet-horaires.ts.
//
// Ce module n'énonce AUCUNE règle métier : les gestes viennent de
// src/core/edition-grille.ts, la validation de validationEdition() — donc du
// validateur de l'import —, les écarts de ecarts-grille.ts, les contrôles de
// dates de problemesPeriodes(). Ce qui est ici, et nulle part ailleurs :
// l'enchaînement, ce qui bloque l'enregistrement, et ce qui est consigné.
//
// DEUX MODES, une seule carte :
//  - « correction » : le contenu d'une grille enregistrée change. Les dates
//    de validité et le nom sont ceux de l'originale et ne se touchent pas ici
//    (c'est « Modifier », en place) ; l'enregistrement crée une NOUVELLE
//    version qui devient active, puis SUPPRIME l'ancienne : il ne reste
//    qu'une grille, et il n'y a plus de retour arrière. Une version n'est
//    jamais réécrite — on la remplace.
//  - « duplication » : le contenu part d'une grille existante mais devient
//    une grille NEUVE, dont le nom et les dates sont à saisir. Rien n'est
//    désactivé : c'est une grille de plus.
import { ecarts, libellePeriodes, type EcartsGrilles } from '../core/ecarts-grille';
import { dupliqueGrille, validationEdition, versionCorrigee } from '../core/edition-grille';
import { effetChangementPeriodes, type EffetPeriodes } from '../core/grilles-periodes';
import {
  problemesPeriodes,
  versionDisponible,
  versionProposee,
  type Probleme,
} from '../core/import-grille';
import type { Grille, Periode } from '../core/types';
import type { DataProvider } from '../data/provider';
import { dateCourte } from './horaires-onglet';

export type ModeCorrection = 'correction' | 'duplication';

/** Ce que l'agent a tapé dans une cellule, et pourquoi ça n'a pas été retenu. */
export interface SaisieRefusee {
  saisie: string;
  message: string;
}

/** Carte de correction ouverte : l'originale, la saisie, et ce qui l'accompagne. */
export interface CorrectionEnCours {
  mode: ModeCorrection;
  /** Grille de départ, telle qu'enregistrée : la référence des écarts. */
  origine: Grille;
  /** Grille en cours de saisie (jamais celle d'origine : chaque geste en renvoie une copie). */
  grille: Grille;
  /** Duplication seulement : nom et dates à saisir (une correction hérite de l'originale). */
  libelle: string;
  periodes: Periode[];
  commentaire: string;
  /**
   * Saisies REFUSÉES, par cellule (« montee|5|motivon|a »). La cellule garde
   * ce que l'agent a tapé — l'effacer sous ses doigts pour revenir à l'heure
   * d'avant lui cacherait sa faute de frappe.
   */
  erreursCellules: Map<string, SaisieRefusee>;
  avertissementsAcquittes: boolean;
  /** Journées déjà préparées sur les dates concernées ; cochées = à réinitialiser. */
  joursExistants: string[];
  joursAReinitialiser: Set<string>;
}

/** Clé d'une cellule dans `erreursCellules` — même forme qu'ailleurs dans l'onglet. */
export function cleCellule(sens: string, numero: number, gare: string, champ: string): string {
  return `${sens}|${numero}|${gare}|${champ}`;
}

export function nouvelleCorrection(origine: Grille): CorrectionEnCours {
  return {
    mode: 'correction',
    origine,
    grille: structuredClone(origine),
    libelle: origine.libelle,
    periodes: origine.periodes.map((p) => ({ ...p })),
    commentaire: '',
    erreursCellules: new Map(),
    avertissementsAcquittes: false,
    joursExistants: [],
    joursAReinitialiser: new Set(),
  };
}

/**
 * Duplication : le contenu est repris, le nom et les dates sont VIDES — les
 * remplir est le geste qui distingue la nouvelle grille de l'ancienne, et
 * pré-remplir les dates de l'été sur une grille d'hiver inviterait à les
 * oublier.
 */
export function nouvelleDuplication(origine: Grille): CorrectionEnCours {
  return {
    mode: 'duplication',
    origine,
    grille: dupliqueGrille(origine, {
      version: '',
      libelle: '',
      periodes: [],
      source: `copie de « ${origine.libelle} » (référence ${origine.version})`,
    }),
    libelle: '',
    periodes: [{ du: '', au: '' }],
    commentaire: '',
    erreursCellules: new Map(),
    avertissementsAcquittes: false,
    joursExistants: [],
    joursAReinitialiser: new Set(),
  };
}

/** Écarts avec la grille de départ (une duplication en montre autant qu'une correction). */
export function ecartsCorrection(c: CorrectionEnCours): EcartsGrilles {
  return ecarts(c.origine, { ...c.grille, periodes: c.origine.periodes });
}

/** Périodes complètes et valides de la saisie (les seules sur lesquelles raisonner). */
export function periodesRetenues(c: CorrectionEnCours): Periode[] {
  return c.mode === 'correction'
    ? c.origine.periodes.map((p) => ({ ...p }))
    : c.periodes.filter((p) => p.du !== '' && p.au !== '' && p.du <= p.au);
}

/**
 * Ce qui empêche encore d'enregistrer — vide = on peut. Les ERREURS du
 * validateur bloquent, les AVERTISSEMENTS s'acquittent : exactement la règle
 * de l'import, par le même validateur.
 */
export function raisonsBlocageCorrection(c: CorrectionEnCours): string[] {
  const raisons: string[] = [];
  const v = validationEdition(c.grille);
  for (const e of v.erreurs) raisons.push(e.message);
  if (c.erreursCellules.size > 0) {
    raisons.push(
      `${c.erreursCellules.size} saisie(s) refusée(s) : corrigez les cellules signalées en rouge.`,
    );
  }
  if (c.mode === 'duplication') {
    if (c.libelle.trim() === '') raisons.push('Donnez un nom à la nouvelle grille.');
    raisons.push(...problemesPeriodes(c.periodes).map((p) => p.message));
  } else if (ecartsCorrection(c).aucun) {
    raisons.push('Aucune correction à enregistrer : la grille est identique à l’originale.');
  }
  if (v.avertissements.length > 0 && !c.avertissementsAcquittes) {
    raisons.push('Lisez les avertissements et cochez « J’ai lu ces avertissements ».');
  }
  return raisons;
}

/** Avertissements courants (ceux du validateur), recalculés à chaque geste. */
export function avertissementsCorrection(c: CorrectionEnCours): Probleme[] {
  return validationEdition(c.grille).avertissements;
}

/**
 * La grille telle qu'elle sera enregistrée. Une correction prend le premier
 * suffixe -vN libre (versionCorrigee) et garde nom, dates et provenance
 * d'origine ; une duplication prend un identifiant neuf déduit de son nom et
 * de ses dates, comme à l'import.
 */
export function grilleAEnregistrerCorrection(
  c: CorrectionEnCours,
  versionsExistantes: readonly string[],
): Grille {
  const periodes = periodesRetenues(c);
  if (c.mode === 'correction') {
    // Même fonction que la duplication : ce qui distingue les deux modes est
    // l'identifiant et ce qu'on désactive après, pas la façon de copier.
    return dupliqueGrille(c.grille, {
      version: versionCorrigee(c.origine.version, versionsExistantes),
      libelle: c.origine.libelle,
      periodes,
      source: `corrigée en supervision depuis « ${c.origine.libelle} » (référence ${c.origine.version})`,
    });
  }
  const base = versionProposee(c.libelle.trim(), periodes);
  if (base === null) throw new Error('Dates de validité manquantes : identifiant impossible');
  return dupliqueGrille(c.grille, {
    version: versionDisponible(base, versionsExistantes),
    libelle: c.libelle.trim(),
    periodes,
    source: `copie de « ${c.origine.libelle} » (référence ${c.origine.version})`,
  });
}

/**
 * Effet des dates d'une grille QUI N'EXISTE PAS ENCORE : la même règle de
 * priorité que partout ailleurs (serviceActif), obtenue en simulant la
 * nouvelle grille dans la liste — elle est la plus récente, donc elle
 * l'emporte sur ses dates. `maintenant` est injecté : rien ici ne lit
 * l'horloge.
 */
export function effetNouvelleGrille(
  grilles: Grille[],
  candidate: Grille,
  maintenant: string,
): EffetPeriodes {
  const simulee: Grille = { ...candidate, periodes: [], actif: true, cree_le: maintenant };
  return effetChangementPeriodes([...grilles, simulee], candidate.version, candidate.periodes);
}

/** Résumé consigné au journal des publications, pour les deux modes. */
export function resumeCorrection(c: CorrectionEnCours, enregistree: Grille): string {
  const morceaux: string[] = [];
  if (c.mode === 'correction') {
    morceaux.push(
      `Grille « ${enregistree.libelle} » corrigée : nouvelle version ${enregistree.version}, qui remplace ${c.origine.version}`,
    );
  } else {
    morceaux.push(
      `Grille « ${enregistree.libelle} » créée par copie de « ${c.origine.libelle} » (référence ${enregistree.version}) : ${libellePeriodes(enregistree.periodes)}`,
    );
  }
  const e = ecartsCorrection(c);
  const compte =
    e.trainsAjoutes.length +
    e.trainsRetires.length +
    e.heures.length +
    e.indicateurs.length +
    e.jours.length;
  morceaux.push(
    compte === 0
      ? 'contenu identique'
      : `${compte} écart(s) avec « ${c.origine.libelle} » : ${e.trainsAjoutes.length} train(s) ajouté(s), ${e.trainsRetires.length} retiré(s), ${e.heures.length} heure(s) et ${e.indicateurs.length} indicateur(s) modifié(s)${
          e.jours.length > 0 ? `, ${e.jours.length} jour(s) de circulation modifié(s)` : ''
        }`,
  );
  if (c.commentaire.trim() !== '') morceaux.push(c.commentaire.trim());
  const reinitialisees = [...c.joursAReinitialiser].sort();
  if (reinitialisees.length > 0) {
    morceaux.push(
      `journée${reinitialisees.length > 1 ? 's' : ''} réinitialisée${reinitialisees.length > 1 ? 's' : ''} : ${reinitialisees.map(dateCourte).join(', ')}`,
    );
  }
  return morceaux.join(' — ');
}

/** Les seules écritures que l'enchaînement d'une correction touche (testable sans base). */
export type EcrituresCorrection = Pick<
  DataProvider,
  'saveGrille' | 'reinitialiseJour' | 'logPublication' | 'supprimerGrilleRemplacee'
>;

/** Ce qui s'est passé APRÈS l'enregistrement : la correction, elle, est déjà acquise. */
export interface IssueCorrection {
  /** Le journal n'a pas pu être écrit (la grille, elle, est enregistrée). */
  erreurJournal: unknown;
  /** Correction seulement : l'ancienne n'a pas pu être supprimée (message pour l'agent), sinon null. */
  erreurSuppression: string | null;
}

/**
 * Enchaînement d'un enregistrement, dans l'ORDRE qui ne laisse jamais de trou
 * de service :
 *  1. enregistrer la grille corrigée (ou la copie) — son échec arrête tout ;
 *  2. réinitialiser les journées cochées ;
 *  3. journaliser ;
 *  4. correction seulement : SUPPRIMER l'ancienne, en dernier.
 * Entre 1 et 4 les deux grilles sont actives et la plus récemment créée
 * l'emporte (serviceActif) : on ne perd jamais le service. Si 4 échoue, 1 n'est
 * PAS annulée : la correction est appliquée, et l'agent est prévenu que
 * l'ancienne reste à supprimer à la main. L'échec de 1 ou de 2 se propage.
 */
export async function appliqueCorrection(
  p: EcrituresCorrection,
  c: CorrectionEnCours,
  aEnregistrer: Grille,
  resume: string,
): Promise<IssueCorrection> {
  await p.saveGrille(aEnregistrer, { actif: true, commentaire: c.commentaire.trim() || null });
  for (const date of [...c.joursAReinitialiser].sort()) await p.reinitialiseJour(date);
  let erreurJournal: unknown = null;
  await p.logPublication(resume).catch((e: unknown) => {
    erreurJournal = e;
  });
  let erreurSuppression: string | null = null;
  if (c.mode === 'correction') {
    try {
      await p.supprimerGrilleRemplacee(c.origine.version, aEnregistrer.version);
    } catch (e) {
      erreurSuppression = e instanceof Error ? e.message : String(e);
      // Le journal de l'étape 3 dit « remplace » sans affirmer la suppression ;
      // celle qui n'a pas eu lieu est consignée à son tour, sinon l'historique
      // laisserait croire qu'il ne reste qu'une grille.
      await p
        .logPublication(
          `Grille « ${aEnregistrer.libelle} » : l'ancienne version ${c.origine.version} n'a pas pu être supprimée (à supprimer à la main)`,
        )
        .catch(() => undefined);
    }
  }
  return { erreurJournal, erreurSuppression };
}
