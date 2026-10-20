// Arrivée au terminus EXCEPTIONNEL (décision de l'exploitant du 20/10/2026).
//
// Constaté le 20/10/2026 sur la base de TEST (journée du 22/12/2026, TRAIN 9
// limité au Col de Voza) : le tableau d'une gare ne listait que des départs,
// si bien qu'au Col de Voza le TRAIN 9 — qui y arrive à 13:44 et n'en repart
// pas — n'apparaissait nulle part. Ces tests tiennent la règle qui le fait
// apparaître, et ses deux limites : rien au terminus NORMAL, rien pour un
// train SUPPRIMÉ.
import { describe, expect, it } from 'vitest';

import { ETE, grilleHiver } from './__fixtures__/grille-hiver-essai';
import {
  arriveeAuTerminusExceptionnel,
  generationJour,
  heureVersSecondes,
  lignesDuTableau,
  passagesPourGare,
  terminusDeGrille,
} from './horaires';
import type { Circulation, Grille, Jour } from './types';

const DATE_ETE = '2026-07-15';
const DATE_HIVER = '2026-12-15';
const h = heureVersSecondes;

const HIVER = grilleHiver();

const hiver = (): Jour => generationJour(HIVER, DATE_HIVER);
function ete(): Jour {
  const jour = generationJour(ETE, DATE_ETE);
  for (const c of jour.circulations) if (c.facultatif) c.facultatif_actif = true;
  return jour;
}
function circ(jour: Jour, numero: number): Circulation {
  const c = jour.circulations.find((x) => x.numero === numero);
  if (!c) throw new Error(`TRAIN ${numero} absent`);
  return c;
}

/** Le TRAIN 5 limité au Col de Voza — le cas du TRAIN 9 du 22/12/2026, sur la grille d'essai. */
function hiverT5AuColDeVoza(): Jour {
  const jour = hiver();
  circ(jour, 5).terminus = 'col-de-voza';
  return jour;
}
const ARRIVEE_T5_VOZA = h('09:40:30');

const numeros = (l: { numero: number }[]): number[] => l.map((p) => p.numero);

describe('la ligne d’arrivée apparaît au terminus EXCEPTIONNEL', () => {
  it('Col de Voza, TRAIN 5 limité : une ligne d’arrivée, à l’heure d’arrivée de la grille', () => {
    const jour = hiverT5AuColDeVoza();
    const passages = passagesPourGare(HIVER, jour, 'col-de-voza', h('09:00'));
    const t5 = passages.find((p) => p.numero === 5);
    expect(t5?.depart_s).toBeNull();
    expect(t5?.arrivee_s).toBe(ARRIVEE_T5_VOZA);
    expect(t5 && arriveeAuTerminusExceptionnel(t5)).toBe(true);
    expect(numeros(lignesDuTableau(passages))).toContain(5);
  });

  it('elle se range parmi les départs, à son heure d’arrivée — avant la descente qui en repart', () => {
    const jour = hiverT5AuColDeVoza();
    const lignes = lignesDuTableau(passagesPourGare(HIVER, jour, 'col-de-voza', h('09:00')));
    const i5 = lignes.findIndex((p) => p.numero === 5);
    const i6 = lignes.findIndex((p) => p.numero === 6);
    expect(i5).toBeGreaterThanOrEqual(0);
    expect(i6).toBeGreaterThan(i5);
    // La descente appariée part du Col de Voza : c'est un DÉPART ordinaire.
    const t6 = lignes[i6];
    expect(t6?.depart_s).not.toBeNull();
    expect(t6 && arriveeAuTerminusExceptionnel(t6)).toBe(false);
  });

  it('section du jour arrêtée au Col de Voza : chaque montée y arrive exceptionnellement', () => {
    const jour = { ...hiver(), gare_fin: 'col-de-voza' as const };
    const passages = passagesPourGare(HIVER, jour, 'col-de-voza');
    const montees = passages.filter((p) => p.sens === 'montee');
    expect(montees.length).toBeGreaterThan(0);
    for (const p of montees) expect(arriveeAuTerminusExceptionnel(p), `T${p.numero}`).toBe(true);
  });

  it('été, bascule à Bellevue : la ligne d’arrivée est à Bellevue', () => {
    const jour = ete();
    circ(jour, 5).terminus = 'bellevue';
    const lignes = lignesDuTableau(passagesPourGare(ETE, jour, 'bellevue'));
    const t5 = lignes.find((p) => p.numero === 5);
    expect(t5 && arriveeAuTerminusExceptionnel(t5)).toBe(true);
  });

  it('un retard décale l’heure d’arrivée affichée, comme celle d’un départ', () => {
    const jour = hiverT5AuColDeVoza();
    Object.assign(circ(jour, 5), { statut: 'retard', retard_min: 10 });
    const t5 = passagesPourGare(HIVER, jour, 'col-de-voza').find((p) => p.numero === 5);
    expect(t5?.arrivee_s).toBe(ARRIVEE_T5_VOZA + 600);
    expect(t5 && arriveeAuTerminusExceptionnel(t5)).toBe(true);
  });
});

