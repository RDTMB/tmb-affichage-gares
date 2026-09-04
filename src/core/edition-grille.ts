// Édition du CONTENU d'une grille (heures, indicateurs, rotations, terminus)
// — PUR et testé. Chaque opération prend une grille et en renvoie une copie
// modifiée : l'éditeur de la supervision ne fait que l'affichage.
//
// Les règles métier ne sont pas ici : elles sont dans le validateur de
// l'import (valideTrains), que validationEdition() réutilise tel quel — une
// grille corrigée à la main obéit exactement aux mêmes contrôles qu'un
// fichier Excel chargé. Une correction crée toujours une NOUVELLE version
// (versionCorrigee) : une version n'est jamais réécrite.
import type { Indicateur } from './ecarts-grille';
import { heureVersSecondes } from './horaires';
import {
  interpreteHeure,
  normaliseExtremites,
  valideTrains,
  versionDisponible,
  type Probleme,
} from './import-grille';
import { ORDRE_GARES } from './types';
import type { GareId, Grille, PassageGrille, Sens, TrainGrille } from './types';

export type ChampHeure = 'a' | 'd';

export interface CibleCellule {
  sens: Sens;
  numero: number;
  gare: GareId;
  champ: ChampHeure;
}

export type ResultatEdition = { ok: true; grille: Grille } | { ok: false; erreur: string };

function copie(g: Grille): Grille {
  return structuredClone(g);
}

function trains(g: Grille, sens: Sens): TrainGrille[] {
  return sens === 'montee' ? g.montees : g.descentes;
}

/** Gares dans l'ordre du parcours : du Fayet au sommet en montée, l'inverse en descente. */
export function garesDansLeSens(sens: Sens): GareId[] {
  return sens === 'montee' ? [...ORDRE_GARES] : [...ORDRE_GARES].reverse();
}

/** Point de départ imposé par la ligne : Le Fayet en montée, le Nid d'Aigle en descente. */
export function origineStructurelle(sens: Sens): GareId {
  return sens === 'montee' ? 'le-fayet' : 'nid-daigle';
}

/** Terminus imposé par la ligne : le Nid d'Aigle en montée, Le Fayet en descente. */
export function terminusStructurel(sens: Sens): GareId {
  return sens === 'montee' ? 'nid-daigle' : 'le-fayet';
}

function trieDansLeSens(train: TrainGrille, sens: Sens): void {
  const ordre = garesDansLeSens(sens);
  train.passages.sort((x, y) => ordre.indexOf(x.gare) - ordre.indexOf(y.gare));
}

const FORMATS = 'formats acceptés : 7:26, 07:26:30, 7h26';

/**
 * Pose (ou retire, saisie vide ou tiret) l'heure d'une cellule. Mêmes formats
 * qu'à l'import. Une gare sans passage en gagne un ; une gare dont les deux
 * heures sont retirées perd son passage, et les extrémités sont remises
 * d'équerre (pas de départ au terminus, pas d'arrivée à l'origine).
 */
export function poseHeure(g: Grille, cible: CibleCellule, saisie: string): ResultatEdition {
  const lue = interpreteHeure(saisie.trim() === '' ? null : saisie);
  if (lue.type === 'invalide') {
    return { ok: false, erreur: `« ${lue.brut} » n'est pas une heure — ${FORMATS}` };
  }
  const grille = copie(g);
  const train = trains(grille, cible.sens).find((t) => t.numero === cible.numero);
  if (!train) return { ok: false, erreur: `TRAIN ${cible.numero} introuvable` };

  let passage = train.passages.find((p) => p.gare === cible.gare);
  if (lue.type === 'heure') {
    if (!passage) {
      passage = { gare: cible.gare };
      train.passages.push(passage);
      trieDansLeSens(train, cible.sens);
    }
    passage[cible.champ] = lue.texte;
  } else if (passage) {
    delete passage[cible.champ];
    if (passage.a === undefined && passage.d === undefined) {
      train.passages = train.passages.filter((p) => p !== passage);
    }
  }
  normaliseExtremites(train.passages);
  return { ok: true, grille };
}

/**
 * Coche ou décoche express / facultatif / vélos. Un train passé EXPRESS perd
 * ses passages à Col de Voza et Bellevue ; dans l'autre sens, les cellules
 * réapparaissent vides, à remplir (le validateur les réclame).
 */
