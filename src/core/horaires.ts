// Moteur horaires PUR : aucune E/S, aucun accès réseau, aucun Date.now().
// L'heure courante est TOUJOURS injectée (en secondes depuis minuit) pour
// permettre l'heure simulée ?simule=HH:MM et des tests déterministes.

import type {
  Circulation,
  CompteARebours,
  FinDeService,
  GareId,
  Grille,
  Jour,
  PassageGare,
  PassageTrain,
  PositionTrain,
  ProchaineArrivee,
  ResultatTerminusBellevue,
  TrainGrille,
  TrainJour,
} from './types';

/** Rames par défaut à la génération d'un jour (modifiables dans Paramètres → Machines). */
export const RAMES_DEFAUT = ['Marie', 'Anne', 'Jeanne', 'Marguerite'];

/** Ligne retirée de l'écran 2 minutes après le départ réel. */
const RETRAIT_APRES_DEPART_S = 120;

/** « < 1 min » clignotant de T − 1 min au départ (puis « À QUAI » jusqu'au retrait). */
const SEUIL_A_QUAI_S = 60;

// ---------------------------------------------------------------------------
// Heures et dates
// ---------------------------------------------------------------------------

/** « HH:MM » ou « HH:MM:SS » → secondes depuis minuit. */
export function heureVersSecondes(heure: string): number {
  const [hh = '0', mm = '0', ss = '0'] = heure.split(':');
  return Number(hh) * 3600 + Number(mm) * 60 + Number(ss);
}

/**
 * Secondes depuis minuit → « HH:MM » (secondes tronquées à l'affichage,
 * conservées dans les calculs) ; null → « — ».
 */
