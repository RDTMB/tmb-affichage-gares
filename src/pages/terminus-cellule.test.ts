// BUG du 04/09/2026 : la colonne Terminus MENTAIT sur les trains
// supplémentaires. La cellule ne se ramifiait jamais sur `c.supplementaire`,
// tombait dans la branche générique et rendait un <select> alimenté par
// `circulations.terminus` — colonne que la création d'un renfort renseigne à
// 'nid-daigle' ou 'bellevue' (contrainte CHECK) sans aucun rapport avec le
// terminus choisi par l'agent. Un renfort créé pour le Col de Voza
// s'affichait « Nid d'Aigle ».
//
// Le terminus réel se lit sur les `passages` : le dernier pour une montée, le
// premier pour la gare de départ d'une descente. `terminusReel()` et
// `origineReelle()` sont désormais la SOURCE UNIQUE de l'écran de gare, de la
// grille du jour et de la supervision.
import { describe, expect, it } from 'vitest';

import grandServiceJson from '../../docs/grilles-historique/2026-ete-grand-service.json';
import {
  generationJour,
  heureVersSecondes,
  origineReelle,
  passagesPourGare,
  terminusReel,
  trainsDuJour,
} from '../core/horaires';
import { construitRotationSup } from '../core/train-sup';
import type { Circulation, GareId, Grille, Jour, Sens } from '../core/types';
import { AIDE_TERMINUS_SUP, celluleTerminus } from './supervision-logique';

const GRAND = grandServiceJson as unknown as Grille;
const DATE = '2026-08-15';

const NOMS: Record<GareId, string> = {
  'le-fayet': 'Le Fayet',
  'saint-gervais': 'Saint-Gervais',
  motivon: 'Motivon',
  'col-de-voza': 'Col de Voza',
  bellevue: 'Bellevue',
  'nid-daigle': "Nid d'Aigle",
};
const nomGare = (g: GareId): string => NOMS[g] ?? g;

/** Rotation supplémentaire calculée sur la grille, comme le fait la supervision. */
function rotationSup(
  garesMontee: GareId[],
  depart = '11:20',
): { montee: Circulation; descente: Circulation } {
  const rotation = construitRotationSup(GRAND, {
    heureDepart_s: heureVersSecondes(depart),
    garesMontee,
    garesDescente: [...garesMontee].reverse(),
  });
  const base: Circulation = {
    date: DATE,
    numero: 101,
    sens: 'montee',
    express: false,
    facultatif: false,
    facultatif_actif: false,
    velos: false,
    rame: 'Marie',
    terminus: 'nid-daigle',
    statut: 'ok',
    retard_min: 0,
    motif: null,
    sans_voyageurs: false,
    supplementaire: true,
    passages: rotation.montee,
  };
  return {
    montee: base,
    descente: { ...base, numero: 102, sens: 'descente', passages: rotation.descente },
  };
}

