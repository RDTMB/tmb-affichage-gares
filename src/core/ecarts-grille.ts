// Écarts entre deux grilles (l'active et celle qu'on importe) — PUR et testé.
// Sert à l'aperçu d'import (« qu'est-ce qui change ? »), aux avertissements
// et au résumé consigné dans le journal à la validation.
import { formatHeure, heureVersSecondes } from './horaires';
import { ORDRE_GARES } from './types';
import type { GareId, Grille, Periode, Sens, TrainGrille } from './types';

export interface TrainRef {
  numero: number;
  sens: Sens;
}

export interface EcartHeure {
  numero: number;
  sens: Sens;
  gare: GareId;
  champ: 'a' | 'd';
  /** « HH:MM:SS », null = pas d'heure (gare non desservie, origine, terminus). */
  avant: string | null;
  apres: string | null;
}

export type Indicateur = 'express' | 'facultatif' | 'velos';

export interface EcartIndicateur {
  numero: number;
  sens: Sens;
  champ: Indicateur;
  avant: boolean;
  apres: boolean;
}

export interface EcartsGrilles {
  trainsAjoutes: TrainRef[];
  trainsRetires: TrainRef[];
  heures: EcartHeure[];
  indicateurs: EcartIndicateur[];
  periodes: { avant: Periode[]; apres: Periode[]; identiques: boolean };
  /** true si trains, heures et indicateurs sont identiques (les périodes sont jugées à part). */
  aucun: boolean;
}

const INDICATEURS: readonly Indicateur[] = ['express', 'facultatif', 'velos'];

export function ecarts(ancienne: Grille, nouvelle: Grille): EcartsGrilles {
  const resultat: EcartsGrilles = {
    trainsAjoutes: [],
    trainsRetires: [],
    heures: [],
    indicateurs: [],
    periodes: {
      avant: ancienne.periodes,
      apres: nouvelle.periodes,
      identiques: memesPeriodes(ancienne.periodes, nouvelle.periodes),
    },
    aucun: true,
  };
  const listes: Array<[Sens, TrainGrille[], TrainGrille[]]> = [
    ['montee', ancienne.montees, nouvelle.montees],
    ['descente', ancienne.descentes, nouvelle.descentes],
  ];
  for (const [sens, avant, apres] of listes) {
    const avantParNumero = new Map(avant.map((t) => [t.numero, t]));
    const apresParNumero = new Map(apres.map((t) => [t.numero, t]));
    for (const t of apres)
      if (!avantParNumero.has(t.numero)) resultat.trainsAjoutes.push({ numero: t.numero, sens });
    for (const t of avant)
      if (!apresParNumero.has(t.numero)) resultat.trainsRetires.push({ numero: t.numero, sens });
    for (const t of apres) {
      const ancien = avantParNumero.get(t.numero);
      if (!ancien) continue;
      for (const champ of INDICATEURS) {
        if (ancien[champ] !== t[champ]) {
          resultat.indicateurs.push({
            numero: t.numero,
            sens,
            champ,
            avant: ancien[champ],
            apres: t[champ],
          });
        }
      }
      resultat.heures.push(...ecartsHeures(sens, ancien, t));
    }
  }
  resultat.aucun =
    resultat.trainsAjoutes.length === 0 &&
    resultat.trainsRetires.length === 0 &&
    resultat.heures.length === 0 &&
    resultat.indicateurs.length === 0;
  return resultat;
}

function ecartsHeures(sens: Sens, avant: TrainGrille, apres: TrainGrille): EcartHeure[] {
  const liste: EcartHeure[] = [];
  for (const gare of ORDRE_GARES) {
    const pa = avant.passages.find((p) => p.gare === gare);
    const pb = apres.passages.find((p) => p.gare === gare);
    if (!pa && !pb) continue;
    for (const champ of ['a', 'd'] as const) {
      const x = pa?.[champ] ?? null;
      const y = pb?.[champ] ?? null;
      if (x !== y) liste.push({ numero: apres.numero, sens, gare, champ, avant: x, apres: y });
    }
  }
  return liste;
}

/** Mêmes périodes, à l'ordre près. */
export function memesPeriodes(a: Periode[], b: Periode[]): boolean {
  const cle = (p: Periode[]): string =>
    [...p]
      .map((x) => `${x.du}→${x.au}`)
      .sort()
      .join(';');
  return cle(a) === cle(b);
}

function nomGare(id: GareId): string {
  const noms: Record<GareId, string> = {
    'le-fayet': 'Le Fayet',
    'saint-gervais': 'Saint-Gervais',
    motivon: 'Motivon',
    'col-de-voza': 'Col de Voza',
    bellevue: 'Bellevue',
    'nid-daigle': "Nid d'Aigle",
  };
  return noms[id];
}

function hhmm(h: string | null): string {
  return h === null ? '—' : formatHeure(heureVersSecondes(h));
}

/** « 04/07 → 30/08 » pour une liste de périodes. */
export function libellePeriodes(periodes: Periode[]): string {
  if (periodes.length === 0) return 'aucune période';
  return periodes
    .map(
      (p) =>
        `${p.du.slice(8)}/${p.du.slice(5, 7)}/${p.du.slice(0, 4)} → ${p.au.slice(8)}/${p.au.slice(5, 7)}/${p.au.slice(0, 4)}`,
    )
    .join(' et ');
}

/** Lignes en français simple, pour l'aperçu et le résumé du journal. */
export function decritEcarts(e: EcartsGrilles): string[] {
  const lignes: string[] = [];
  const sensTexte = (s: Sens): string => (s === 'montee' ? 'montée' : 'descente');
  for (const t of e.trainsAjoutes) lignes.push(`TRAIN ${t.numero} ajouté (${sensTexte(t.sens)})`);
  for (const t of e.trainsRetires) lignes.push(`TRAIN ${t.numero} retiré (${sensTexte(t.sens)})`);
  for (const h of e.heures) {
    const quoi = h.champ === 'a' ? 'arrivée' : 'départ';
    lignes.push(
      `TRAIN ${h.numero} — ${nomGare(h.gare)} : ${quoi} ${hhmm(h.avant)} → ${hhmm(h.apres)}`,
    );
  }
  for (const i of e.indicateurs) {
    const ouiNon = (b: boolean): string => (b ? 'oui' : 'non');
    lignes.push(`TRAIN ${i.numero} : ${i.champ} ${ouiNon(i.avant)} → ${ouiNon(i.apres)}`);
  }
  if (!e.periodes.identiques) {
    lignes.push(
      `Dates de validité : ${libellePeriodes(e.periodes.avant)} → ${libellePeriodes(e.periodes.apres)}`,
    );
  }
  return lignes;
}
