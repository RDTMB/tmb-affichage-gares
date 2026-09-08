// §D — l'aperçu de la supervision doit dire ce que la publication écrit.
//
// LE SIGNALEMENT, laissé ouvert par le lot 6 : quand on rétrécit la plage du
// terminus Bellevue SANS poser de geste manuel, ce que montre l'aperçu et ce
// que la publication écrit ne coïncident pas. La session qui l'a signalé ne
// l'avait pas reproduit.
//
// REPRODUIT ici, et la cause est nette. `appliqueBrouillonJour` superposait le
// DRAPEAU en attente sur la journée publiée sans toucher aux colonnes Terminus
// des circulations. Or c'est la colonne qui commande l'affichage, et la
// publication, elle, libère les montées qui sortent de la plage. Rétrécir la
// plage de 11 à 21 donnait donc : aperçu « TRAIN 11 limité à Bellevue »,
// base « TRAIN 11 au Nid d'Aigle ». L'agent relisait autre chose que ce qu'il
// envoyait.
//
// QUI A RAISON : la publication. Libérer ce qui sort de la plage est le
// comportement voulu, documenté (docs/01 §2.3) et testé depuis le 26/08. C'est
// donc l'aperçu qui est corrigé, en appliquant la même différence de plage —
// `deltaTerminusBellevue`, désormais seule description de la règle.
import { describe, expect, it } from 'vitest';

import grandServiceJson from '../../docs/grilles-historique/2026-ete-grand-service.json';
import { deltaTerminusBellevue, generationJour, seuilMontee } from '../core/horaires';
import type { Circulation, Grille, Jour, TerminusFlag } from '../core/types';
import {
  appliqueBrouillonJour,
  type BrouillonCirculations,
  type BrouillonTerminus,
} from './brouillon';

const grille = grandServiceJson as unknown as Grille;
const DATE = '2026-08-28';

/** Journée publiée, avec une plage DÉJÀ posée en base. */
function jourPublie(plage: TerminusFlag): Jour {
  const jour = generationJour(grille, DATE);
  const borne = plage === false ? null : seuilMontee(plage.a_partir_du_train);
  return {
    ...jour,
    terminus_bellevue: plage,
    circulations: deltaTerminusBellevue(jour.circulations, null, borne),
  };
}

/** Ce que l'APERÇU montre : journée publiée + brouillon. */
function apercu(base: Jour, enAttente: TerminusFlag, modifs: Circulation[] = []): Jour {
  const brouillonTerminus: BrouillonTerminus = new Map([[DATE, enAttente]]);
  const brouillonCirc: BrouillonCirculations = new Map();
  if (modifs.length > 0) {
    brouillonCirc.set(DATE, new Map(modifs.map((c) => [c.numero, c])));
  }
  return appliqueBrouillonJour(base, brouillonCirc, brouillonTerminus);
}

/**
 * Ce que la PUBLICATION écrit, exprimé avec la même règle pure que celle des
 * fournisseurs — ils bornent leurs deux écritures sur les mêmes différences.
 * Les colonnes du brouillon sont appliquées APRÈS, comme à la publication
 * (la bascule passe avant les circulations depuis le 08/09).
 */
function publie(base: Jour, enAttente: TerminusFlag, modifs: Circulation[] = []): Jour {
  const ancien =
    base.terminus_bellevue === false ? null : seuilMontee(base.terminus_bellevue.a_partir_du_train);
  const nouveau = enAttente === false ? null : seuilMontee(enAttente.a_partir_du_train);
  const parNumero = new Map(modifs.map((c) => [c.numero, c]));
  return {
    ...base,
    terminus_bellevue: enAttente,
    circulations: deltaTerminusBellevue(base.circulations, ancien, nouveau).map(
      (c) => parNumero.get(c.numero) ?? c,
    ),
  };
}

function terminus(jour: Jour): Map<number, string> {
  return new Map(
    jour.circulations.filter((c) => c.sens === 'montee').map((c) => [c.numero, c.terminus]),
  );
}