export function formatHeure(secondes: number | null): string {
  if (secondes === null) return '—';
  const s = ((secondes % 86400) + 86400) % 86400;
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** « YYYY-MM-DD » → date du lendemain (calcul en UTC : déterministe, sans fuseau). */
export function dateSuivante(date: string): string {
  const [annee = 0, mois = 1, jour = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(annee, mois - 1, jour + 1)).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Service actif et génération du jour
// ---------------------------------------------------------------------------

/** Grille dont une période couvre la date (bornes incluses), ou null hors saison. */
export function serviceActif(grilles: Grille[], date: string): Grille | null {
  for (const grille of grilles) {
    for (const periode of grille.periodes) {
      if (date >= periode.du && date <= periode.au) return grille;
    }
  }
  return null;
}

/**
 * Circulations par défaut d'une date : rames attribuées en cycle sur les
 * montées, héritées par la descente appariée (rotation), facultatifs non
 * activés, tout le monde à l'heure, terminus Nid d'Aigle.
 */
export function generationJour(grille: Grille, date: string, rames: string[] = RAMES_DEFAUT): Jour {
  const circulations: Circulation[] = [];

  grille.montees.forEach((train, index) => {
    circulations.push({
      date,
      numero: train.numero,
      sens: 'montee',
      express: train.express,
      facultatif: train.facultatif,
      facultatif_actif: false,
      velos: train.velos,
      rame: rames[index % rames.length] ?? '',
      terminus: 'nid-daigle',
      statut: 'ok',
      retard_min: 0,
      motif: null,
    });
  });

  for (const train of grille.descentes) {
    const monteeAppariee = circulations.find((c) => c.numero === train.numero - 1);
    circulations.push({
      date,
      numero: train.numero,
      sens: 'descente',
      express: train.express,
      facultatif: train.facultatif,
      facultatif_actif: false,
      velos: train.velos,
      rame: monteeAppariee?.rame ?? rames[0] ?? '',
      terminus: 'nid-daigle',
      statut: 'ok',
      retard_min: 0,
      motif: null,
    });
  }

  circulations.sort((a, b) => a.numero - b.numero);
  return { date, grille_version: grille.version, terminus_bellevue: false, circulations };
}

// ---------------------------------------------------------------------------
// Trains effectifs du jour (fusion grille + circulations)
// ---------------------------------------------------------------------------

/** Décalage réel appliqué aux heures théoriques (un supprimé reste aux heures théoriques). */
function decalageSecondes(train: { statut: string; retard_min: number }): number {
  return train.statut === 'retard' ? train.retard_min * 60 : 0;
}

/** Résout les passages théoriques : arrivée intermédiaire = départ − arret_intermediaire_s. */
function resoudPassages(train: TrainGrille, arretIntermediaireS: number): PassageTrain[] {
  return train.passages.map((passage, index) => {
    const depart = passage.d !== undefined ? heureVersSecondes(passage.d) : null;
    let arrivee: number | null = null;
    if (passage.a !== undefined) {
      arrivee = heureVersSecondes(passage.a);
    } else if (index > 0 && depart !== null) {
      arrivee = depart - arretIntermediaireS;
    }
    // index 0 : point d'origine → arrivée « — »
    return { gare: passage.gare, arrivee_s: arrivee, depart_s: depart };
  });
}

/** Montée limitée à Bellevue : passages tronqués, Bellevue devient le terminus (arrivée seule). */
function tronqueMonteeABellevue(train: TrainJour): TrainJour {
  const index = train.passages.findIndex((p) => p.gare === 'bellevue');
  if (index < 0) return train; // express : pas de passage à Bellevue, inapplicable
  const passages = train.passages
    .slice(0, index + 1)
    .map((p, i, liste) => (i === liste.length - 1 ? { ...p, depart_s: null } : p));
  return { ...train, passages, terminusExceptionnel: true };
}

/** Descente partant de Bellevue : le tronçon Nid d'Aigle → Bellevue est retiré. */
function descenteDepuisBellevue(train: TrainJour): TrainJour {
  const index = train.passages.findIndex((p) => p.gare === 'bellevue');
  if (index <= 0) return train;
  const passages = train.passages
    .slice(index)
    .map((p, i) => (i === 0 ? { ...p, arrivee_s: null } : p));
  return { ...train, passages, terminusExceptionnel: true };
}

/**
 * Bascule « Terminus Bellevue à partir du TRAIN N » (correctif exploitant du
 * 24/08/2026) : PRÉ-REMPLIT la colonne Terminus des rotations dont la montée
 * porte un numéro ≥ N — la colonne reste prioritaire et ajustable ensuite.
 * N est un numéro de MONTÉE ; un numéro PAIR est normalisé vers la montée de
 * sa rotation (N − 1). « Toute la journée » ≡ N = 1 (régime hiver permanent).
 * Les express de la plage ne sont JAMAIS limités automatiquement : ils sont
 * renvoyés dans `aTraiter` (suppression ou requalification manuelle en
 * supervision, outillée à l'étape 6). Fonction pure : le jour fourni n'est
 * pas modifié.
 */
export function appliqueTerminusBellevue(
  grille: Grille,
  jour: Jour,
  aPartirDuTrain: number,
): ResultatTerminusBellevue {
  // Pair → montée de la rotation (N − 1) ; borné à 1 pour garder un numéro de
  // montée valide dans le drapeau persisté (N ≤ 0 ≡ journée entière).
  const impair = aPartirDuTrain % 2 === 0 ? aPartirDuTrain - 1 : aPartirDuTrain;
  const seuil = Math.max(1, impair);

  const circulations = jour.circulations.map((c) =>
    c.sens === 'montee' && c.numero >= seuil ? { ...c, terminus: 'bellevue' as const } : c,
  );
  const nouveauJour: Jour = {
    ...jour,
    terminus_bellevue: { a_partir_du_train: seuil },
    circulations,
  };
  return { jour: nouveauJour, aTraiter: expressATraiter(grille, nouveauJour) };
}

/**
 * Rotations express « à traiter » en supervision : montées express (grille)
 * dont la colonne Terminus est sur Bellevue (posée par la bascule) et qui ne
 * sont pas supprimées. L'express circule normalement en attendant, mais sa
 * descente appariée non express part, elle, de Bellevue.
 */
export function expressATraiter(grille: Grille, jour: Jour): number[] {
  const numeros: number[] = [];
  for (const montee of grille.montees) {
    if (!montee.express) continue;
    const circulation = jour.circulations.find(
      (c) => c.numero === montee.numero && c.sens === 'montee',
    );
    if (circulation?.terminus === 'bellevue' && circulation.statut !== 'supprime') {
      numeros.push(montee.numero);
    }
  }
  return numeros;
}

/**
 * Trains effectivement en circulation ce jour : jointure grille + circulations,
 * facultatifs non activés retirés, rame de la descente héritée de la montée
 * appariée (rotation), limitations à Bellevue dérivées de la colonne Terminus
 * (seule source de vérité — la bascule de plage ne fait que la pré-remplir).
 */
export function trainsDuJour(grille: Grille, jour: Jour): TrainJour[] {
  const circulationParNumero = new Map(jour.circulations.map((c) => [c.numero, c]));
  const monteeGrilleParNumero = new Map(grille.montees.map((m) => [m.numero, m]));

  const trains: TrainJour[] = [];
  const listes: Array<['montee' | 'descente', TrainGrille[]]> = [
    ['montee', grille.montees],
    ['descente', grille.descentes],
  ];

  for (const [sens, liste] of listes) {
    for (const trainGrille of liste) {
      const circulation = circulationParNumero.get(trainGrille.numero);
      if (trainGrille.facultatif && !(circulation?.facultatif_actif ?? false)) continue;

      let rame = circulation?.rame ?? '';
      if (sens === 'descente') {
        // Rotation : la rame se choisit sur la montée, la descente appariée hérite.
        const monteeAppariee = circulationParNumero.get(trainGrille.numero - 1);
        if (monteeAppariee) rame = monteeAppariee.rame;
      }

      trains.push({
        numero: trainGrille.numero,
        sens,
        express: trainGrille.express,
        facultatif: trainGrille.facultatif,
        velos: trainGrille.velos,
        rame,
        statut: circulation?.statut ?? 'ok',
        retard_min: circulation?.statut === 'retard' ? circulation.retard_min : 0,
        motif: circulation?.motif ?? null,
        terminusExceptionnel: false,
        passages: resoudPassages(trainGrille, grille.arret_intermediaire_s),
      });
    }
  }

  // Rotation limitée = colonne Terminus de la montée sur Bellevue. La descente
  // appariée part alors de Bellevue, y compris quand la montée est un express
  // « à traiter » (qui, lui, n'est JAMAIS tronqué : il ne dessert pas Bellevue).
  const rotationLimitee = (numeroMontee: number): boolean => {
    const circulation = circulationParNumero.get(numeroMontee);
    return circulation?.sens === 'montee' && circulation.terminus === 'bellevue';
  };
  const monteeTronquee = (numeroMontee: number): boolean =>
    rotationLimitee(numeroMontee) && !monteeGrilleParNumero.get(numeroMontee)?.express;

  return trains.map((train) => {
    if (train.sens === 'montee' && monteeTronquee(train.numero)) {
      return tronqueMonteeABellevue(train);
    }
    if (train.sens === 'descente' && rotationLimitee(train.numero - 1)) {
      return descenteDepuisBellevue(train);
    }
    return train;
  });
}

// ---------------------------------------------------------------------------
// Passages pour une gare (écran de gare)
// ---------------------------------------------------------------------------

/**
 * Passages du jour à une gare, triés par heure de départ, deux sens mélangés.
 * Sans `maintenant_s` : la journée complète. Avec : les lignes encore
 * affichables — retirées 2 min après le départ réel, et dès l'heure théorique
 * pour un supprimé (affiché barré jusque-là).
 */
export function passagesPourGare(
  grille: Grille,
  jour: Jour,
  gare: GareId,
  maintenant_s?: number,
): PassageGare[] {
  const passages: PassageGare[] = [];

  for (const train of trainsDuJour(grille, jour)) {
    const passage = train.passages.find((p) => p.gare === gare);
    if (!passage) continue; // express à Voza/Bellevue, tronçon retiré… : rien à afficher

    const premier = train.passages[0];
    const dernier = train.passages[train.passages.length - 1];
    if (!premier || !dernier) continue;

    const decalage = decalageSecondes(train);
    passages.push({
      numero: train.numero,
      sens: train.sens,
      express: train.express,
      velos: train.velos,
      rame: train.rame,
      statut: train.statut,
      retard_min: train.retard_min,
      motif: train.motif,
      origine: premier.gare,
      destination: dernier.gare,
      terminusExceptionnel: train.terminusExceptionnel,
      arrivee_s: passage.arrivee_s === null ? null : passage.arrivee_s + decalage,
      depart_s: passage.depart_s === null ? null : passage.depart_s + decalage,
      arrivee_theorique_s: passage.arrivee_s,
      depart_theorique_s: passage.depart_s,
    });
  }

  passages.sort((a, b) => (a.depart_s ?? a.arrivee_s ?? 0) - (b.depart_s ?? b.arrivee_s ?? 0));

  if (maintenant_s === undefined) return passages;

  return passages.filter((p) => {
    if (p.statut === 'supprime') {
      // Affiché barré avec motif jusqu'à son heure théorique, puis disparaît.
      const reference = p.depart_theorique_s ?? p.arrivee_theorique_s;
      return reference !== null && maintenant_s < reference;
    }
    const reference = p.depart_s ?? p.arrivee_s;
    return reference !== null && maintenant_s <= reference + RETRAIT_APRES_DEPART_S;
  });
}

// ---------------------------------------------------------------------------
// Prochaine arrivée, compte à rebours, fin de service, positions
// ---------------------------------------------------------------------------

/** Prochain train arrivant à la gare (« HH:MM — Rame (train n° X), en provenance de … »). */
export function prochaineArrivee(
  grille: Grille,
  jour: Jour,
  gare: GareId,
  maintenant_s: number,
): ProchaineArrivee | null {
  let prochaine: PassageGare | null = null;
  for (const passage of passagesPourGare(grille, jour, gare)) {
    if (passage.statut === 'supprime') continue;
    if (passage.arrivee_s === null || passage.arrivee_s < maintenant_s) continue;
    if (prochaine === null || passage.arrivee_s < (prochaine.arrivee_s ?? Infinity)) {
      prochaine = passage;
    }
  }
  if (prochaine === null || prochaine.arrivee_s === null) return null;
  return {
    heure_s: prochaine.arrivee_s,
    numero: prochaine.numero,
    rame: prochaine.rame,
    sens: prochaine.sens,
    provenance: prochaine.origine,
  };
}

/**
 * Compte à rebours avant départ (rendu de la maquette validée) : « n min »,
 * « n h mm » si ≥ 60 min, « < 1 min » clignotant de T − 1 min au départ,
 * puis « À QUAI » clignotant jusqu'au retrait de la ligne.
 */
export function compteARebours(depart_s: number, maintenant_s: number): CompteARebours {
  const restant = depart_s - maintenant_s;
  if (restant <= 0) {
    return { type: 'quai', libelle: 'À QUAI' };
  }
  if (restant < SEUIL_A_QUAI_S) {
    return { type: 'imminent', libelle: '< 1 min' };
  }
  const minutes = Math.ceil(restant / 60);
  if (minutes >= 60) {
    const heures = Math.floor(minutes / 60);
    const reste = minutes % 60;
    return {
      type: 'heures',
      heures,
      minutes: reste,
      libelle: `${heures} h ${String(reste).padStart(2, '0')}`,
    };
  }
  return { type: 'minutes', minutes, libelle: `${minutes} min` };
}

/**
 * Fin de service à une gare : null tant qu'il reste des DÉPARTS affichables
 * (le tableau n'affiche que des départs — les arrivées restantes continuent
 * d'alimenter la ligne « prochaine arrivée », cf. maquette) ; sinon, premier
 * départ du LENDEMAIN à cette gare (lu dans la grille du lendemain — null si
 * pas de service demain, ex. fin de saison).
 */
export function finDeService(
  grille: Grille,
  jour: Jour,
  gare: GareId,
  maintenant_s: number,
  grilleDemain: Grille | null,
  jourDemain?: Jour,
): FinDeService | null {
  const restants = passagesPourGare(grille, jour, gare, maintenant_s).filter(
    (p) => p.depart_s !== null,
  );
  if (restants.length > 0) return null;

  if (grilleDemain === null) return { premierDepart_s: null };
  const demain = jourDemain ?? generationJour(grilleDemain, dateSuivante(jour.date));

  let premier: number | null = null;
  for (const passage of passagesPourGare(grilleDemain, demain, gare)) {
    if (passage.statut === 'supprime' || passage.depart_s === null) continue;
    if (premier === null || passage.depart_s < premier) premier = passage.depart_s;
  }
  return { premierDepart_s: premier };
}

/**
 * Trains en ligne à l'instant donné, avec leur dernier point de passage
 * (point pulsant couleur rame sur la grille du jour).
 */
export function positionsTrains(grille: Grille, jour: Jour, maintenant_s: number): PositionTrain[] {
  const positions: PositionTrain[] = [];

  for (const train of trainsDuJour(grille, jour)) {
    if (train.statut === 'supprime') continue;
    const premier = train.passages[0];
    const dernier = train.passages[train.passages.length - 1];
    if (!premier || !dernier) continue;

    const decalage = decalageSecondes(train);
    const departOrigine = premier.depart_s ?? premier.arrivee_s;
    const arriveeTerminus = dernier.arrivee_s ?? dernier.depart_s;
    if (departOrigine === null || arriveeTerminus === null) continue;
    if (maintenant_s < departOrigine + decalage || maintenant_s > arriveeTerminus + decalage) {
      continue;
    }

    // Dernier point de passage : dernière gare atteinte (arrivée réelle ≤ maintenant).
    let gare = premier.gare;
    for (const passage of train.passages) {
      const atteinte = passage.arrivee_s ?? passage.depart_s;
      if (atteinte === null) continue;
      if (atteinte + decalage <= maintenant_s) gare = passage.gare;
      else break;
    }
    positions.push({ numero: train.numero, sens: train.sens, rame: train.rame, gare });
  }

  return positions;
}

/**
 * État « tronçon Bellevue – Nid d'Aigle fermé » de l'écran du Nid d'Aigle :
 * bascule Terminus Bellevue enregistrée sur le jour ET plus aucun passage à
 * afficher (les rotations non limitées et les express « à traiter » restent
 * affichés jusqu'à leur dernier passage — l'information prime).
 */
export function etatTronconFerme(
  grille: Grille,
  jour: Jour,
  gare: GareId,
  maintenant_s: number,
): boolean {
  if (gare !== 'nid-daigle') return false;
  if (jour.terminus_bellevue === false) return false;
  return passagesPourGare(grille, jour, gare, maintenant_s).length === 0;
}