function decode(s: string): string {
  return s.replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

/**
 * TERMINUS QUE LA CELLULE ANNONCE : l'option retenue quand c'est un
 * `<select>`, le texte visible sinon.
 *
 * Le décodage n'est pas cosmétique : `echapper()` rend « Nid d&#39;Aigle », et
 * un `not.toContain("Nid d'Aigle")` sur le HTML brut passerait pour la
 * mauvaise raison — le test ne garderait alors plus rien.
 */
function terminusAnnonce(html: string): string {
  const choisi = /<option [^>]*selected[^>]*>([^<]*)<\/option>/.exec(html);
  return decode(choisi ? (choisi[1] ?? '') : html.replace(/<[^>]*>/g, ' '));
}

function cellule(
  circulation: Circulation,
  sens: Sens,
  extra: Partial<Parameters<typeof celluleTerminus>[0]> = {},
): string {
  return celluleTerminus({
    circulation,
    circulationMontee: sens === 'montee' ? circulation : null,
    sens,
    express: false,
    inactif: false,
    lectureSeule: false,
    nomGare,
    ...extra,
  });
}

// ---------------------------------------------------------------------------

describe('terminusReel / origineReelle : une seule lecture des passages', () => {
  const trains = trainsDuJour(GRAND, generationJour(GRAND, DATE));
  const train = (numero: number): { passages: readonly { gare: GareId }[] } =>
    trains.find((t) => t.numero === numero) ?? { passages: [] };

  it('un train de grille : Le Fayet → Nid d’Aigle', () => {
    expect(origineReelle(train(1))).toBe('le-fayet');
    expect(terminusReel(train(1))).toBe('nid-daigle');
  });

  it('sa descente : Nid d’Aigle → Le Fayet (les passages sont dans le sens de marche)', () => {
    expect(origineReelle(train(2))).toBe('nid-daigle');
    expect(terminusReel(train(2))).toBe('le-fayet');
  });

  it('un train sup limité au Col de Voza', () => {
    const { montee, descente } = rotationSup(['le-fayet', 'col-de-voza']);
    expect(terminusReel(montee)).toBe('col-de-voza');
    expect(origineReelle(descente)).toBe('col-de-voza');
  });

  it('des passages absents ou vides ne font pas planter le rendu', () => {
    expect(terminusReel({ passages: null })).toBeNull();
    expect(origineReelle({ passages: [] })).toBeNull();
    expect(terminusReel({})).toBeNull();
  });
});

describe('Cellule Terminus d’un train SUPPLÉMENTAIRE', () => {
  const { montee, descente } = rotationSup(['le-fayet', 'col-de-voza']);

  it('la montée affiche « Col de Voza », jamais « Nid d’Aigle »', () => {
    const vu = terminusAnnonce(cellule(montee, 'montee'));
    expect(vu).toBe('Col de Voza');
    expect(vu).not.toContain("Nid d'Aigle");
  });

  it('…quelle que soit la valeur de la colonne `terminus`', () => {
    // C'est LE cœur du bug : la colonne ne concerne pas un train sup.
    for (const colonne of ['nid-daigle', 'bellevue'] as const) {
      const vu = terminusAnnonce(cellule({ ...montee, terminus: colonne }, 'montee'));
      expect(vu).toBe('Col de Voza');
      expect(vu).not.toContain("Nid d'Aigle");
      expect(vu).not.toContain('Bellevue');
    }
  });

  it('la descente affiche « Col de Voza » comme origine, pas « Le Fayet »', () => {
    const vu = terminusAnnonce(
      cellule(descente, 'descente', { circulationMontee: { ...montee, terminus: 'nid-daigle' } }),
    );
    expect(vu).toBe('Départ de Col de Voza');
    expect(vu).not.toContain('Le Fayet');
  });

  it('…y compris quand la montée de la rotation est marquée « bellevue »', () => {
    // La colonne de la montée pilote la bascule Bellevue ; elle ne doit pas
    // faire dire « Départ de Bellevue » à un renfort qui part de Voza.
    const vu = terminusAnnonce(
      cellule(descente, 'descente', { circulationMontee: { ...montee, terminus: 'bellevue' } }),
    );
    expect(vu).toBe('Départ de Col de Voza');
    expect(vu).not.toContain('Bellevue');
  });

  it('AUCUN <select> n’est rendu : une écriture sur la colonne serait un faux succès', () => {
    for (const [c, sens] of [
      [montee, 'montee'],
      [descente, 'descente'],
    ] as [Circulation, Sens][]) {
      const html = cellule(c, sens);
      expect(html).not.toContain('<select');
      expect(html).not.toContain('data-action="terminus"');
      // Ni grisée ni verrouillée : la commande n'existe pas du tout.
      expect(html).not.toContain('disabled');
    }
  });

  it('même en lecture seule, aucune commande n’apparaît', () => {
    expect(cellule(montee, 'montee', { lectureSeule: true })).not.toContain('<select');
  });

  it('l’infobulle dit comment le modifier', () => {
    expect(cellule(montee, 'montee')).toContain(AIDE_TERMINUS_SUP);
    expect(AIDE_TERMINUS_SUP).toContain('supprimez ce train et recréez-le');
  });

  it('un renfort jusqu’au sommet reste annoncé au sommet', () => {
    const haut = rotationSup(['le-fayet', 'col-de-voza', 'bellevue', 'nid-daigle']);
    expect(terminusAnnonce(cellule(haut.montee, 'montee'))).toBe("Nid d'Aigle");
    expect(
      terminusAnnonce(cellule(haut.descente, 'descente', { circulationMontee: haut.montee })),
    ).toBe("Départ de Nid d'Aigle");
  });

  it('un renfort limité à Motivon est annoncé à Motivon', () => {
    // Le besoin d'origine : le terminus n'est plus cantonné aux trois du haut.
    const bas = rotationSup(['le-fayet', 'saint-gervais', 'motivon']);
    expect(terminusAnnonce(cellule(bas.montee, 'montee'))).toBe('Motivon');
    expect(
      terminusAnnonce(cellule(bas.descente, 'descente', { circulationMontee: bas.montee })),
    ).toBe('Départ de Motivon');
  });

  it('sans passages, la cellule montre « — » plutôt qu’une gare inventée', () => {
    const vu = terminusAnnonce(cellule({ ...montee, passages: null }, 'montee'));
    expect(vu).toBe('—');
    expect(vu).not.toContain('Col de Voza');
  });

  it('les passages du MOTEUR l’emportent sur ceux enregistrés', () => {
    // Bascule Terminus Bellevue activée APRÈS la création : le moteur tronque
    // le renfort à Bellevue. La supervision doit annoncer ce que les écrans
    // afficheront, pas ce qui dort en base.
    const haut = rotationSup(['le-fayet', 'col-de-voza', 'bellevue', 'nid-daigle']);
    const vu = terminusAnnonce(
      cellule(haut.montee, 'montee', {
        passagesEffectifs: [{ gare: 'le-fayet' }, { gare: 'col-de-voza' }, { gare: 'bellevue' }],
      }),
    );
    expect(vu).toBe('Bellevue');
    expect(vu).not.toContain("Nid d'Aigle");
  });
});

describe('L’écran de gare annonce le MÊME terminus que la supervision', () => {
  /** Terminus tel que l'écran de gare l'affiche (destination du passage). */
  function terminusEcran(jour: Jour, gare: GareId, numero: number): string | null {
    const p = passagesPourGare(GRAND, jour, gare).find((x) => x.numero === numero);
    return p ? nomGare(p.destination) : null;
  }

  it('train SUP limité au Col de Voza : « Col de Voza » des deux côtés', () => {
    const jour = generationJour(GRAND, DATE);
    const { montee, descente } = rotationSup(['le-fayet', 'col-de-voza']);
    jour.circulations.push(montee, descente);
    const ecran = terminusEcran(jour, 'le-fayet', 101);
    expect(ecran).toBe('Col de Voza');
    expect(terminusAnnonce(cellule(montee, 'montee'))).toBe(ecran);
  });

  it('train SUP limité à Motivon : « Motivon » des deux côtés', () => {
    const jour = generationJour(GRAND, DATE);
    const { montee, descente } = rotationSup(['le-fayet', 'saint-gervais', 'motivon']);
    jour.circulations.push(montee, descente);
    const ecran = terminusEcran(jour, 'saint-gervais', 101);
    expect(ecran).toBe('Motivon');
    expect(terminusAnnonce(cellule(montee, 'montee'))).toBe(ecran);
  });

  it('train de GRILLE : « Nid d’Aigle » des deux côtés', () => {
    const jour = generationJour(GRAND, DATE);
    const c = jour.circulations.find((x) => x.numero === 1);
    if (!c) throw new Error('TRAIN 1 absent');
    // Pour un train de grille, la cellule est un <select> : c'est son option
    // RETENUE qui doit correspondre à ce que l'écran annonce.
    expect(terminusEcran(jour, 'le-fayet', 1)).toBe("Nid d'Aigle");
    expect(terminusAnnonce(cellule(c, 'montee'))).toBe("Nid d'Aigle");
  });

  it('rotation limitée à Bellevue : « Bellevue » des deux côtés', () => {
    const jour = generationJour(GRAND, DATE);
    const c = jour.circulations.find((x) => x.numero === 5);
    if (!c) throw new Error('TRAIN 5 absent');
    c.terminus = 'bellevue';
    expect(terminusEcran(jour, 'le-fayet', 5)).toBe('Bellevue');
    // Le « ⚠ » du sélecteur signale l'exception ; la gare, elle, est la même.
    expect(terminusAnnonce(cellule(c, 'montee'))).toBe('Bellevue ⚠');
  });
});

describe('NON-RÉGRESSION : la cellule d’un train de grille est inchangée', () => {
  const jour = generationJour(GRAND, DATE);
  const grille = (numero: number): Circulation => {
    const c = jour.circulations.find((x) => x.numero === numero);
    if (!c) throw new Error(`TRAIN ${numero} absent`);
    return c;
  };

  it('montée normale : le <select> Terminus, avec Nid d’Aigle sélectionné', () => {
    const html = cellule(grille(1), 'montee');
    expect(html).toContain('<select data-action="terminus" data-numero="1"');
    expect(html).toContain('<option value="nid-daigle" selected>Nid d\'Aigle</option>');
    expect(html).toContain('<option value="bellevue" >Bellevue ⚠</option>');
  });

  it('montée limitée : le <select> passe sur Bellevue', () => {
    const html = cellule({ ...grille(1), terminus: 'bellevue' }, 'montee');
    expect(html).toContain('<option value="bellevue" selected>Bellevue ⚠</option>');
  });

  it('lecture seule : le <select> est grisé, pas supprimé', () => {
    const html = cellule(grille(1), 'montee', { lectureSeule: true });
    expect(html).toContain('<select data-action="terminus" data-numero="1" disabled>');
  });

  it('descente d’une rotation normale : « Le Fayet » en texte fixe', () => {
    const html = cellule(grille(2), 'descente', { circulationMontee: grille(1) });
    expect(html).toBe('<span class="term-fixe">Le Fayet</span>');
  });

  it('descente d’une rotation limitée : « Départ de Bellevue »', () => {
    const html = cellule(grille(2), 'descente', {
      circulationMontee: { ...grille(1), terminus: 'bellevue' },
    });
    expect(html).toBe('<span class="term-bv">Départ de Bellevue</span>');
  });

  it('montée EXPRESS dans une plage limitée : « À traiter » et ses deux boutons', () => {
    const c = { ...grille(9), terminus: 'bellevue' as const, facultatif_actif: true };
    const html = cellule(c, 'montee', { express: true, circulationMontee: c });
    expect(html).toContain('À traiter ⚠');
    expect(html).toContain('data-action="express-supprimer" data-numero="9"');
    expect(html).toContain('data-action="express-maintenir" data-numero="9"');
    expect(html).not.toContain('<select');
  });

  it('montée EXPRESS hors plage : « Nid d’Aigle », avec son infobulle', () => {
    const html = cellule(grille(9), 'montee', { express: true });
    expect(html).toBe(
      '<span class="term-fixe" title="Un express ne peut pas être limité à Bellevue">Nid d\'Aigle</span>',
    );
  });

  it('express d’une rotation limitée mais NON activé : « Rotation limitée »', () => {
    const c = { ...grille(9), terminus: 'bellevue' as const };
    const html = cellule(c, 'montee', { express: true, circulationMontee: c, inactif: true });
    expect(html).toBe('<span class="term-fixe">Rotation limitée</span>');
  });

  it('descente EXPRESS d’une rotation limitée : « À traiter » avec son bouton propre', () => {
    const montee = { ...grille(9), terminus: 'bellevue' as const, facultatif_actif: true };
    const html = cellule({ ...grille(10), facultatif_actif: true }, 'descente', {
      express: true,
      circulationMontee: montee,
    });
    expect(html).toContain('data-action="express-maintenir-descente" data-numero="10"');
  });

  it('un train supprimé ne réclame plus d’arbitrage', () => {
    const c = { ...grille(9), terminus: 'bellevue' as const, statut: 'supprime' as const };
    const html = cellule(c, 'montee', { express: true, circulationMontee: c });
    expect(html).toBe('<span class="term-fixe">Rotation limitée</span>');
  });

  it('les passages effectifs n’influencent PAS un train de grille', () => {
    // Ils ne servent qu'au terminus d'un train sup : la cellule d'un train de
    // grille doit rester octet pour octet la même.
    expect(cellule(grille(1), 'montee', { passagesEffectifs: [{ gare: 'bellevue' }] })).toBe(
      cellule(grille(1), 'montee'),
    );
  });
});
