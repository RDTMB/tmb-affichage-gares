// En hiver, Bellevue est le sommet : l'embed et la grille du jour ne parlent
// plus du Nid d'Aigle. Défaut mesuré en PRODUCTION le 16/10/2026, grille
// « 2026-2027-hiver », au 12/12/2026 :
//  - l'embed titrait les montées « Vers le Nid d'Aigle » ;
//  - l'onglet Nid d'Aigle de l'embed restait cliquable ;
//  - `grille.html` et la vue « Toute la journée » titraient « Le Fayet → Nid
//    d'Aigle » et gardaient une ligne Nid d'Aigle.
// UNE règle (`sommetDeLaGrille`, src/core/horaires.ts), trois endroits. La
// bascule « terminus Bellevue » et la section exploitée restent ce qu'elles
// étaient : des fermetures annoncées, qui l'emportent.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import grandServiceJson from '../../docs/grilles-historique/2026-ete-grand-service.json';
import {
  appliqueTerminusBellevue,
  fermetureGare,
  generationJour,
  heureVersSecondes,
} from '../core/horaires';
import { parseFeuille } from '../core/import-grille';
import { lireClasseur } from '../core/lecture-xlsx';
import type { GareId, Grille, Jour } from '../core/types';
import {
  etatApresClic,
  NID_DAIGLE_HIVER,
  NON_DESSERVIE,
  ongletRetenu,
  ongletsGares,
  rendEmbed,
  type EntreeRendu,
  type EtatClic,
} from './embed-logique';
import { tableHtml, titresDesSens } from './grille-tableau';

const RACINE = fileURLToPath(new URL('../../', import.meta.url));
const ETE = grandServiceJson as unknown as Grille;
const h = heureVersSecondes;

function grilleHiverReelle(): Grille {
  const fichier = join(RACINE, 'src/core/__fixtures__/2026-2027-hiver-service-unique.xlsx');
  const f = lireClasseur(new Uint8Array(readFileSync(fichier))).find((x) => x.nom === 'Hiver');
  if (!f) throw new Error('feuille « Hiver » absente du fichier de référence');
  const r = parseFeuille(f);
  if (!r.grille || r.erreurs.length > 0)
    throw new Error(r.erreurs.map((e) => e.message).join('\n'));
  return { ...r.grille, periodes: r.periodesProposees };
}

let HIVER: Grille;
let JOUR_HIVER: Jour;
const JOUR_ETE = generationJour(ETE, '2026-08-15');
beforeAll(() => {
  HIVER = grilleHiverReelle();
  JOUR_HIVER = generationJour(HIVER, '2026-12-12');
});

function entree(grille: Grille, jour: Jour, partiel: Partial<EntreeRendu> = {}): EntreeRendu {
  return {
    etat: 'horaires',
    grille,
    grilleDemain: null,
    jour,
    params: null,
    messages: [],
    affluence: [],
    gareUrl: null,
    ongletDemande: null,
    raisonDe: null,
    vue: 'departs',
    maintenant_s: h('08:20'),
    maintenantMs: Date.UTC(2026, 11, 12, 7, 20),
    dateISO: jour.date,
    dateLongue: 'samedi 12 décembre',
    heureSync: '08:19',
    badge: '',
    simulation: null,
    urlInfos: null,
    ...partiel,
  };
}

const titresH2 = (html: string): string[] =>
  [...html.matchAll(/<h2>(.*?)<\/h2>/g)].map((m) => (m[1] ?? '').replace(/<[^>]+>/g, ''));

/** Noms des lignes d'un tableau `tableHtml` (la première cellule de chaque rangée). */
const lignes = (table: string): string[] =>
  [...table.matchAll(/<tr><th>([^<]*)<small>/g)].map((m) => m[1] ?? '');

const nomGare =
  (g: Grille) =>
  (id: GareId): string =>
    g.gares.find((x) => x.id === id)?.nom ?? id;

/**
 * Grille d'été dont aucune montée n'atteint le Nid d'Aigle : le début de
 * saison du document d'été, avant l'ouverture « fin juin ».
 */
function eteSansNidDaigle(): Grille {
  return {
    ...ETE,
    montees: ETE.montees.map((t) => ({
      ...t,
      passages: t.passages.filter((p) => p.gare !== 'nid-daigle'),
    })),
  };
}

/** Été, bascule « terminus Bellevue » pour toute la journée, par la fonction de la supervision. */
function jourEteBascule(): Jour {
  return appliqueTerminusBellevue(ETE, JOUR_ETE, 1).jour;
}

