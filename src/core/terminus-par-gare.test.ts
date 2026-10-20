// Terminus par gare (décision de l'exploitant du 20/10/2026) : une montée de
// la grille peut être limitée au Col de Voza comme à Bellevue, en toute
// saison ; la colonne ne propose que les gares que la journée dessert (jamais
// le Nid d'Aigle un jour où la grille n'y monte pas) ; la bascule devient
// « Terminus [gare] à partir du TRAIN N ». Les cas Bellevue d'origine sont
// couverts par horaires.test.ts et section-exploitee.test.ts, inchangés.
import { describe, expect, it } from 'vitest';

import grandServiceJson from '../../docs/grilles-historique/2026-ete-grand-service.json';
import {
  appliqueTerminusBellevue,
  basculeDuFlag,
  deltaBascule,
  deltaTerminusBellevue,
  etatTronconFerme,
  expressATraiter,
  fermetureGare,
  gareDeBascule,
  garesDeBasculeProposees,
  generationJour,
  heureVersSecondes,
  limiteDeRotation,
  limiteEffective,
  passagesPourGare,
  sommetDuJour,
  terminusAffiche,
  terminusPossiblesSup,
  terminusProposes,
  trainsDuJour,
  valeurTerminus,
} from './horaires';
import type { Circulation, GareId, Grille, Jour, PassageGrille, TrainGrille } from './types';

const ETE = grandServiceJson as unknown as Grille;
const DATE_ETE = '2026-07-15';
const DATE_HIVER = '2026-12-15';
const h = heureVersSecondes;

/** Grille d'hiver construite depuis l'été (même construction que hiver-bellevue.test.ts). */
function grilleHiver(): Grille {
  const tronqueMontee = (t: TrainGrille): TrainGrille => {
    const index = t.passages.findIndex((p) => p.gare === 'bellevue');
    const passages: PassageGrille[] = t.passages.slice(0, index + 1).map((p, i, liste) => {
      if (i !== liste.length - 1) return { ...p };
      const { d: _d, ...sansDepart } = p;
      return sansDepart;
    });
    return { ...t, passages };
  };
  const tronqueDescente = (t: TrainGrille): TrainGrille => {
    const index = t.passages.findIndex((p) => p.gare === 'bellevue');
    const passages: PassageGrille[] = t.passages.slice(index).map((p, i) => {
      if (i !== 0) return { ...p };
      const { a: _a, ...sansArrivee } = p;
      return sansArrivee;
    });
    return { ...t, passages };
  };
  return {
    ...ETE,
    version: '2026-2027-hiver',
    libelle: 'Hiver 2026-2027',
    periodes: [{ du: '2026-12-01', au: '2027-04-11' }],
    montees: ETE.montees.filter((t) => !t.express).map(tronqueMontee),
    descentes: ETE.descentes
      .filter((t) => !t.express && ETE.montees.some((m) => m.numero === t.numero - 1 && !m.express))
      .map(tronqueDescente),
  };
}
const HIVER = grilleHiver();

const NOMS: Record<GareId, string> = {
  'le-fayet': 'Le Fayet',
  'saint-gervais': 'Saint-Gervais',
  motivon: 'Motivon',
  'col-de-voza': 'Col de Voza',
  bellevue: 'Bellevue',
  'nid-daigle': "Nid d'Aigle",
};
const nomGare = (g: GareId): string => NOMS[g];

/** Journée d'été, tous les facultatifs activés (les express sont tous facultatifs). */
function ete(): Jour {
  const jour = generationJour(ETE, DATE_ETE);
  for (const c of jour.circulations) if (c.facultatif) c.facultatif_actif = true;
  return jour;
}
const hiver = (): Jour => generationJour(HIVER, DATE_HIVER);

function circ(jour: Jour, numero: number): Circulation {
  const c = jour.circulations.find((x) => x.numero === numero);
  if (!c) throw new Error(`TRAIN ${numero} absent`);
  return c;
}
const train = (grille: Grille, jour: Jour, numero: number) => {
  const t = trainsDuJour(grille, jour).find((x) => x.numero === numero);
  if (!t) throw new Error(`TRAIN ${numero} ne circule pas`);
  return t;
};
const gares = (t: { passages: { gare: GareId }[] }): GareId[] => t.passages.map((p) => p.gare);

// ---------------------------------------------------------------------------

