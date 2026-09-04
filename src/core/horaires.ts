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
  SectionJour,
  TrainGrille,
  TrainJour,
  VeilleNuit,
} from './types';
import { GARE_DEBUT_DEFAUT, GARE_FIN_DEFAUT, ORDRE_GARES } from './types';

/** Rames par défaut à la génération d'un jour (modifiables dans Paramètres → Machines). */
export const RAMES_DEFAUT = ['Marie', 'Anne', 'Jeanne', 'Marguerite'];

/** Ligne retirée de l'écran 2 minutes après le départ réel. */
const RETRAIT_APRES_DEPART_S = 120;

/** « < 1 min » clignotant de T − 1 min au départ (puis « À QUAI » jusqu'au retrait). */
/** Bascule « DÉPART IMMINENT » : dernières secondes avant le départ. */
export const SEUIL_IMMINENT_S = 30;

/**
 * Gare d'ORIGINE (aucune heure d'arrivée) : délai par défaut pendant lequel
 * la rame est considérée à quai avant son départ. Surchargeable par le
 * paramètre `a_quai_origine_s`.
 */
export const A_QUAI_ORIGINE_DEFAUT_S = 300;

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

/** « YYYY-MM-DD » → date de la veille (même calcul UTC). */
export function datePrecedente(date: string): string {
  const [annee = 0, mois = 1, jour = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(annee, mois - 1, jour - 1)).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Service actif et génération du jour
// ---------------------------------------------------------------------------

/**
 * Grille en vigueur à une date. Règle, écrite noir sur blanc (docs/01 §2.1) :
 *
 * 1. seules les grilles ACTIVES comptent (`actif` absent ou true) ;
 * 2. une grille ne s'applique qu'à ses périodes (bornes incluses) ;
 * 3. si plusieurs grilles actives couvrent la date, la plus RÉCEMMENT créée
 *    (`cree_le`) l'emporte — importer une grille corrigée suffit à la faire
 *    appliquer, et la désactiver redonne la main à la précédente (retour
 *    arrière) ;
 * 4. à égalité (fichiers JSON sans `cree_le`), la première de la liste.
 *
 * Hors saison : null — JAMAIS de repli sur une autre grille (bug exploitant
 * du 25/08/2026 : le petit service s'affichait en plein hiver).
 */
export function serviceActif(grilles: Grille[], date: string): Grille | null {
  let retenue: Grille | null = null;
  for (const grille of grilles) {
    if (grille.actif === false) continue;
    if (!grille.periodes.some((p) => date >= p.du && date <= p.au)) continue;
    if (retenue === null || (grille.cree_le ?? '') > (retenue.cree_le ?? '')) retenue = grille;
  }
  return retenue;
}

/**
 * Grille à utiliser pour AFFICHER une journée : celle qui a servi à la
 * générer (`jour.grille_version`) si elle est encore disponible, sinon celle
 * en vigueur à sa date. Jamais « la première de la liste » : avec des grilles
 * en base, ce repli aurait pu montrer le petit service un jour de grand
 * service dès qu'une version était désactivée.
 */
export function grillePourJour(grilles: Grille[], jour: Jour): Grille | null {
  return grilles.find((g) => g.version === jour.grille_version) ?? serviceActif(grilles, jour.date);
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
      sans_voyageurs: false,
      supplementaire: false,
      passages: null,
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
      sans_voyageurs: false,
      supplementaire: false,
      passages: null,
    });
  }

  circulations.sort((a, b) => a.numero - b.numero);
  return {
    date,
    grille_version: grille.version,
    terminus_bellevue: false,
    // Ligne complète par défaut ; une restriction se saisit en supervision et
    // se reporte de la veille (voir `sectionReportee()`).
    gare_debut: GARE_DEBUT_DEFAUT,
    gare_fin: GARE_FIN_DEFAUT,
    message_troncon_fr: null,
    message_troncon_en: null,
    circulations,
  };
}