export function poseIndicateur(
  g: Grille,
  sens: Sens,
  numero: number,
  champ: Indicateur,
  valeur: boolean,
): Grille {
  const grille = copie(g);
  const train = trains(grille, sens).find((t) => t.numero === numero);
  if (!train) return grille;
  train[champ] = valeur;
  if (champ === 'express' && valeur) {
    train.passages = train.passages.filter(
      (p) => p.gare !== 'col-de-voza' && p.gare !== 'bellevue',
    );
  }
  return grille;
}

/** Premier numéro de montée libre après la dernière : 27 après 25, 1 sur une grille vide. */
export function numeroMonteeSuivant(g: Grille): number {
  const numeros = [...g.montees.map((m) => m.numero), ...g.descentes.map((d) => d.numero - 1)];
  const max = Math.max(0, ...numeros);
  if (max === 0) return 1;
  return max % 2 === 1 ? max + 2 : max + 1;
}

function premiereHeure(train: TrainGrille): string | null {
  const p = train.passages[0];
  return p?.d ?? p?.a ?? null;
}

const deux = (n: number): string => String(n).padStart(2, '0');

function decaleHeure(h: string, decalageS: number): string | null {
  const s = heureVersSecondes(h) + decalageS;
  if (s < 0 || s >= 86400) return null;
  return `${deux(Math.floor(s / 3600))}:${deux(Math.floor((s % 3600) / 60))}:${deux(s % 60)}`;
}

function decaleTrain(modele: TrainGrille, numero: number, decalageS: number): TrainGrille | null {
  const passages: PassageGrille[] = [];
  for (const p of modele.passages) {
    const passage: PassageGrille = { gare: p.gare };
    for (const champ of ['a', 'd'] as const) {
      const h = p[champ];
      if (h === undefined) continue;
      const d = decaleHeure(h, decalageS);
      if (d === null) return null;
      passage[champ] = d;
    }
    passages.push(passage);
  }
  return {
    numero,
    express: modele.express,
    facultatif: modele.facultatif,
    velos: modele.velos,
    passages,
  };
}

export interface OptionsRotation {
  /** Heure de départ du Fayet de la nouvelle montée (« HH:MM » ou « HH:MM:SS »). */
  departMontee?: string;
  /** À défaut : décalage en minutes par rapport à la rotation modèle (+60 après la dernière). */
  decalageMin?: number;
}

/**
 * Ajoute une rotation complète — montée `numeroMontee` (impair) et descente
 * `numeroMontee + 1` — pré-remplie par décalage depuis la rotation voisine
 * (la montée précédente par numéro, sinon la suivante) : mêmes gares, mêmes
 * arrêts, mêmes indicateurs, heures décalées. Tout reste modifiable ensuite.
 */