describe('gares proposées par la colonne Terminus', () => {
  it('été : Nid d’Aigle, Bellevue, Col de Voza', () => {
    expect(terminusProposes(ETE, ete())).toEqual(['nid-daigle', 'bellevue', 'col-de-voza']);
    expect(garesDeBasculeProposees(ETE, ete())).toEqual(['bellevue', 'col-de-voza']);
  });

  it('hiver : Bellevue, Col de Voza — jamais le Nid d’Aigle', () => {
    expect(terminusProposes(HIVER, hiver())).toEqual(['bellevue', 'col-de-voza']);
    expect(garesDeBasculeProposees(HIVER, hiver())).toEqual(['col-de-voza']);
  });

  it('hiver, section qui s’arrête au Col de Voza : le Col de Voza seul, plus de bascule', () => {
    const jour = { ...hiver(), gare_fin: 'col-de-voza' as const };
    expect(sommetDuJour(HIVER, jour)).toBe('col-de-voza');
    expect(terminusProposes(HIVER, jour)).toEqual(['col-de-voza']);
    expect(garesDeBasculeProposees(HIVER, jour)).toEqual([]);
  });

  it('été, section jusqu’à Bellevue : la section est la borne extérieure', () => {
    const jour = { ...ete(), gare_fin: 'bellevue' as const };
    expect(sommetDuJour(ETE, jour)).toBe('bellevue');
    expect(terminusProposes(ETE, jour)).toEqual(['bellevue', 'col-de-voza']);
  });

  it('section sous le Col de Voza : une seule gare, rien à limiter', () => {
    const jour = { ...ete(), gare_fin: 'motivon' as const };
    expect(terminusProposes(ETE, jour)).toEqual(['motivon']);
  });

  it('section qui PART du Col de Voza : on n’y termine pas une montée', () => {
    const jour = { ...ete(), gare_debut: 'col-de-voza' as const };
    expect(terminusProposes(ETE, jour)).toEqual(['nid-daigle', 'bellevue']);
  });
});

describe('ce que vaut la colonne, et ce qu’elle affiche', () => {
  it('hiver : « non limité » s’affiche Bellevue, jamais Nid d’Aigle', () => {
    expect(terminusAffiche('nid-daigle', 'bellevue')).toBe('bellevue');
    // Une colonne sur « bellevue » un jour d'hiver (bascule d'avant) ne limite
    // rien : elle s'affiche au sommet, comme « non limité ».
    expect(terminusAffiche('bellevue', 'bellevue')).toBe('bellevue');
    expect(limiteEffective('bellevue', 'bellevue')).toBeNull();
    expect(terminusAffiche('col-de-voza', 'bellevue')).toBe('col-de-voza');
  });

  it('été : chaque valeur s’affiche à sa gare', () => {
    expect(terminusAffiche('nid-daigle', 'nid-daigle')).toBe('nid-daigle');
    expect(terminusAffiche('bellevue', 'nid-daigle')).toBe('bellevue');
    expect(terminusAffiche('col-de-voza', 'nid-daigle')).toBe('col-de-voza');
  });

  it('choisir le SOMMET s’écrit « non limité » — la rotation remontera seule', () => {
    expect(valeurTerminus('bellevue', 'bellevue')).toBe('nid-daigle');
    expect(valeurTerminus('nid-daigle', 'nid-daigle')).toBe('nid-daigle');
    expect(valeurTerminus('nid-daigle', 'bellevue')).toBe('nid-daigle');
    expect(valeurTerminus('bellevue', 'nid-daigle')).toBe('bellevue');
    expect(valeurTerminus('col-de-voza', 'bellevue')).toBe('col-de-voza');
    // Une gare qui n'est pas une limite ne s'écrit jamais telle quelle.
    expect(valeurTerminus('motivon', 'nid-daigle')).toBe('nid-daigle');
  });

  it('une valeur inconnue vaut « non limité » : on n’efface pas un train', () => {
    expect(limiteDeRotation('motivon')).toBeNull();
    expect(limiteDeRotation('')).toBeNull();
    expect(limiteDeRotation(undefined)).toBeNull();
    expect(limiteDeRotation('col-de-voza')).toBe('col-de-voza');
  });

  it('gare de bascule : absente = Bellevue (ancien front, instantané en cache)', () => {
    expect(gareDeBascule(false)).toBeNull();
    expect(gareDeBascule(undefined)).toBeNull();
    expect(gareDeBascule({ a_partir_du_train: 9 })).toBe('bellevue');
    expect(gareDeBascule({ a_partir_du_train: 9, gare: 'col-de-voza' })).toBe('col-de-voza');
    expect(basculeDuFlag({ a_partir_du_train: 14, gare: 'col-de-voza' })).toEqual({
      seuil: 13,
      gare: 'col-de-voza',
    });
  });
});