describe('embed — en-tête du bloc montée', () => {
  it('hiver : « Vers Bellevue / Uphill », plus un mot du Nid d’Aigle', () => {
    const html = rendEmbed(entree(HIVER, JOUR_HIVER, { ongletDemande: 'saint-gervais' }));
    const titres = titresH2(html);
    expect(titres).toContain('Vers Bellevue Uphill');
    expect(titres).toContain('Vers Le Fayet Downhill');
    expect(titres.join(' ')).not.toContain('Nid d');
  });

  it('été : « Vers le Nid d’Aigle / Uphill », comme avant', () => {
    const html = rendEmbed(
      entree(ETE, JOUR_ETE, { ongletDemande: 'saint-gervais', maintenant_s: h('10:30') }),
    );
    expect(titresH2(html)).toContain('Vers le Nid d’Aigle Uphill');
  });

  it('été sous la bascule : toujours « Vers le Nid d’Aigle » — la fermeture a son bandeau', () => {
    const html = rendEmbed(
      entree(ETE, jourEteBascule(), { ongletDemande: 'saint-gervais', maintenant_s: h('10:30') }),
    );
    expect(titresH2(html)).toContain('Vers le Nid d’Aigle Uphill');
  });
});

describe('embed — onglets', () => {
  it('hiver : Nid d’Aigle grisé, non cliquable, « pas ouvert pendant la période hivernale »', () => {
    const onglets = ongletsGares(HIVER, JOUR_HIVER, h('08:20'));
    expect(onglets.filter((o) => o.inactif !== null).map((o) => o.id)).toEqual(['nid-daigle']);
    expect(onglets.find((o) => o.id === 'nid-daigle')?.inactif).toBe(NID_DAIGLE_HIVER);
    const html = rendEmbed(entree(HIVER, JOUR_HIVER));
    expect(html).not.toContain('data-gare="nid-daigle"');
    expect(html).toContain(
      'class="onglet inactif" data-inactif="nid-daigle" aria-disabled="true" aria-selected="false" title="Le Nid d’Aigle n’est pas ouvert pendant la période hivernale\u202f! / Nid d’Aigle is closed during the winter season!">Nid d',
    );
  });

  it('été sans Nid d’Aigle (ouverture « fin juin ») : « Non desservie aujourd’hui », jamais « hivernale »', () => {
    const grille = eteSansNidDaigle();
    const jour = generationJour(grille, '2026-06-13');
    const inactif = ongletsGares(grille, jour, h('10:30')).find((o) => o.id === 'nid-daigle')?.inactif;
    expect(inactif).toBe(NON_DESSERVIE);
    expect(rendEmbed(entree(grille, jour, { maintenant_s: h('10:30') }))).not.toContain(
      'hivernale',
    );
  });

  it('hiver, une AUTRE gare non desservie (aucune aujourd’hui) : texte générique', () => {
    const grille: Grille = {
      ...HIVER,
      montees: HIVER.montees.map((t) => ({
        ...t,
        passages: t.passages.filter((p) => p.gare !== 'bellevue' && p.gare !== 'nid-daigle'),
      })),
    };
    const onglets = ongletsGares(grille, generationJour(grille, '2026-12-12'), h('08:20'));
    expect(onglets.find((o) => o.id === 'bellevue')?.inactif).toBe(NON_DESSERVIE);
    expect(onglets.find((o) => o.id === 'nid-daigle')?.inactif).toBe(NID_DAIGLE_HIVER);
  });

  it('toucher un onglet grisé : rien ne s’ouvre, la raison s’affiche sous les onglets', () => {
    const avant: EtatClic = { ongletDemande: 'saint-gervais', vue: 'departs', raisonDe: null };
    const apres = etatApresClic(avant, { inactif: 'nid-daigle' });
    expect(apres).toEqual({ ...avant, raisonDe: 'nid-daigle' });

    const html = rendEmbed(entree(HIVER, JOUR_HIVER, apres));
    expect(html).toContain('class="onglet choisi" data-gare="saint-gervais"');
    expect(html).toContain(
      '</nav><p class="raison-inactif" role="status" aria-live="polite"><span class="fr">Le Nid d’Aigle n’est pas ouvert pendant la période hivernale\u202f!</span> <span class="en" lang="en">Nid d’Aigle is closed during the winter season!</span></p>',
    );
    // Au repos, la zone existe, vide : `aria-live` annonce ce qui y ARRIVE.
    expect(rendEmbed(entree(HIVER, JOUR_HIVER, avant))).toContain(
      '<p class="raison-inactif" role="status" aria-live="polite"></p>',
    );
    // Le toucher d'un autre onglet l'efface, et ouvre celui-là.
    expect(etatApresClic(apres, { gare: 'motivon' })).toEqual({
      ongletDemande: 'motivon',
      vue: 'departs',
      raisonDe: null,
    });
  });

  it('même comportement pour un onglet grisé par une FERMETURE du jour', () => {
    const jour: Jour = { ...JOUR_HIVER, gare_fin: 'motivon' };
    const etat = etatApresClic(
      { ongletDemande: 'le-fayet', vue: 'departs', raisonDe: null },
      { inactif: 'col-de-voza' },
    );
    expect(etat.ongletDemande).toBe('le-fayet');
    const html = rendEmbed(entree(HIVER, jour, etat));
    const raison = fermetureGare(jour, 'col-de-voza', nomGare(HIVER));
    expect(raison).not.toBeNull();
    expect(html).toContain(`aria-live="polite"><span class="fr">${raison?.texte_fr}</span>`);
  });

  it('hiver : `?gare=nid-daigle` ouvre l’onglet par défaut', () => {
    const onglets = ongletsGares(HIVER, JOUR_HIVER, h('08:20'));
    expect(ongletRetenu(onglets, 'nid-daigle')).toBe('le-fayet');
    const html = rendEmbed(entree(HIVER, JOUR_HIVER, { ongletDemande: 'nid-daigle' }));
    expect(html).toContain('class="onglet choisi" data-gare="le-fayet"');
  });

  it('été : tous les onglets actifs', () => {
    const onglets = ongletsGares(ETE, JOUR_ETE, h('10:30'));
    expect(onglets.every((o) => o.inactif === null)).toBe(true);
  });

  it('la raison de FERMETURE l’emporte sur « non desservie » — bascule', () => {
    const jour: Jour = { ...JOUR_HIVER, terminus_bellevue: { a_partir_du_train: 1 } };
    const inactif = ongletsGares(HIVER, jour, h('08:20')).find(
      (o) => o.id === 'nid-daigle',
    )?.inactif;
    expect(inactif).toEqual(fermetureGare(jour, 'nid-daigle', nomGare(HIVER)));
    expect(inactif).not.toBe(NON_DESSERVIE);
    expect(inactif).not.toBe(NID_DAIGLE_HIVER);
  });

  it('la raison de FERMETURE l’emporte sur « non desservie » — section', () => {
    const jour: Jour = { ...JOUR_HIVER, gare_fin: 'bellevue' };
    const inactif = ongletsGares(HIVER, jour, h('08:20')).find(
      (o) => o.id === 'nid-daigle',
    )?.inactif;
    expect(inactif?.texte_fr).toBe('Ligne fermée entre Le Fayet et Bellevue — travaux');
  });

  it('été sous la bascule : Nid d’Aigle grisé par la FERMETURE, comme avant', () => {
    const jour = jourEteBascule();
    const inactif = ongletsGares(ETE, jour, h('10:30')).find((o) => o.id === 'nid-daigle')?.inactif;
    expect(inactif).toEqual(fermetureGare(jour, 'nid-daigle', nomGare(ETE)));
  });
});

