// Logique PURE de l'onglet Horaires (grilles en base : import depuis l'Excel
// exploitation, activation, retour arrière), extraite pour être testable sans
// DOM. Le rendu et les appels au fournisseur vivent dans onglet-horaires.ts.
import { ecarts, libellePeriodes, type EcartsGrilles } from '../core/ecarts-grille';
import {
  datesDesPeriodes,
  grillesEntierementCouvertes,
  grillesReactivables,
  reprisesApresDesactivation,
} from '../core/grilles-periodes';
import { serviceActif } from '../core/horaires';
import {
  avertissementsGrillePrecedente,
  chevauchementsPeriodes,
  libelleProposee,
  versionDisponible,
  versionProposee,
  type Probleme,
  type ResultatFeuille,
} from '../core/import-grille';
import type { Grille, Periode } from '../core/types';

const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Une feuille du classeur dans la boîte de dialogue : ce que l'agent complète. */
export interface FeuilleImport {
  resultat: ResultatFeuille;
  /** Case « charger cette feuille » (une seule a peut-être changé). */
  inclure: boolean;
  libelle: string;
  /** Périodes CONFIRMÉES (pré-remplies depuis le titre du fichier). */
  periodes: Periode[];
  commentaire: string;
  /** Copie modifiable de la grille lue (indicateurs facultatif / vélos). */
  grille: Grille | null;
  /** Avertissements du fichier + comparaison avec la grille précédente. */
  avertissements: Probleme[];
  avertissementsAcquittes: boolean;
  /** Journées déjà préparées dans les périodes ; cochées = à réinitialiser. */
  joursExistants: string[];
  joursAReinitialiser: Set<string>;
}

/** Grille active qui sert aujourd'hui le plus de dates des périodes données. */
export function grillePrecedentePour(grillesActives: Grille[], periodes: Periode[]): Grille | null {
  const compte = new Map<string, { grille: Grille; jours: number }>();
  for (const date of datesDesPeriodes(periodes)) {
    const g = serviceActif(grillesActives, date);
    if (!g) continue;
    const entree = compte.get(g.version) ?? { grille: g, jours: 0 };
    entree.jours++;
    compte.set(g.version, entree);
  }
  let meilleure: { grille: Grille; jours: number } | null = null;
  for (const entree of compte.values()) {
    if (!meilleure || entree.jours > meilleure.jours) meilleure = entree;
  }
  return meilleure?.grille ?? null;
}

export function nouvelleFeuilleImport(
  resultat: ResultatFeuille,
  grillesActives: Grille[],
): FeuilleImport {
  const periodes = resultat.periodesProposees.map((p) => ({ ...p }));
  const grille = resultat.grille ? structuredClone(resultat.grille) : null;
  const precedente = grille ? grillePrecedentePour(grillesActives, periodes) : null;
  return {
    resultat,
    inclure: true,
    libelle: libelleProposee(resultat.nom, periodes),
    periodes,
    commentaire: '',
    grille,
    avertissements: [
      ...resultat.avertissements,
      ...(grille && precedente ? avertissementsGrillePrecedente(grille, precedente) : []),
    ],
    avertissementsAcquittes: false,
    joursExistants: [],
    joursAReinitialiser: new Set(),
  };
}

/** Écarts d'une feuille avec la grille active couvrant ses dates (null si aucune). */
export function ecartsFeuille(
  feuille: FeuilleImport,
  grillesActives: Grille[],
): { precedente: Grille; ecarts: EcartsGrilles } | null {
  if (!feuille.grille) return null;
  const precedente = grillePrecedentePour(grillesActives, feuille.periodes);
  if (!precedente) return null;
  return {
    precedente,
    ecarts: ecarts(precedente, { ...feuille.grille, periodes: feuille.periodes }),
  };
}

function periodeValide(p: Periode): boolean {
  return DATE_ISO.test(p.du) && DATE_ISO.test(p.au) && p.du <= p.au;
}