describe('rotation limitée au Col de Voza : on TRONQUE, on ne recalcule rien', () => {
  it('été : la montée s’arrête au Col de Voza, à son heure de grille', () => {
    const jour = ete();
    circ(jour, 5).terminus = 'col-de-voza';
    const t5 = train(ETE, jour, 5);
    expect(gares(t5)).toEqual(['le-fayet', 'saint-gervais', 'motivon', 'col-de-voza']);
    expect(t5.terminusExceptionnel).toBe(true);
    const voza = t5.passages[3];
    expect(voza?.arrivee_s).toBe(h('09:40:30'));
    expect(voza?.depart_s).toBeNull();
  });

  it('été : la descente appariée PART du Col de Voza, à son heure de grille', () => {
    const jour = ete();
    circ(jour, 5).terminus = 'col-de-voza';
    const t6 = train(ETE, jour, 6);
    expect(gares(t6)).toEqual(['col-de-voza', 'motivon', 'saint-gervais', 'le-fayet']);
    expect(t6.passages[0]?.arrivee_s).toBeNull();
    expect(t6.passages[0]?.depart_s).toBe(h('10:41:30'));
    expect(t6.passages[3]?.arrivee_s).toBe(h('11:24:30'));
  });

  it('écran du Fayet : destination « Col de Voza », terminus exceptionnel', () => {
    const jour = ete();
    circ(jour, 5).terminus = 'col-de-voza';
    const p = passagesPourGare(ETE, jour, 'le-fayet').find((x) => x.numero === 5);
    expect(p?.destination).toBe('col-de-voza');
    expect(p?.terminusExceptionnel).toBe(true);
    // Bellevue ne voit plus passer la rotation, ni à la montée ni à la descente.
    const bellevue = passagesPourGare(ETE, jour, 'bellevue').map((x) => x.numero);
    expect(bellevue).not.toContain(5);
    expect(bellevue).not.toContain(6);
  });

  it('hiver : même troncature sous le sommet Bellevue', () => {
    const jour = hiver();
    circ(jour, 5).terminus = 'col-de-voza';
    expect(gares(train(HIVER, jour, 5)).at(-1)).toBe('col-de-voza');
    expect(train(HIVER, jour, 5).terminusExceptionnel).toBe(true);
    expect(gares(train(HIVER, jour, 6))[0]).toBe('col-de-voza');
  });

  it('hiver : « bellevue » dans la colonne ne change rien (c’est déjà le sommet)', () => {
    const jour = hiver();
    circ(jour, 5).terminus = 'bellevue';
    const t5 = train(HIVER, jour, 5);
    expect(gares(t5).at(-1)).toBe('bellevue');
    expect(t5.terminusExceptionnel).toBe(false);
  });

  it('une section plus courte gagne : limite au Col de Voza, section jusqu’à Motivon', () => {
    const jour = { ...ete(), gare_fin: 'motivon' as const };
    circ(jour, 5).terminus = 'col-de-voza';
    expect(gares(train(ETE, jour, 5)).at(-1)).toBe('motivon');
  });
});