// ---------------------------------------------------------------------------
// Trains effectifs du jour (fusion grille + circulations)
// ---------------------------------------------------------------------------

/** Décalage réel appliqué aux heures théoriques (un supprimé reste aux heures théoriques). */
function decalageSecondes(train: { statut: string; retard_min: number }): number {
  return train.statut === 'retard' ? train.retard_min * 60 : 0;
}

/**
 * Résout les passages théoriques : l'arrivée est l'heure RÉELLE du document
 * d'exploitation (`a`) ; à défaut, repli « départ − arret_intermediaire_s ».
 */
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

/**
 * SECTION EXPLOITÉE du jour, assainie. Les bornes peuvent venir d'un
 * instantané mis en cache AVANT le déploiement de la fonctionnalité, donc
 * être absentes, ou d'un jsonb quelconque, donc hors `ORDRE_GARES` : dans les
 * deux cas on retombe sur la ligne complète plutôt que de calculer sur un
 * index -1 qui viderait tous les écrans (leçon C-01).
 *
 * Une section inversée (debut après fin dans l'ordre de la ligne) est elle
 * aussi ramenée à la ligne complète : mieux vaut afficher trop que faire
 * disparaître un service qui circule.
 */
export function sectionDuJour(jour: Pick<Jour, 'gare_debut' | 'gare_fin'>): {
  debut: GareId;
  fin: GareId;
} {
  const valide = (g: unknown, defaut: GareId): GareId =>
    typeof g === 'string' && (ORDRE_GARES as readonly string[]).includes(g)
      ? (g as GareId)
      : defaut;
  const debut = valide(jour.gare_debut, GARE_DEBUT_DEFAUT);
  const fin = valide(jour.gare_fin, GARE_FIN_DEFAUT);
  if (ORDRE_GARES.indexOf(debut) >= ORDRE_GARES.indexOf(fin)) {
    return { debut: GARE_DEBUT_DEFAUT, fin: GARE_FIN_DEFAUT };
  }
  return { debut, fin };
}

/**
 * REPORT DE LA VEILLE — section à pré-remplir quand une journée est générée
 * pour la PREMIÈRE fois.
 *
 * Un chantier dure des semaines : sans ce report, la journée du lendemain
 * naîtrait sur la ligne complète et afficherait des trains qui ne circulent
 * pas. C'est l'erreur la plus grave que ce système puisse commettre — un
 * voyageur attendrait un train à une gare fermée. Le report est donc le
 * défaut, et il reste modifiable en supervision.
 *
 * Renvoie null quand il n'y a rien à reporter (pas de veille en base, ou
 * veille sur la ligne complète) : la journée prend alors ses défauts.
 */
export function sectionReportee(veille: Jour | null | undefined): SectionJour | null {
  if (!veille || sectionComplete(veille)) return null;
  const { debut, fin } = sectionDuJour(veille);
  return {
    gare_debut: debut,
    gare_fin: fin,
    message_troncon_fr: veille.message_troncon_fr ?? null,
    message_troncon_en: veille.message_troncon_en ?? null,
  };
}

/** La ligne est-elle exploitée en entier ce jour-là ? */
export function sectionComplete(jour: Pick<Jour, 'gare_debut' | 'gare_fin'>): boolean {
  const { debut, fin } = sectionDuJour(jour);
  return debut === GARE_DEBUT_DEFAUT && fin === GARE_FIN_DEFAUT;
}

/** Gare HORS de la section exploitée : son écran affiche « ligne fermée ». */
export function gareHorsSection(
  jour: Pick<Jour, 'gare_debut' | 'gare_fin'>,
  gare: GareId,
): boolean {
  const { debut, fin } = sectionDuJour(jour);
  const rang = ORDRE_GARES.indexOf(gare);
  return rang < ORDRE_GARES.indexOf(debut) || rang > ORDRE_GARES.indexOf(fin);
}