/** Ce qui empêche encore de valider — vide = on peut. Phrases pour l'agent. */
export function raisonsBlocage(feuilles: FeuilleImport[]): string[] {
  const incluses = feuilles.filter((f) => f.inclure);
  const raisons: string[] = [];
  if (incluses.length === 0)
    raisons.push('Aucune feuille à charger : cochez au moins une feuille.');
  for (const f of incluses) {
    const nom = `« ${f.resultat.nom} »`;
    if (!f.grille) raisons.push(`${nom} : la feuille n'a pas pu être lue.`);
    if (f.resultat.erreurs.length > 0) {
      raisons.push(
        `${nom} : ${f.resultat.erreurs.length} erreur(s) à corriger dans le fichier Excel, puis recharger le fichier.`,
      );
    }
    if (f.libelle.trim() === '') raisons.push(`${nom} : donnez un nom à la grille.`);
    if (f.periodes.length === 0) {
      raisons.push(`${nom} : indiquez au moins une période de validité (du… au…).`);
    } else if (f.periodes.some((p) => !periodeValide(p))) {
      raisons.push(`${nom} : une période est incomplète ou se termine avant de commencer.`);
    }
    if (f.avertissements.length > 0 && !f.avertissementsAcquittes) {
      raisons.push(`${nom} : lisez les avertissements et cochez « J'ai lu ces avertissements ».`);
    }
  }
  raisons.push(
    ...chevauchementsPeriodes(
      incluses
        .filter((f) => f.periodes.every(periodeValide))
        .map((f) => ({ nom: f.resultat.nom, periodes: f.periodes })),
    ).map((p) => p.message),
  );
  return raisons;
}

/** Grille prête à enregistrer : identifiant libre, libellé, périodes confirmées, provenance. */
export function grilleAEnregistrer(
  f: FeuilleImport,
  nomFichier: string,
  versionsExistantes: readonly string[],
): Grille {
  if (!f.grille) throw new Error(`Feuille « ${f.resultat.nom} » : aucune grille lue`);
  const base = versionProposee(f.resultat.nom, f.periodes);
  if (base === null)
    throw new Error(`Feuille « ${f.resultat.nom} » : périodes de validité manquantes`);
  return {
    ...f.grille,
    version: versionDisponible(base, versionsExistantes),
    libelle: f.libelle.trim(),
    periodes: f.periodes.map((p) => ({ ...p })),
    source: f.resultat.miseAJour
      ? `${nomFichier} — mise à jour du ${f.resultat.miseAJour}`
      : nomFichier,
  };
}

export interface PlanFeuille {
  grille: Grille;
  commentaire: string | null;
  /** Grilles actives que la nouvelle recouvre entièrement : désactivées automatiquement. */
  aDesactiver: Grille[];
  joursAReinitialiser: string[];
}

/**
 * Ce que la validation va faire, feuille par feuille, dans l'ordre. Les
 * identifiants sont attribués en tenant compte des grilles créées plus tôt
 * dans le même lot.
 */
export function planValidation(
  feuilles: FeuilleImport[],
  nomFichier: string,
  grillesActives: Grille[],
  versionsExistantes: readonly string[],
): PlanFeuille[] {
  const versions = [...versionsExistantes];
  const plans: PlanFeuille[] = [];
  for (const f of feuilles.filter((x) => x.inclure)) {
    const grille = grilleAEnregistrer(f, nomFichier, versions);
    versions.push(grille.version);
    plans.push({
      grille,
      commentaire: f.commentaire.trim() || null,
      aDesactiver: grillesEntierementCouvertes(grillesActives, grille),
      joursAReinitialiser: [...f.joursAReinitialiser].sort(),
    });
  }
  return plans;
}