describe('bascule « Terminus Col de Voza à partir du TRAIN N »', () => {
  it('pré-remplit les montées ≥ N, et seulement elles', () => {
    const { jour } = appliqueTerminusBellevue(ETE, ete(), 13, 'col-de-voza');
    expect(jour.terminus_bellevue).toEqual({ a_partir_du_train: 13, gare: 'col-de-voza' });
    expect(circ(jour, 11).terminus).toBe('nid-daigle');
    for (const n of [13, 15, 17, 19, 21, 23, 25])
      expect(circ(jour, n).terminus).toBe('col-de-voza');
    // Les descentes ne portent pas la colonne.
    expect(circ(jour, 14).terminus).toBe('nid-daigle');
  });

  it('un numéro PAIR vise la montée de sa rotation (N − 1)', () => {
    const { jour } = appliqueTerminusBellevue(ETE, ete(), 14, 'col-de-voza');
    expect(jour.terminus_bellevue).toEqual({ a_partir_du_train: 13, gare: 'col-de-voza' });
  });

  it('une bascule Bellevue garde EXACTEMENT sa forme d’avant (sans clé `gare`)', () => {
    const { jour } = appliqueTerminusBellevue(ETE, ete(), 13);
    expect(jour.terminus_bellevue).toEqual({ a_partir_du_train: 13 });
    expect(Object.keys(jour.terminus_bellevue || {})).toEqual(['a_partir_du_train']);
  });

  it('une bascule Bellevue ne rouvre pas une montée déjà limitée au Col de Voza', () => {
    const base = ete();
    circ(base, 15).terminus = 'col-de-voza';
    const { jour } = appliqueTerminusBellevue(ETE, base, 13);
    expect(circ(jour, 13).terminus).toBe('bellevue');
    expect(circ(jour, 15).terminus).toBe('col-de-voza');
  });

  it('décocher libère TOUT, Col de Voza compris (défaut M-21)', () => {
    const { jour } = appliqueTerminusBellevue(ETE, ete(), 13, 'col-de-voza');
    circ(jour, 5).terminus = 'col-de-voza'; // réglage manuel hors plage
    const libere = deltaBascule(jour.circulations, { seuil: 13, gare: 'col-de-voza' }, null);
    expect(libere.filter((c) => c.terminus !== 'nid-daigle')).toEqual([]);
  });

  it('express de la plage : jamais tronqués, signalés « à traiter »', () => {
    const { jour, aTraiter } = appliqueTerminusBellevue(ETE, ete(), 9, 'col-de-voza');
    // Montées express 9, 17, 23 ; descentes express 10, 18 (24 ne l'est pas).
    expect(aTraiter).toEqual([9, 10, 17, 18, 23]);
    expect(expressATraiter(ETE, jour)).toEqual(aTraiter);
    // L'express circule normalement jusqu'au Nid d'Aigle…
    const t9 = train(ETE, jour, 9);
    expect(gares(t9).at(-1)).toBe('nid-daigle');
    expect(t9.terminusExceptionnel).toBe(false);
    expect(gares(train(ETE, jour, 10))[0]).toBe('nid-daigle');
    // …mais la descente NON express d'un express limité part du Col de Voza.
    expect(gares(train(ETE, jour, 24))[0]).toBe('col-de-voza');
  });

  it('écran de Bellevue sans plus aucun passage → « tronçon fermé », jamais « service terminé »', () => {
    const { jour } = appliqueTerminusBellevue(ETE, ete(), 1, 'col-de-voza');
    // Les express ne desservent pas Bellevue : il ne reste rien à y afficher.
    expect(passagesPourGare(ETE, jour, 'bellevue', h('10:00'))).toEqual([]);
    expect(etatTronconFerme(ETE, jour, 'bellevue', h('10:00'))).toBe(true);
    expect(etatTronconFerme(ETE, jour, 'col-de-voza', h('10:00'))).toBe(false);
    const f = fermetureGare(jour, 'bellevue', nomGare, 'nid-daigle');
    expect(f?.titre_fr).toBe("Tronçon Col de Voza – Nid d'Aigle fermé");
    expect(f?.titre_en).toBe('Col de Voza – Nid d’Aigle section closed');
    expect(f?.texte_fr).toContain('terminus Col de Voza');
    expect(f?.texte_en).toContain('terminate at Col de Voza');
  });

  it('écran de Bellevue : tant qu’un train non limité passe, il l’affiche', () => {
    const { jour } = appliqueTerminusBellevue(ETE, ete(), 13, 'col-de-voza');
    expect(etatTronconFerme(ETE, jour, 'bellevue', h('09:00'))).toBe(false);
  });

  it('hiver : bascule au Col de Voza, écran de Bellevue fermé jusqu’au sommet Bellevue', () => {
    const { jour } = appliqueTerminusBellevue(HIVER, hiver(), 1, 'col-de-voza');
    expect(etatTronconFerme(HIVER, jour, 'bellevue', h('10:00'))).toBe(true);
    const f = fermetureGare(jour, 'bellevue', nomGare, 'bellevue');
    expect(f?.titre_fr).toBe('Tronçon Col de Voza – Bellevue fermé');
    expect(f?.titre_en).toBe('Col de Voza – Bellevue section closed');
  });

  it('bascule Bellevue : l’écran de Bellevue reste ouvert (cas d’origine)', () => {
    const { jour } = appliqueTerminusBellevue(ETE, ete(), 1);
    expect(fermetureGare(jour, 'bellevue', nomGare)).toBeNull();
    expect(fermetureGare(jour, 'nid-daigle', nomGare)?.titre_fr).toBe(
      "Tronçon Bellevue – Nid d'Aigle fermé",
    );
  });
});