describe('§D — le cas signalé : rétrécir SANS geste manuel', () => {
  it('l’aperçu et la publication disent la même chose', () => {
    // Le cas exact du signalement. Avant correction, l'aperçu rendait
    // « bellevue » pour le TRAIN 11 et la publication « nid-daigle ».
    const base = jourPublie({ a_partir_du_train: 11 });
    expect(terminus(base).get(11)).toBe('bellevue');

    const vu = terminus(apercu(base, { a_partir_du_train: 21 }));
    const ecrit = terminus(publie(base, { a_partir_du_train: 21 }));
    expect(vu.get(11), 'TRAIN 11 tel que l’aperçu le montre').toBe('nid-daigle');
    expect([...vu]).toEqual([...ecrit]);
  });

  it('le drapeau lui-même suit le brouillon, comme avant', () => {
    const base = jourPublie({ a_partir_du_train: 11 });
    expect(apercu(base, { a_partir_du_train: 21 }).terminus_bellevue).toEqual({
      a_partir_du_train: 21,
    });
    expect(apercu(base, false).terminus_bellevue).toBe(false);
  });
});

describe('l’aperçu égale la publication sur toute la matrice', () => {
  // Les couples (plage publiée, plage en attente) qui couvrent élargissement,
  // rétrécissement, décochage, cochage et report à l'identique.
  const plages: TerminusFlag[] = [
    false,
    { a_partir_du_train: 1 },
    { a_partir_du_train: 11 },
    { a_partir_du_train: 16 }, // pair : normalisé vers la montée 15
    { a_partir_du_train: 21 },
    { a_partir_du_train: 25 },
  ];

  for (const publiee of plages) {
    for (const enAttente of plages) {
      const nom = (f: TerminusFlag) => (f === false ? 'décoché' : `T${f.a_partir_du_train}`);
      it(`${nom(publiee)} → ${nom(enAttente)}`, () => {
        const base = jourPublie(publiee);
        expect([...terminus(apercu(base, enAttente))]).toEqual([
          ...terminus(publie(base, enAttente)),
        ]);
      });
    }
  }
});

describe('la colonne reste prioritaire dans l’aperçu aussi', () => {
  it('un geste manuel l’emporte sur le pré-remplissage, comme à la publication', () => {
    // C'est M-21 vu depuis l'aperçu : la bascule pré-remplit, la colonne
    // tranche. L'ordre à l'intérieur d'`appliqueBrouillonJour` est le même
    // qu'à la publication — bascule d'abord, colonnes ensuite.
    const base = jourPublie({ a_partir_du_train: 1 });
    const t11 = base.circulations.find((c) => c.numero === 11);
    if (!t11) throw new Error('TRAIN 11 absent');
    const maMain: Circulation = { ...t11, terminus: 'bellevue' };

    const vu = terminus(apercu(base, { a_partir_du_train: 15 }, [maMain]));
    const ecrit = terminus(publie(base, { a_partir_du_train: 15 }, [maMain]));
    expect(vu.get(11), 'TRAIN 11 limité à la main').toBe('bellevue');
    expect(vu.get(13), 'TRAIN 13 libéré par le rétrécissement').toBe('nid-daigle');
    expect(vu.get(15), 'TRAIN 15 dans la plage').toBe('bellevue');
    expect([...vu]).toEqual([...ecrit]);
  });

  it('sans brouillon de terminus, l’aperçu ne touche à rien', () => {
    // Une modification de circulation seule ne doit pas déclencher de
    // recalcul de plage : la journée publiée fait foi pour le reste.
    const base = jourPublie({ a_partir_du_train: 11 });
    const brouillonCirc: BrouillonCirculations = new Map();
    const t3 = base.circulations.find((c) => c.numero === 3);
    if (!t3) throw new Error('TRAIN 3 absent');
    brouillonCirc.set(DATE, new Map([[3, { ...t3, statut: 'retard', retard_min: 5 }]]));
    const vu = appliqueBrouillonJour(base, brouillonCirc, new Map());
    expect([...terminus(vu)]).toEqual([...terminus(base)]);
    expect(vu.circulations.find((c) => c.numero === 3)?.retard_min).toBe(5);
  });

  it('aucun brouillon du tout : la même référence est rendue', () => {
    // Le court-circuit d'origine, qui évite de reconstruire la journée à
    // chaque rendu — il ne doit pas disparaître avec le correctif.
    const base = jourPublie({ a_partir_du_train: 11 });
    expect(appliqueBrouillonJour(base, new Map(), new Map())).toBe(base);
  });
});