export function ajouteRotation(
  g: Grille,
  numeroMontee: number,
  options: OptionsRotation = {},
): ResultatEdition {
  if (!Number.isInteger(numeroMontee) || numeroMontee < 1 || numeroMontee % 2 === 0) {
    return {
      ok: false,
      erreur: `Une montée porte un numéro impair (1, 3, 5…) : « ${numeroMontee} » n'en est pas un`,
    };
  }
  const numeroDescente = numeroMontee + 1;
  if (
    g.montees.some((m) => m.numero === numeroMontee) ||
    g.descentes.some((d) => d.numero === numeroDescente)
  ) {
    return {
      ok: false,
      erreur: `TRAIN ${numeroMontee} ou TRAIN ${numeroDescente} existe déjà dans cette grille`,
    };
  }
  const grille = copie(g);
  const precedente = [...grille.montees]
    .filter((m) => m.numero < numeroMontee)
    .sort((x, y) => y.numero - x.numero)[0];
  const suivante = [...grille.montees]
    .filter((m) => m.numero > numeroMontee)
    .sort((x, y) => x.numero - y.numero)[0];
  const modele = precedente ?? suivante;

  let montee: TrainGrille;
  let descente: TrainGrille;
  if (!modele) {
    // Grille vide : une rotation squelette, sans heures — tout est à saisir.
    montee = {
      numero: numeroMontee,
      express: false,
      facultatif: false,
      velos: false,
      passages: [],
    };
    descente = {
      numero: numeroDescente,
      express: false,
      facultatif: false,
      velos: false,
      passages: [],
    };
  } else {
    const depart = premiereHeure(modele);
    let decalageS: number;
    if (options.departMontee !== undefined && depart !== null) {
      const lue = interpreteHeure(options.departMontee);
      if (lue.type !== 'heure') {
        return {
          ok: false,
          erreur: `« ${options.departMontee} » n'est pas une heure — ${FORMATS}`,
        };
      }
      decalageS = lue.s - heureVersSecondes(depart);
    } else {
      decalageS = (options.decalageMin ?? (precedente ? 60 : -60)) * 60;
    }
    const nouvelleMontee = decaleTrain(modele, numeroMontee, decalageS);
    const modeleDescente = grille.descentes.find((d) => d.numero === modele.numero + 1);
    const nouvelleDescente = modeleDescente
      ? decaleTrain(modeleDescente, numeroDescente, decalageS)
      : { numero: numeroDescente, express: false, facultatif: false, velos: false, passages: [] };
    if (!nouvelleMontee || !nouvelleDescente) {
      return {
        ok: false,
        erreur: `Impossible de décaler la rotation modèle (TRAIN ${modele.numero}) : une heure sortirait de la journée`,
      };
    }
    montee = nouvelleMontee;
    descente = nouvelleDescente;
  }
  grille.montees.push(montee);
  grille.descentes.push(descente);
  grille.montees.sort((x, y) => x.numero - y.numero);
  grille.descentes.sort((x, y) => x.numero - y.numero);
  return { ok: true, grille };
}

/** Retire la rotation entière : montée `numeroMontee` et descente `numeroMontee + 1`. */
export function supprimeRotation(g: Grille, numeroMontee: number): Grille {
  const grille = copie(g);
  grille.montees = grille.montees.filter((m) => m.numero !== numeroMontee);
  grille.descentes = grille.descentes.filter((d) => d.numero !== numeroMontee + 1);
  return grille;
}

/** La grille se termine-t-elle à Bellevue (hiver) : aucun train ne passe au Nid d'Aigle ? */
export function seTermineABellevue(g: Grille): boolean {
  const tous = [...g.montees, ...g.descentes];
  return tous.length > 0 && tous.every((t) => t.passages.every((p) => p.gare !== 'nid-daigle'));
}

/**
 * Grille d'hiver : retire tout passage au Nid d'Aigle ; Bellevue devient le
 * terminus (les montées y arrivent sans repartir, les descentes en partent
 * sans y arriver). Les express, qui n'existent qu'avec le Nid d'Aigle, sont
 * ensuite signalés par le validateur : à retirer ou à requalifier.
 */
export function retireNidDaigle(g: Grille): Grille {
  const grille = copie(g);
  for (const sens of ['montee', 'descente'] as const) {
    for (const train of trains(grille, sens)) {
      train.passages = train.passages.filter((p) => p.gare !== 'nid-daigle');
      normaliseExtremites(train.passages);
    }
  }
  return grille;
}

export interface ValidationEdition {
  erreurs: Probleme[];
  avertissements: Probleme[];
}

/**
 * Le validateur de l'import, ni plus ni moins (aucune règle dupliquée), plus
 * le cas d'une grille sans aucun train.
 */
export function validationEdition(g: Grille): ValidationEdition {
  const erreurs: Probleme[] = [];
  const avertissements: Probleme[] = [];
  if (g.montees.length === 0 && g.descentes.length === 0) {
    erreurs.push({ niveau: 'erreur', message: 'La grille ne contient aucun train.' });
  }
  valideTrains('', g.montees, g.descentes, erreurs, avertissements);
  return { erreurs, avertissements };
}

/**
 * Identifiant de la version corrigée : la racine de la version d'origine
 * (sans son suffixe -vN) suivie du premier suffixe libre — corriger
 * « 2026-ete-petit-service-v2 » donne « 2026-ete-petit-service-v3 ».
 */
export function versionCorrigee(version: string, existantes: readonly string[]): string {
  const racine = version.replace(/-v\d+$/, '');
  return versionDisponible(racine, [...existantes, racine]);
}