describe('deltaBascule : changer la GARE ou la plage, la colonne suit', () => {
  const montees = (valeurs: Record<number, Circulation['terminus']>) =>
    [1, 3, 5, 7].map((numero) => ({
      numero,
      sens: 'montee' as const,
      terminus: valeurs[numero] ?? ('nid-daigle' as const),
    }));
  const vers = (liste: { numero: number; terminus: string }[]) =>
    Object.fromEntries(liste.map((c) => [c.numero, c.terminus]));

  it('même seuil, Bellevue → Col de Voza : la plage descend au Col de Voza', () => {
    const avant = montees({ 5: 'bellevue', 7: 'bellevue' });
    const apres = deltaBascule(
      avant,
      { seuil: 5, gare: 'bellevue' },
      { seuil: 5, gare: 'col-de-voza' },
    );
    expect(vers(apres)).toEqual({
      1: 'nid-daigle',
      3: 'nid-daigle',
      5: 'col-de-voza',
      7: 'col-de-voza',
    });
  });

  it('…et un réglage MANUEL différent de l’ancienne gare reste intact', () => {
    // T7 rétabli au sommet à la main dans une plage Bellevue : la bascule qui
    // passe au Col de Voza ne le reprend pas (la colonne reste prioritaire).
    const avant = montees({ 5: 'bellevue' });
    const apres = deltaBascule(
      avant,
      { seuil: 5, gare: 'bellevue' },
      { seuil: 5, gare: 'col-de-voza' },
    );
    expect(vers(apres)[7]).toBe('nid-daigle');
  });

  it('rétrécir la plage libère ce qui sort, s’il portait la gare de la bascule', () => {
    const avant = montees({ 3: 'col-de-voza', 5: 'col-de-voza', 7: 'col-de-voza' });
    const apres = deltaBascule(
      avant,
      { seuil: 3, gare: 'col-de-voza' },
      { seuil: 7, gare: 'col-de-voza' },
    );
    expect(vers(apres)).toEqual({
      1: 'nid-daigle',
      3: 'nid-daigle',
      5: 'nid-daigle',
      7: 'col-de-voza',
    });
  });

  it('élargir la plage n’affecte que ce qui entre', () => {
    const avant = montees({ 7: 'col-de-voza' });
    const apres = deltaBascule(
      avant,
      { seuil: 7, gare: 'col-de-voza' },
      { seuil: 3, gare: 'col-de-voza' },
    );
    expect(vers(apres)).toEqual({
      1: 'nid-daigle',
      3: 'col-de-voza',
      5: 'col-de-voza',
      7: 'col-de-voza',
    });
  });

  it('rien ne change : la MÊME liste est rendue', () => {
    const avant = montees({ 5: 'col-de-voza' });
    expect(
      deltaBascule(avant, { seuil: 5, gare: 'col-de-voza' }, { seuil: 5, gare: 'col-de-voza' }),
    ).toBe(avant);
  });

  it('deltaTerminusBellevue (Bellevue seul) reste le cas particulier d’origine', () => {
    const jour = ete();
    const apres = deltaTerminusBellevue(jour.circulations, null, 13);
    expect(circ({ ...jour, circulations: apres }, 13).terminus).toBe('bellevue');
    expect(circ({ ...jour, circulations: apres }, 11).terminus).toBe('nid-daigle');
  });
});

describe('trains supplémentaires : même borne haute', () => {
  it('hiver : pas de Nid d’Aigle', () => {
    expect(terminusPossiblesSup(hiver(), HIVER)).toEqual([
      'saint-gervais',
      'motivon',
      'col-de-voza',
      'bellevue',
    ]);
  });

  it('été : jusqu’au Nid d’Aigle ; sans grille, la section seule (ancien appel)', () => {
    expect(terminusPossiblesSup(ete(), ETE).at(-1)).toBe('nid-daigle');
    expect(terminusPossiblesSup({ gare_debut: 'le-fayet', gare_fin: 'nid-daigle' }).at(-1)).toBe(
      'nid-daigle',
    );
  });
});