/**
 * TRONCATURE UNIQUE — seule fonction du moteur qui coupe un train hors de la
 * partie de ligne exploitée, dans les deux sens. « Terminus Bellevue » en est
 * un cas particulier (voir `tronqueABellevue()`) : il n'existe pas de second
 * mécanisme parallèle, deux sources de vérité pour la même idée étant
 * exactement ce qui a produit le bug des médias par-dessus un train à quai.
 *
 * INVARIANT : la section [`debut`, `fin`] est la borne EXTÉRIEURE. Cette
 * fonction ne fait que RETIRER des passages — elle n'en ajoute jamais. Un
 * train portant `terminus = 'nid-daigle'` dans une section qui s'arrête au
 * Col de Voza s'arrête donc au Col de Voza : la section gagne toujours,
 * quel que soit l'ordre des appels.
 *
 * Bornes absentes des passages (cas de l'EXPRESS, qui ne dessert ni Voza ni
 * Bellevue) : le train ne peut pas être tronqué proprement, on ne lui invente
 * pas un terminus. Il est renvoyé INCHANGÉ et remonte dans `aTraiter`
 * (`expressATraiter()`) pour suppression ou requalification manuelle.
 */
export function tronqueTrain(train: TrainJour, debut: GareId, fin: GareId): TrainJour {
  // Dans le sens de marche : une montée part de `debut` vers `fin`, une
  // descente l'inverse. Les bornes de la section sont les mêmes.
  const [origine, terminus] = train.sens === 'montee' ? [debut, fin] : [fin, debut];
  const iOrigine = train.passages.findIndex((p) => p.gare === origine);
  const iTerminus = train.passages.findIndex((p) => p.gare === terminus);
  if (iOrigine < 0 || iTerminus < 0 || iTerminus <= iOrigine) return train;
  const dernier = train.passages.length - 1;
  if (iOrigine === 0 && iTerminus === dernier) return train; // rien à couper

  const passages = train.passages.slice(iOrigine, iTerminus + 1).map((p, i, liste) => ({
    ...p,
    // « — » aux deux extrémités : le train n'arrive pas là où il commence,
    // et ne repart pas de là où il finit.
    arrivee_s: i === 0 ? null : p.arrivee_s,
    depart_s: i === liste.length - 1 ? null : p.depart_s,
  }));
  return {
    ...train,
    passages,
    // « Terminus exceptionnel » ne se dit que si le TERMINUS a bougé. Une
    // montée dont seule l'origine est déplacée (section [Voza, Nid d'Aigle])
    // va toujours au Nid d'Aigle : l'annoncer exceptionnel serait faux.
    terminusExceptionnel: train.terminusExceptionnel || iTerminus < dernier,
  };
}

/**
 * Rotation limitée à Bellevue : CAS PARTICULIER de `tronqueTrain()`, où
 * l'autre borne est l'extrémité que le train a déjà (la section du jour
 * s'étant appliquée avant). Montée : elle s'arrête à Bellevue. Descente : elle
 * en part.
 */