describe('grille du jour — titres et lignes (grille.html et vue « Toute la journée »)', () => {
  it('titresDesSens : hiver Le Fayet ↔ Bellevue, été Le Fayet ↔ Nid d’Aigle', () => {
    expect(titresDesSens(HIVER, JOUR_HIVER, nomGare(HIVER))).toEqual({
      montee: 'Montée — Le Fayet → Bellevue',
      descente: 'Descente — Bellevue → Le Fayet',
    });
    expect(titresDesSens(ETE, JOUR_ETE, nomGare(ETE))).toEqual({
      montee: "Montée — Le Fayet → Nid d'Aigle",
      descente: "Descente — Nid d'Aigle → Le Fayet",
    });
    expect(titresDesSens(ETE, jourEteBascule(), nomGare(ETE)).montee).toBe(
      "Montée — Le Fayet → Nid d'Aigle",
    );
  });

  it('tableHtml : hiver, pas de ligne Nid d’Aigle ; été, six lignes', () => {
    const ctx = (grille: Grille, jour: Jour) => ({
      grille,
      jour,
      gare: null,
      machines: [],
      affluence: [],
    });
    for (const sens of ['montee', 'descente'] as const) {
      const hiver = lignes(tableHtml(ctx(HIVER, JOUR_HIVER), sens, h('08:20'), new Map()));
      expect(hiver).toHaveLength(5);
      expect(hiver.some((n) => n.startsWith('Nid d'))).toBe(false);
      const ete = lignes(tableHtml(ctx(ETE, JOUR_ETE), sens, h('10:30'), new Map()));
      expect(ete).toHaveLength(6);
    }
  });

  it('embed `?vue=jour`, hiver : titres « Le Fayet → Bellevue », aucune ligne Nid d’Aigle', () => {
    const html = rendEmbed(entree(HIVER, JOUR_HIVER, { vue: 'jour' }));
    const titres = titresH2(html);
    expect(titres).toEqual([
      'Montée — Le Fayet → Bellevue Ascent',
      'Descente — Bellevue → Le Fayet Descent',
    ]);
    expect(html).not.toMatch(/<tr><th>Nid d/);
  });

  it('grille.html pose ses titres par `titresDesSens`, sans en recopier le gabarit', () => {
    const code = readFileSync(join(RACINE, 'src/pages/grille.ts'), 'utf-8')
      .replace(/\r\n/g, '\n')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(code).toContain('const titres = titresDesSens(grille, jour, nomGare);');
    expect(code).toContain("$('titre-montee').textContent = titres.montee;");
    expect(code).toContain("$('titre-descente').textContent = titres.descente;");
    expect(code).not.toContain('Montée —');
    expect(code).not.toContain('Descente —');
  });
});