describe('les limites : rien au terminus NORMAL, rien pour un SUPPRIMÉ, rien en passage', () => {
  it('hiver, Bellevue : un train qui arrive à son terminus normal ne produit AUCUNE ligne', () => {
    const passages = passagesPourGare(HIVER, hiver(), 'bellevue');
    const montees = passages.filter((p) => p.sens === 'montee');
    expect(montees.length).toBeGreaterThan(0);
    for (const p of montees) expect(arriveeAuTerminusExceptionnel(p)).toBe(false);
    expect(lignesDuTableau(passages).filter((p) => p.sens === 'montee')).toEqual([]);
  });

  it('été, Nid d’Aigle : idem', () => {
    const passages = passagesPourGare(ETE, ete(), 'nid-daigle');
    expect(lignesDuTableau(passages).filter((p) => p.sens === 'montee')).toEqual([]);
  });

  it('un train limité mais SUPPRIMÉ ne produit pas de ligne d’arrivée', () => {
    const jour = hiverT5AuColDeVoza();
    Object.assign(circ(jour, 5), { statut: 'supprime', motif: 'Météo' });
    const passages = passagesPourGare(HIVER, jour, 'col-de-voza', h('09:00'));
    const t5 = passages.find((p) => p.numero === 5);
    expect(t5).toBeDefined(); // le passage existe…
    expect(t5 && arriveeAuTerminusExceptionnel(t5)).toBe(false); // …mais n'arrive nulle part
    expect(numeros(lignesDuTableau(passages))).not.toContain(5);
  });

  it('en amont (Motivon), le train limité garde sa ligne de DÉPART ordinaire', () => {
    const jour = hiverT5AuColDeVoza();
    const t5 = passagesPourGare(HIVER, jour, 'motivon').find((p) => p.numero === 5);
    expect(t5?.terminusExceptionnel).toBe(true);
    expect(t5?.destination).toBe('col-de-voza');
    expect(t5 && arriveeAuTerminusExceptionnel(t5)).toBe(false);
  });

  it('chacune des quatre conditions est nécessaire', () => {
    const jour = hiverT5AuColDeVoza();
    const t5 = passagesPourGare(HIVER, jour, 'col-de-voza').find((p) => p.numero === 5);
    if (!t5) throw new Error('TRAIN 5 absent');
    expect(arriveeAuTerminusExceptionnel(t5)).toBe(true);
    expect(arriveeAuTerminusExceptionnel({ ...t5, sens: 'descente' })).toBe(false);
    expect(arriveeAuTerminusExceptionnel({ ...t5, terminusExceptionnel: false })).toBe(false);
    expect(arriveeAuTerminusExceptionnel({ ...t5, statut: 'supprime' })).toBe(false);
    expect(arriveeAuTerminusExceptionnel({ ...t5, depart_s: t5.arrivee_s })).toBe(false);
    expect(arriveeAuTerminusExceptionnel({ ...t5, arrivee_s: null })).toBe(false);
    // Un retard ne retire pas la ligne.
    expect(arriveeAuTerminusExceptionnel({ ...t5, statut: 'retard' })).toBe(true);
  });
});

describe('la ligne disparaît comme un départ, une fois l’heure d’arrivée passée', () => {
  const restantes = (maintenant_s: number): number[] =>
    numeros(
      lignesDuTableau(passagesPourGare(HIVER, hiverT5AuColDeVoza(), 'col-de-voza', maintenant_s)),
    );

  it('présente avant l’arrivée, et pendant les 2 min qui la suivent', () => {
    expect(restantes(ARRIVEE_T5_VOZA - 3600)).toContain(5);
    expect(restantes(ARRIVEE_T5_VOZA)).toContain(5);
    expect(restantes(ARRIVEE_T5_VOZA + 120)).toContain(5);
  });

  it('retirée au-delà — même délai que le retrait d’un départ', () => {
    expect(restantes(ARRIVEE_T5_VOZA + 121)).not.toContain(5);
  });
});

describe('terminusDeGrille : la gare vers laquelle le train « ne continue pas »', () => {
  it('hiver : Bellevue', () => {
    expect(terminusDeGrille(HIVER, 5, DATE_HIVER)).toBe('bellevue');
  });

  it('été : le Nid d’Aigle', () => {
    expect(terminusDeGrille(ETE, 5, DATE_ETE)).toBe('nid-daigle');
  });

  it('lu sur la GRILLE, pas sur la journée : une limite ne le change pas', () => {
    // generationJour ne touche pas la grille : la limite est dans `jour`.
    hiverT5AuColDeVoza();
    expect(terminusDeGrille(HIVER, 5, DATE_HIVER)).toBe('bellevue');
  });

  it('le train de grille qui s’arrête plus bas que le sommet garde SON terminus', () => {
    const grille: Grille = {
      ...ETE,
      montees: ETE.montees.map((t) =>
        t.numero === 5 ? { ...t, passages: t.passages.filter((p) => p.gare !== 'nid-daigle') } : t,
      ),
    };
    expect(terminusDeGrille(grille, 5, DATE_ETE)).toBe('bellevue');
  });

  it('train hors grille, ou qui ne circule pas ce jour-là : le sommet de la grille', () => {
    expect(terminusDeGrille(HIVER, 101, DATE_HIVER)).toBe('bellevue');
    expect(terminusDeGrille(ETE, 101, DATE_ETE)).toBe('nid-daigle');
    const dimancheSeul: Grille = {
      ...HIVER,
      montees: HIVER.montees.map((t) =>
        t.numero === 5 ? { ...t, passages: t.passages.slice(0, 2), jours: [7] } : t,
      ),
    };
    // 15/12/2026 est un mardi : le TRAIN 5 « du dimanche » ne compte pas.
    expect(terminusDeGrille(dimancheSeul, 5, DATE_HIVER)).toBe('bellevue');
  });

  it('un passage à tiret n’est pas une desserte', () => {
    const grille: Grille = {
      ...HIVER,
      montees: HIVER.montees.map((t) =>
        t.numero === 5
          ? {
              ...t,
              passages: t.passages.map((p) =>
                p.gare === 'bellevue' ? { gare: p.gare, a: '-' } : p,
              ),
            }
          : t,
      ),
    };
    expect(terminusDeGrille(grille, 5, DATE_HIVER)).toBe('col-de-voza');
  });
});