/** « 2026-07-04 » → « 04/07/2026 ». */
export function dateCourte(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** « 2026-07-04 » → « sam. 4 juil. 2026 » (calcul en UTC : déterministe). */
export function dateLongue(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

/** Résumé d'une feuille validée, pour le journal des publications et le récapitulatif. */
export function resumePlan(plan: PlanFeuille): string {
  const g = plan.grille;
  const morceaux = [
    `Grille « ${g.libelle} » chargée (référence ${g.version}) : ${libellePeriodes(g.periodes)} ; ${g.montees.length} montées + ${g.descentes.length} descentes`,
  ];
  if (plan.aDesactiver.length > 0) {
    morceaux.push(
      `remplace ${plan.aDesactiver.map((x) => `« ${x.libelle} »`).join(', ')} (désactivée${plan.aDesactiver.length > 1 ? 's' : ''}, réactivable)`,
    );
  }
  if (plan.joursAReinitialiser.length > 0) {
    morceaux.push(
      `journée${plan.joursAReinitialiser.length > 1 ? 's' : ''} réinitialisée${plan.joursAReinitialiser.length > 1 ? 's' : ''} : ${plan.joursAReinitialiser.map(dateCourte).join(', ')}`,
    );
  }
  return morceaux.join(' — ');
}

/** Question posée avant de désactiver une grille : qui reprend la main, où. */
export function texteDesactivation(grilles: Grille[], version: string): string {
  const g = grilles.find((x) => x.version === version);
  if (!g) return `Grille « ${version} » introuvable.`;
  const lignes = [`Désactiver la grille « ${g.libelle} » ?`, ''];
  for (const r of reprisesApresDesactivation(grilles, version)) {
    lignes.push(
      `Du ${dateCourte(r.du)} au ${dateCourte(r.au)} : ${
        r.libelle
          ? `la grille « ${r.libelle} » reprend la main.`
          : 'plus aucun service ne sera affiché (hors saison).'
      }`,
    );
    if (r.libelle === null) {
      // Retour arrière : la grille remplacée à l'import a été désactivée
      // automatiquement — c'est elle qu'il faut réactiver.
      const reactivables = grillesReactivables(grilles, r.du, r.au).filter(
        (x) => x.version !== version,
      );
      if (reactivables.length > 0) {
        // La date de chargement distingue deux grilles de même nom (v1 / v2).
        lignes.push(
          `  Pour revenir en arrière sur ces dates, réactivez ensuite ${reactivables
            .map(
              (x) =>
                `« ${x.libelle} »${x.cree_le ? ` (chargée le ${dateCourte(x.cree_le.slice(0, 10))})` : ''}`,
            )
            .join(' ou ')}.`,
        );
      }
    }
  }
  lignes.push(
    '',
    'Les écrans suivent en quelques secondes. Elle pourra être réactivée à tout moment.',
  );
  return lignes.join('\n');
}

/** Question posée avant d'activer une grille : où elle s'appliquera, qui elle remplace. */
export function texteActivation(grilles: Grille[], version: string): string {
  const g = grilles.find((x) => x.version === version);
  if (!g) return `Grille « ${version} » introuvable.`;
  const simulees = grilles.map((x) => (x.version === version ? { ...x, actif: true } : x));
  const lignes = [`Activer la grille « ${g.libelle} » ?`, ''];
  const plages: { du: string; au: string; gagnante: Grille | null }[] = [];
  for (const date of datesDesPeriodes(g.periodes)) {
    const gagnante = serviceActif(simulees, date);
    const derniere = plages[plages.length - 1];
    if (derniere && (derniere.gagnante?.version ?? null) === (gagnante?.version ?? null)) {
      derniere.au = date;
    } else {
      plages.push({ du: date, au: date, gagnante });
    }
  }
  for (const p of plages) {
    const quand = `Du ${dateCourte(p.du)} au ${dateCourte(p.au)}`;
    if (p.gagnante?.version === version) {
      const remplacee = serviceActif(
        grilles.filter((x) => x.version !== version),
        p.du,
      );
      lignes.push(
        remplacee
          ? `${quand} : elle s'applique et remplace « ${remplacee.libelle} » (plus ancienne).`
          : `${quand} : elle s'applique.`,
      );
    } else {
      lignes.push(
        `${quand} : ATTENTION, la grille « ${p.gagnante?.libelle ?? '?'} », plus récente, reste prioritaire.`,
      );
    }
  }
  lignes.push('', 'Les écrans suivent en quelques secondes.');
  return lignes.join('\n');
}