function tronqueABellevue(train: TrainJour): TrainJour {
  const premier = train.passages[0]?.gare;
  const dernier = train.passages[train.passages.length - 1]?.gare;
  if (!premier || !dernier) return train;
  return train.sens === 'montee'
    ? tronqueTrain(train, premier, 'bellevue')
    : tronqueTrain(train, dernier, 'bellevue');
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
 * Trains express « à traiter » en supervision : un express ne dessert pas
 * Bellevue, il ne peut donc être ni tronqué (montée) ni fait partir de
 * Bellevue (descente). Sont signalés, pour une rotation limitée (colonne
 * Terminus de la montée sur Bellevue) et non supprimés :
 * - la MONTÉE express elle-même ;
 * - sa DESCENTE appariée si elle est express aussi (T9→T10, T17→T18) : elle
 *   partirait du Nid d'Aigle alors que le tronçon supérieur est fermé.
 * Une descente NON express, elle, part normalement de Bellevue : rien à traiter.
 */
export function expressATraiter(grille: Grille, jour: Jour): number[] {
  const numeros: number[] = [];
  const limitee = (numeroMontee: number): boolean => {
    const c = jour.circulations.find((x) => x.numero === numeroMontee && x.sens === 'montee');
    return c?.terminus === 'bellevue';
  };
  /** Circule vraiment : non supprimé, et facultatif seulement s'il est activé. */
  const circule = (numero: number): boolean => {
    const c = jour.circulations.find((x) => x.numero === numero);
    if (!c || c.statut === 'supprime') return false;
    return !c.facultatif || c.facultatif_actif;
  };

  for (const montee of grille.montees) {
    if (montee.express && limitee(montee.numero) && circule(montee.numero)) {
      numeros.push(montee.numero);
    }
  }
  for (const descente of grille.descentes) {
    if (descente.express && limitee(descente.numero - 1) && circule(descente.numero)) {
      numeros.push(descente.numero);
    }
  }
  return numeros.sort((a, b) => a - b);
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
      // Course à vide : elle existe pour l'exploitation, jamais pour les
      // voyageurs. L'exclure ICI la retire de TOUT ce qui est affiché
      // (départs, grille du jour, prochaine arrivée, position en ligne).
      if (circulation?.sans_voyageurs === true) continue;

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
        supplementaire: false,
        passages: resoudPassages(trainGrille, grille.arret_intermediaire_s),
      });
    }
  }

  // TRAINS SUPPLÉMENTAIRES : absents de toute grille, ils portent leurs
  // propres passages. Sans ce bloc ils seraient invisibles partout — la
  // boucle ci-dessus ne sait joindre que des trains de grille.
  for (const circulation of jour.circulations) {
    if (!circulation.supplementaire || !circulation.passages) continue;
    if (circulation.sans_voyageurs === true) continue; // course à vide : jamais affichée

    let rame = circulation.rame;
    if (circulation.sens === 'descente') {
      // Même règle que partout : la rame se choisit sur la montée (numéro
      // impair), la descente appariée (numéro + 1) en hérite.
      const monteeAppariee = circulationParNumero.get(circulation.numero - 1);
      if (monteeAppariee) rame = monteeAppariee.rame;
    }

    trains.push({
      numero: circulation.numero,
      sens: circulation.sens,
      // « express » désigne le train qui saute Voza et Bellevue, avec son
      // picto motrice : un train sup n'en est pas un, même s'il saute des
      // gares. Sa mention à lui est « SANS ARRÊT » (docs/01 §2.7).
      express: false,
      facultatif: false,
      velos: false,
      rame,
      statut: circulation.statut,
      retard_min: circulation.statut === 'retard' ? circulation.retard_min : 0,
      motif: circulation.motif,
      terminusExceptionnel: false,
      supplementaire: true,
      passages: resoudPassages(
        {
          numero: circulation.numero,
          express: false,
          facultatif: false,
          velos: false,
          passages: circulation.passages,
        },
        grille.arret_intermediaire_s,
      ),
    });
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

  // La SECTION du jour s'applique à TOUS les trains, trains supplémentaires
  // compris, AVANT la logique de terminus par train : elle est la borne
  // extérieure, et la colonne Terminus ne peut ensuite que réduire davantage.
  const { debut, fin } = sectionDuJour(jour);
  return trains.map((train) => {
    const dansLaSection = tronqueTrain(train, debut, fin);
    if (dansLaSection.sens === 'montee' && monteeTronquee(dansLaSection.numero)) {
      return tronqueABellevue(dansLaSection);
    }
    if (dansLaSection.sens === 'descente' && rotationLimitee(dansLaSection.numero - 1)) {
      return tronqueABellevue(dansLaSection);
    }
    return dansLaSection;
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
/**
 * Montées ouvertes aux voyageurs qu'AUCUNE descente ouverte aux voyageurs ne
 * suit dans la journée : on ferait monter des voyageurs sans train pour les
 * redescendre. « Ouvert aux voyageurs » = ni supprimé, ni facultatif non
 * activé, ni course à vide. « Ensuite » se juge sur l'horaire réel : la
 * descente doit partir au plus tôt à l'arrivée de la montée.
 *
 * Simple avertissement destiné à l'exploitation : cette fonction ne retire
 * jamais rien de l'affichage.
 */
export function monteesSansRetour(grille: Grille, jour: Jour): number[] {
  // On raisonne sur les trains TELS QU'ILS CIRCULENT (trainsDuJour applique
  // déjà les facultatifs non activés, les courses à vide et la troncature à
  // Bellevue) : comparer les heures brutes de la grille donnerait un faux
  // avertissement dès qu'une rotation est limitée à Bellevue.
  const circulants = trainsDuJour(grille, jour).filter((t) => t.statut !== 'supprime');
  const heureFin = (train: TrainJour): number | null => {
    const p = train.passages[train.passages.length - 1];
    return p ? (p.arrivee_s ?? p.depart_s) : null;
  };
  const heureDebut = (train: TrainJour): number | null => {
    const p = train.passages[0];
    return p ? (p.depart_s ?? p.arrivee_s) : null;
  };

  const departsDescentes = circulants
    .filter((t) => t.sens === 'descente')
    .map(heureDebut)
    .filter((s): s is number => s !== null);

  const sansRetour: number[] = [];
  for (const montee of circulants) {
    if (montee.sens !== 'montee') continue;
    const arrivee = heureFin(montee);
    if (arrivee === null) continue;
    if (!departsDescentes.some((depart) => depart >= arrivee)) sansRetour.push(montee.numero);
  }
  return sansRetour.sort((a, b) => a - b);
}
/**
 * Libellé d'un train, SOURCE UNIQUE pour l'écran de gare, la grille du jour
 * et la supervision — pour qu'ils ne divergent jamais.
 *
 *   train de grille                  → « TRAIN 9 »
 *   un seul train sup dans la journée → « TRAIN SUP »
 *   plusieurs                        → « TRAIN SUP 1 », « TRAIN SUP 2 »…
 *
 * Le rang d'un train sup suit l'ordre des NUMÉROS, pas l'ordre d'affichage :
 * il doit rester le même partout et d'un rafraîchissement à l'autre.
 */
export function libelleTrain(
  train: Pick<TrainJour, 'numero' | 'supplementaire'>,
  tousLesTrainsDuJour: Pick<TrainJour, 'numero' | 'supplementaire'>[],
): string {
  if (!train.supplementaire) return `TRAIN ${train.numero}`;
  const rang = rangSup(train, tousLesTrainsDuJour);
  return rang === null ? 'TRAIN SUP' : `TRAIN SUP ${rang}`;
}

/**
 * Écriture COMPACTE du même libellé, pour le badge de l'écran de gare :
 *
 *   train de grille                   → « T11 »
 *   un seul train sup dans la journée → « SUP »
 *   plusieurs                         → « SUP 1 », « SUP 2 »…
 *
 * Le libellé canonique reste `libelleTrain()` (« TRAIN 11 ») : supervision et
 * grille du jour ne s'écrivent pas autrement. Le rang, lui, est le MÊME —
 * les deux fonctions le tirent de `rangSup()`.
 */
export function libelleTrainCourt(
  train: Pick<TrainJour, 'numero' | 'supplementaire'>,
  tousLesTrainsDuJour: Pick<TrainJour, 'numero' | 'supplementaire'>[],
): string {
  if (!train.supplementaire) return `T${train.numero}`;
  const rang = rangSup(train, tousLesTrainsDuJour);
  return rang === null ? 'SUP' : `SUP ${rang}`;
}

/**
 * Rang d'une rotation supplémentaire dans la journée (1, 2, …), ou `null`
 * quand il n'y a rien à numéroter : une seule rotation sup, ou un train
 * absent de la liste.
 *
 * L'ordre suit les NUMÉROS, pas l'ordre d'affichage : le rang doit rester le
 * même partout et d'un rafraîchissement à l'autre.
 */
function rangSup(
  train: Pick<TrainJour, 'numero' | 'supplementaire'>,
  tousLesTrainsDuJour: Pick<TrainJour, 'numero' | 'supplementaire'>[],
): number | null {
  // Une rotation sup compte pour UN train : la montée (impair) et sa
  // descente (numéro + 1) portent le même rang.
  const rotation = (numero: number): number => (numero % 2 === 0 ? numero - 1 : numero);
  const rotations = [
    ...new Set(tousLesTrainsDuJour.filter((t) => t.supplementaire).map((t) => rotation(t.numero))),
  ].sort((a, b) => a - b);
  if (rotations.length <= 1) return null;
  const rang = rotations.indexOf(rotation(train.numero));
  return rang < 0 ? null : rang + 1;
}
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
      supplementaire: train.supplementaire,
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
/**
 * État de la case de compte à rebours pour un passage en gare.
 *
 * L'heure d'ARRIVÉE est décisive : sans elle, « À QUAI » ne pouvait
 * s'afficher qu'APRÈS le départ, c'est-à-dire trop tard pour être utile au
 * voyageur. Enchaînement :
 *   avant l’arrivée         → compte à rebours (« n min », « n h mm »)
 *   arrivée → D − 30 s      → À QUAI
 *   D − 30 s → départ       → DÉPART IMMINENT
 *   après le départ         → PARTI (le temps que la ligne reste affichée)
 *
 * En gare d'ORIGINE il n'y a pas d'arrivée : « À QUAI » commence
 * `aQuaiOrigine_s` avant le départ.
 *
 * Les heures passées ici sont les heures RÉELLES (retard inclus) : le
 * décalage est déjà appliqué par passagesPourGare.
 */
/**
 * Fenêtre de veille de nuit. Elle enjambe minuit dans le cas courant
 * (21:00 → 06:00) : le test doit alors être un OU, pas un ET.
 */
export function enVeille(debut: string, fin: string, maintenant_s: number): boolean {
  const d = heureVersSecondes(debut);
  const f = heureVersSecondes(fin);
  if (d === f) return false; // fenêtre vide : jamais en veille
  return d < f ? maintenant_s >= d && maintenant_s < f : maintenant_s >= d || maintenant_s < f;
}

/**
 * Veille applicable à un écran : la sienne si elle est renseignée, sinon
 * celle de la ligne. Les deux bornes doivent être présentes pour qu'une
 * surcharge compte — une seule heure ne décrit pas une fenêtre.
 */
export function veilleEffective(
  globale: VeilleNuit,
  propre?: { debut?: string | null; fin?: string | null } | null,
): { fenetre: VeilleNuit; propre: boolean } {
  if (propre?.debut && propre.fin) {
    return { fenetre: { debut: propre.debut, fin: propre.fin }, propre: true };
  }
  return { fenetre: globale, propre: false };
}

export function compteARebours(
  depart_s: number,
  maintenant_s: number,
  arrivee_s: number | null = null,
  aQuaiOrigine_s: number = A_QUAI_ORIGINE_DEFAUT_S,
): CompteARebours {
  const restant = depart_s - maintenant_s;
  // À l'instant exact du départ le train est encore « DÉPART IMMINENT » :
  // « PARTI » ne commence qu'APRÈS l'heure de départ.
  if (restant < 0) {
    return { type: 'parti', libelle: 'PARTI', libelle_en: 'DEPARTED' };
  }
  if (restant <= SEUIL_IMMINENT_S) {
    return { type: 'imminent', libelle: 'DÉPART IMMINENT', libelle_en: 'DEPARTING' };
  }
  // Début du stationnement à quai : l'arrivée réelle, ou — à l'origine — un
  // délai forfaitaire avant le départ.
  const debutQuai = arrivee_s ?? depart_s - Math.max(0, aQuaiOrigine_s);
  if (maintenant_s >= debutQuai) {
    return { type: 'quai', libelle: 'À QUAI', libelle_en: 'ARRIVED' };
  }
  // Le nombre affiché reste celui du DÉPART, cohérent avec l'heure de départ
  // imprimée juste à côté dans la ligne.
  const minutes = Math.ceil(restant / 60);
  if (minutes >= 60) {
    const heures = Math.floor(minutes / 60);
    const reste = minutes % 60;
    return {
      type: 'heures',
      heures,
      minutes: reste,
      libelle: `${heures} h ${String(reste).padStart(2, '0')}`,
      libelle_en: '',
    };
  }
  return { type: 'minutes', minutes, libelle: `${minutes} min`, libelle_en: '' };
}

/**
 * Fin de service à une gare : null tant qu'il reste des DÉPARTS affichables
 * (le tableau n'affiche que des départs — les arrivées restantes continuent
 * d'alimenter la ligne « prochaine arrivée », cf. maquette) ; sinon, premier
 * départ du LENDEMAIN à cette gare (lu dans la grille du lendemain — null si
 * pas de service demain, ex. fin de saison).
 */
/**
 * Un train occupe-t-il le quai ? Tant que c'est le cas, l'écran reste sur
 * les horaires : aucun média ne doit recouvrir l'information voyageur.
 *
 * SOURCE UNIQUE de la règle : la fonction appelle compteARebours(), la même
 * qui décide du libellé de la case. Le cycle médias avait sa propre règle
 * (« départ dans ≤ 2 min »), ce qui laissait passer les médias pendant les
 * arrêts longs : à Saint-Gervais, arrivée 09:10 et départ 09:15, l'écran
 * affichait « À QUAI » ET des médias de 09:10 à 09:13.
 *
 * @param preavis_s filet de sécurité pour un passage dont l’heure d’arrivée
                   est inconnue : on couvre malgré tout les dernières minutes.
 */
export function quaiOccupe(
  passages: PassageGare[],
  maintenant_s: number,
  aQuaiOrigine_s: number = A_QUAI_ORIGINE_DEFAUT_S,
  preavis_s = 120,
): boolean {
  return passages.some((p) => {
    if (p.statut === 'supprime' || p.depart_s === null) return false;
    const etat = compteARebours(p.depart_s, maintenant_s, p.arrivee_s, aQuaiOrigine_s);
    if (etat.type === 'quai' || etat.type === 'imminent') return true;
    // « parti » vaut tant que la ligne reste affichée. La borne évite qu'une
    // liste non filtrée (train d’il y a trois heures) ne bloque les médias
    // toute la journée.
    if (etat.type === 'parti') return maintenant_s - p.depart_s <= RETRAIT_APRES_DEPART_S;
    return p.depart_s - maintenant_s <= preavis_s;
  });
}
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
    // En ligne dès le départ THÉORIQUE (un train retardé est à quai de son
    // origine — rendu maquette), jusqu'à l'arrivée RÉELLE au terminus.
    if (maintenant_s < departOrigine || maintenant_s > arriveeTerminus + decalage) {
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
 * État « gare fermée » : la gare ne peut plus rien afficher parce qu'une
 * partie de la ligne n'est pas desservie. Deux causes, une seule notion :
 * - la gare est HORS de la section exploitée du jour (travaux) — vrai de
 *   n'importe quel bout de la ligne, pas seulement du haut ;
 * - bascule Terminus Bellevue et gare du Nid d'Aigle (comportement d'origine,
 *   conservé à l'identique).
 *
 * Dans les deux cas, l'état n'est atteint que lorsqu'il n'y a plus AUCUN
 * passage à afficher : les rotations non limitées et les express « à traiter »
 * restent affichés jusqu'à leur dernier passage — l'information prime.
 */
export function etatTronconFerme(
  grille: Grille,
  jour: Jour,
  gare: GareId,
  maintenant_s: number,
): boolean {
  const parLaSection = gareHorsSection(jour, gare);
  const parTerminusBellevue = gare === 'nid-daigle' && jour.terminus_bellevue !== false;
  if (!parLaSection && !parTerminusBellevue) return false;
  return passagesPourGare(grille, jour, gare, maintenant_s).length === 0;
}

/**
 * Texte par DÉFAUT des gares fermées, construit sur la section réelle. Seule
 * source de cette formulation : la supervision en affiche l'aperçu, l'écran
 * l'affiche pour de bon — les deux doivent dire exactement la même chose.
 */
export function messageTronconDefaut(
  debut: GareId,
  fin: GareId,
  nomGare: (gare: GareId) => string,
): { fr: string; en: string } {
  return {
    fr: `Ligne fermée entre ${nomGare(debut)} et ${nomGare(fin)} — travaux`,
    en: `Line closed between ${nomGare(debut)} and ${nomGare(fin)} — works`,
  };
}

/**
 * Gares qui peuvent servir de TERMINUS à un train supplémentaire : toutes
 * celles situées après la gare de départ du jour, dans la section exploitée.
 * La gare de DÉPART, elle, est imposée — c'est `jour.gare_debut`.
 */
export function terminusPossiblesSup(jour: Pick<Jour, 'gare_debut' | 'gare_fin'>): GareId[] {
  const { debut, fin } = sectionDuJour(jour);
  return ORDRE_GARES.slice(ORDRE_GARES.indexOf(debut) + 1, ORDRE_GARES.indexOf(fin) + 1);
}

/** Écran bilingue d'une gare fermée, prêt à afficher. */
export interface FermetureGare {
  /** 'section' = travaux, hors section ; 'terminus-bellevue' = tronçon supérieur. */
  cause: 'section' | 'terminus-bellevue';
  titre_fr: string;
  titre_en: string;
  texte_fr: string;
  texte_en: string;
}

/**
 * Message d'une gare fermée. Le texte saisi en supervision l'emporte ; à
 * défaut, un DÉFAUT bilingue est construit sur la section réelle. Un écran de
 * gare ne reste JAMAIS muet, et n'affiche jamais un « fin de service »
 * trompeur alors que sa gare est fermée pour travaux : ce sont deux états
 * distincts, celui-ci étant prioritaire.
 *
 * `nomGare` vient de la grille (noms officiels) ; les noms de gares sont des
 * noms propres, identiques en anglais.
 */
export function fermetureGare(
  jour: Jour,
  gare: GareId,
  nomGare: (gare: GareId) => string,
): FermetureGare | null {
  const horsSection = gareHorsSection(jour, gare);
  const terminusBellevue = gare === 'nid-daigle' && jour.terminus_bellevue !== false;
  if (!horsSection && !terminusBellevue) return null;

  const saisi = (valeur: string | null | undefined): string => (valeur ?? '').trim();
  const fr = saisi(jour.message_troncon_fr);
  const en = saisi(jour.message_troncon_en);

  if (horsSection) {
    const { debut, fin } = sectionDuJour(jour);
    const defaut = messageTronconDefaut(debut, fin, nomGare);
    return {
      cause: 'section',
      titre_fr: 'Ligne fermée',
      titre_en: 'Line closed',
      texte_fr: fr || defaut.fr,
      texte_en: en || defaut.en,
    };
  }
  return {
    cause: 'terminus-bellevue',
    titre_fr: "Tronçon Bellevue – Nid d'Aigle fermé",
    titre_en: 'Bellevue – Nid d’Aigle section closed',
    texte_fr:
      fr || 'En raison des conditions météorologiques, les trains ont pour terminus Bellevue.',
    texte_en: en || 'Due to weather conditions, trams terminate at Bellevue.',
  };
}