describe('deltaTerminusBellevue — la règle, seule et pure', () => {
  const montees = (
    bornes: { ancien: number | null; nouveau: number | null },
    depart: number | null,
  ) => {
    const jour = generationJour(grille, DATE);
    const base = deltaTerminusBellevue(jour.circulations, null, depart);
    return new Map(
      deltaTerminusBellevue(base, bornes.ancien, bornes.nouveau)
        .filter((c) => c.sens === 'montee')
        .map((c) => [c.numero, c.terminus]),
    );
  };

  it('élargir ne libère rien', () => {
    const r = montees({ ancien: 21, nouveau: 11 }, 21);
    expect(r.get(11)).toBe('bellevue');
    expect(r.get(21)).toBe('bellevue');
    expect(r.get(9)).toBe('nid-daigle');
  });

  it('rétrécir libère seulement l’intervalle qui sort', () => {
    const r = montees({ ancien: 11, nouveau: 21 }, 11);
    expect(r.get(11)).toBe('nid-daigle');
    expect(r.get(19)).toBe('nid-daigle');
    expect(r.get(21)).toBe('bellevue');
  });

  it('décocher libère tout', () => {
    const r = montees({ ancien: 11, nouveau: null }, 11);
    for (const [numero, t] of r) expect(t, `TRAIN ${numero}`).toBe('nid-daigle');
  });

  it('une limitation MANUELLE hors plage survit à un élargissement', () => {
    // LE cas qui distingue un delta d'un recalcul complet, et le seul. Un
    // recalcul rendrait « nid-daigle » à toute montée sous la borne, geste de
    // l'agent compris — c'est M-21. Ici la borne descend de 21 à 15, et le
    // TRAIN 11 limité à la main reste en dehors : rien ne doit le toucher.
    const jour = generationJour(grille, DATE);
    const posee = deltaTerminusBellevue(jour.circulations, null, 21);
    const aLaMain = posee.map((c) =>
      c.numero === 11 && c.sens === 'montee' ? { ...c, terminus: 'bellevue' as const } : c,
    );
    const apres = deltaTerminusBellevue(aLaMain, 21, 15);
    const parNumero = new Map(
      apres.filter((c) => c.sens === 'montee').map((c) => [c.numero, c.terminus]),
    );
    expect(parNumero.get(11), 'TRAIN 11 limité à la main, hors plage').toBe('bellevue');
    expect(parNumero.get(13), 'TRAIN 13 hors plage, jamais limité').toBe('nid-daigle');
    expect(parNumero.get(15), 'TRAIN 15 qui ENTRE dans la plage').toBe('bellevue');
  });

  it('une limitation manuelle hors plage survit aussi à un RÉTRÉCISSEMENT lointain', () => {
    // Borne de 15 à 21 : le TRAIN 11 est sous les deux, il ne sort donc de
    // rien. Un recalcul le libérerait quand même.
    const jour = generationJour(grille, DATE);
    const posee = deltaTerminusBellevue(jour.circulations, null, 15);
    const aLaMain = posee.map((c) =>
      c.numero === 11 && c.sens === 'montee' ? { ...c, terminus: 'bellevue' as const } : c,
    );
    const apres = deltaTerminusBellevue(aLaMain, 15, 21);
    const parNumero = new Map(
      apres.filter((c) => c.sens === 'montee').map((c) => [c.numero, c.terminus]),
    );
    expect(parNumero.get(11), 'TRAIN 11 limité à la main, sous les deux bornes').toBe('bellevue');
    expect(parNumero.get(15), 'TRAIN 15 qui SORT de la plage').toBe('nid-daigle');
    expect(parNumero.get(21), 'TRAIN 21 dans la nouvelle plage').toBe('bellevue');
  });

  it('plage inchangée : la liste est rendue TELLE QUELLE', () => {
    // Même référence : c'est ce qui garantit qu'une bascule rejouée n'écrase
    // aucun geste manuel (M-21).
    const jour = generationJour(grille, DATE);
    const posee = deltaTerminusBellevue(jour.circulations, null, 15);
    expect(deltaTerminusBellevue(posee, 15, 15)).toBe(posee);
  });

  it('les DESCENTES ne sont jamais touchées', () => {
    // La descente d'une rotation limitée part de Bellevue, mais c'est le
    // moteur qui le déduit de la montée — pas cette colonne.
    const jour = generationJour(grille, DATE);
    const apres = deltaTerminusBellevue(jour.circulations, null, 1);
    for (const c of apres.filter((x) => x.sens === 'descente')) {
      const avant = jour.circulations.find((x) => x.numero === c.numero);
      expect(c.terminus, `TRAIN ${c.numero}`).toBe(avant?.terminus);
    }
  });

  it('un numéro pair vise la montée de sa rotation', () => {
    expect(seuilMontee(16)).toBe(15);
    expect(seuilMontee(15)).toBe(15);
    expect(seuilMontee(2)).toBe(1);
    expect(seuilMontee(1)).toBe(1);
    expect(seuilMontee(0)).toBe(1);
    expect(seuilMontee(-4)).toBe(1);
  });
});
