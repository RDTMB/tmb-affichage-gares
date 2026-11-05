// La grille VIVANTE (lot B du 05/11/2026) : où est chaque train, où l'on pose
// son rond, quelle colonne est éclairée, et le vocabulaire des sens.
//
//  - un train À QUAI a son rond sur la ligne de sa gare ; un train EN ROUTE a
//    son rond à MI-CHEMIN entre la ligne de la gare qu'il vient de quitter et
//    celle de la gare suivante DE SES PASSAGES (décision de l'exploitant) ;
//  - l'embed n'éclaire AUCUNE colonne, `grille.html` garde la sienne ;
//  - « Uphill / Downhill » n'existe plus nulle part où un voyageur lit.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import grandServiceJson from '../../docs/grilles-historique/2026-ete-grand-service.json';
import {
  appliqueTerminusBellevue,
  generationJour,
  heureVersSecondes,
  positionsTrains,
} from '../core/horaires';
import type { GareId, Grille, Jour } from '../core/types';
import { rendEmbed, type EntreeRendu } from './embed-logique';
import { styleRame } from './affichage-commun';
import { ancrePosition } from './grille-logique';
import { fleche, tableHtml, titresDesSens } from './grille-tableau';

const RACINE = fileURLToPath(new URL('../../', import.meta.url));
const GRAND = grandServiceJson as unknown as Grille;
const h = heureVersSecondes;
const JOUR = generationJour(GRAND, '2026-07-15');

/** La journée du 15/07/2026 avec les facultatifs demandés activés (TRAINS 3 et 9 sont facultatifs). */
function jourAvec(...numeros: number[]): Jour {
  const jour = generationJour(GRAND, '2026-07-15');
  for (const n of numeros) circ(jour, n).facultatif_actif = true;
  return jour;
}

function circ(jour: Jour, numero: number) {
  const c = jour.circulations.find((x) => x.numero === numero);
  if (!c) throw new Error(`TRAIN ${numero} absent`);
  return c;
}

/** Le tableau d'un sens, tel que `grille.html` le construit (colonne éclairée comprise). */
function table(
  sens: 'montee' | 'descente',
  quand: string,
  jour: Jour = JOUR,
  extra: { gare?: GareId | null; sansProchain?: boolean; grille?: Grille } = {},
): string {
  const maintenant = h(quand);
  const grille = extra.grille ?? GRAND;
  const positions = new Map(positionsTrains(grille, jour, maintenant).map((p) => [p.numero, p]));
  const ctx = {
    grille,
    jour,
    gare: extra.gare ?? null,
    machines: [],
    affluence: [],
    ...(extra.sansProchain ? { sansProchain: true } : {}),
  };
  return tableHtml(ctx, sens, maintenant, positions);
}

interface Rond {
  /** Nom de la gare dont la LIGNE porte le rond. */
  ligne: string;
  /** Numéro du train de la colonne, d'après l'en-tête. */
  train: number;
  enRoute: boolean;
  saut: number | null;
}

/** Tous les ronds d'un tableau : sur quelle ligne, dans quelle colonne, à quai ou non. */
function ronds(html: string): Rond[] {
  const [entete = '', corps = ''] = html.split('<tbody>');
  const numeros = [...entete.matchAll(/<span class="num">TRAIN (\d+)/g)].map((m) => Number(m[1]));
  const sortie: Rond[] = [];
  for (const ligne of corps.split('<tr>').slice(1)) {
    const nom = /^<th>([^<]*)</.exec(ligne)?.[1] ?? '?';
    const cellules = ligne.split(/<td[ >]/).slice(1);
    cellules.forEach((cellule, i) => {
      const m =
        /<span class="train-pos( en-route)?" style="[^"]*?(?:--saut:(\d+);)?"><\/span>/.exec(
          cellule,
        );
      if (m)
        sortie.push({
          ligne: nom.replace('&#39;', "'"),
          train: numeros[i] ?? -1,
          enRoute: m[1] !== undefined,
          saut: m[2] !== undefined ? Number(m[2]) : null,
        });
    });
  }
  return sortie;
}

// ---------------------------------------------------------------------------
// 1. positionsTrains : à quai, ou en route vers la gare SUIVANTE DE SES PASSAGES
// ---------------------------------------------------------------------------

describe('positionsTrains — à quai ou en route', () => {
  const de = (quand: string, numero: number, jour: Jour = JOUR) =>
    positionsTrains(GRAND, jour, h(quand)).find((p) => p.numero === numero);

  it('à quai : arrivée ≤ maintenant < départ de la gare', () => {
    // TRAIN 1 : arrive à Saint-Gervais 07:10:00, en repart 07:15:00
    expect(de('07:10:00', 1)).toMatchObject({ gare: 'saint-gervais', vers: null });
    expect(de('07:14:59', 1)).toMatchObject({ gare: 'saint-gervais', vers: null });
  });

  it('en route dès le départ de la gare, vers la gare suivante', () => {
    expect(de('07:15:00', 1)).toMatchObject({ gare: 'saint-gervais', vers: 'motivon' });
    expect(de('07:26:29', 1)).toMatchObject({ gare: 'saint-gervais', vers: 'motivon' });
    // arrivé à Motivon (07:26:30) : de nouveau à quai, à Motivon
    expect(de('07:26:30', 1)).toMatchObject({ gare: 'motivon', vers: null });
  });

  it('l’exemple de l’exploitant : TRAIN 3 parti du Col de Voza vers Bellevue', () => {
    // TRAIN 3 (facultatif, activé) : Col de Voza 08:40:30 → 08:42:30, Bellevue 08:47:30
    expect(de('08:45:00', 3, jourAvec(3))).toMatchObject({
      gare: 'col-de-voza',
      vers: 'bellevue',
      sens: 'montee',
    });
  });

  it('à l’origine : en ligne dès l’heure de départ, et déjà en route', () => {
    expect(de('06:59:59', 1)).toBeUndefined();
    // départ 07:00:00 : un train à l'heure ne reste pas à quai de son origine
    expect(de('07:00:00', 1)).toMatchObject({ gare: 'le-fayet', vers: 'saint-gervais' });
    expect(de('07:03:00', 1)).toMatchObject({ gare: 'le-fayet', vers: 'saint-gervais' });
  });

  it('au terminus : à quai jusqu’à l’arrivée incluse, puis plus de rond', () => {
    expect(de('08:05:30', 1)).toMatchObject({ gare: 'nid-daigle', vers: null });
    expect(de('08:05:31', 1)).toBeUndefined();
  });

  it('descente : TRAIN 6 parti de Bellevue vers le Col de Voza', () => {
    // TRAIN 6 : Bellevue 10:31:30 → 10:33:30, Col de Voza 10:39:30
    expect(de('10:35:00', 6)).toMatchObject({
      gare: 'bellevue',
      vers: 'col-de-voza',
      sens: 'descente',
    });
    expect(de('10:32:00', 6)).toMatchObject({ gare: 'bellevue', vers: null });
  });

  it('express : la gare suivante est celle de SES passages, pas la voisine de la ligne', () => {
    // TRAIN 9 (express) : Motivon départ 10:57:30, puis Nid d'Aigle 11:30:30
    expect(de('11:00:00', 9, jourAvec(9))).toMatchObject({ gare: 'motivon', vers: 'nid-daigle' });
  });

  it('retard : le décalage s’applique aux deux heures, un train retardé est à quai à son origine', () => {
    const jour = generationJour(GRAND, '2026-07-15');
    Object.assign(circ(jour, 1), { statut: 'retard', retard_min: 10, motif: 'Météo' });
    // départ théorique 07:00, réel 07:10 : à 07:02 il est encore à quai au Fayet
    expect(de('07:02:00', 1, jour)).toMatchObject({ gare: 'le-fayet', vers: null });
    expect(de('07:09:59', 1, jour)).toMatchObject({ gare: 'le-fayet', vers: null });
    expect(de('07:10:00', 1, jour)).toMatchObject({ gare: 'le-fayet', vers: 'saint-gervais' });
    // arrivée réelle à Saint-Gervais : 07:10 + 10 min = 07:20
    expect(de('07:19:59', 1, jour)).toMatchObject({ gare: 'le-fayet', vers: 'saint-gervais' });
    expect(de('07:20:00', 1, jour)).toMatchObject({ gare: 'saint-gervais', vers: null });
  });

  it('un train supprimé n’a ni position ni destination', () => {
    const jour = generationJour(GRAND, '2026-07-15');
    Object.assign(circ(jour, 1), { statut: 'supprime' });
    expect(de('07:30:00', 1, jour)).toBeUndefined();
  });

  it('montée limitée à Bellevue : jamais « en route » vers un Nid d’Aigle qu’elle ne dessert pas', () => {
    const jour = appliqueTerminusBellevue(GRAND, generationJour(GRAND, '2026-07-15'), 1).jour;
    // TRAIN 1 est limité à Bellevue : arrivé 07:47:30, c'est son terminus
    expect(de('07:47:00', 1, jour)).toMatchObject({ gare: 'col-de-voza', vers: 'bellevue' });
    expect(de('07:47:30', 1, jour)).toMatchObject({ gare: 'bellevue', vers: null });
    expect(de('07:49:00', 1, jour)).toBeUndefined();
  });

  it('pure : l’heure est injectée, les entrées ne sont pas modifiées', () => {
    const avant = JSON.stringify(JOUR);
    expect(positionsTrains(GRAND, JOUR, h('07:30:00'))).toEqual(
      positionsTrains(GRAND, JOUR, h('07:30:00')),
    );
    expect(JSON.stringify(JOUR)).toBe(avant);
  });
});

// ---------------------------------------------------------------------------
// 2. ancrePosition : sur les lignes AFFICHÉES, jamais sur l'ordre de la ligne
// ---------------------------------------------------------------------------

describe('ancrePosition', () => {
  const MONTEE: GareId[] = [
    'le-fayet',
    'saint-gervais',
    'motivon',
    'col-de-voza',
    'bellevue',
    'nid-daigle',
  ];
  const DESCENTE = [...MONTEE].reverse();

  it('à quai : sur la ligne de la gare', () => {
    expect(ancrePosition(MONTEE, { gare: 'motivon', vers: null })).toEqual({ ligne: 2, saut: 0 });
  });

  it('en route entre deux gares voisines : saut de 1 ligne', () => {
    expect(ancrePosition(MONTEE, { gare: 'col-de-voza', vers: 'bellevue' })).toEqual({
      ligne: 3,
      saut: 1,
    });
  });

  it('descente : calculé sur les lignes AFFICHÉES (tableau inversé), le train descend', () => {
    expect(ancrePosition(DESCENTE, { gare: 'bellevue', vers: 'col-de-voza' })).toEqual({
      ligne: 1,
      saut: 1,
    });
    expect(ancrePosition(DESCENTE, { gare: 'saint-gervais', vers: 'le-fayet' })).toEqual({
      ligne: 4,
      saut: 1,
    });
  });

  it('express : g1 et g2 sont ses passages, le rond traverse les lignes sautées', () => {
    expect(ancrePosition(MONTEE, { gare: 'motivon', vers: 'nid-daigle' })).toEqual({
      ligne: 2,
      saut: 3,
    });
    expect(ancrePosition(DESCENTE, { gare: 'nid-daigle', vers: 'motivon' })).toEqual({
      ligne: 0,
      saut: 3,
    });
  });

  it('gare d’arrivée sans ligne (retirée) : retombe sur la ligne de départ, à quai', () => {
    const sansNid = MONTEE.slice(0, 5);
    expect(ancrePosition(sansNid, { gare: 'bellevue', vers: 'nid-daigle' })).toEqual({
      ligne: 4,
      saut: 0,
    });
  });

  it('gare de départ sans ligne : la ligne affichée la plus proche, sans inventer', () => {
    const sansNid = MONTEE.slice(0, 5);
    expect(ancrePosition(sansNid, { gare: 'nid-daigle', vers: null })).toEqual({
      ligne: 4,
      saut: 0,
    });
    // section Le Fayet → Motivon : le Col de Voza est plus proche de Motivon
    expect(ancrePosition(MONTEE.slice(0, 3), { gare: 'col-de-voza', vers: 'bellevue' })).toEqual({
      ligne: 2,
      saut: 0,
    });
  });

  it('à égalité de distance, la ligne la plus basse du tableau (celle vers laquelle on roule)', () => {
    expect(ancrePosition(['le-fayet', 'motivon'], { gare: 'saint-gervais', vers: null })).toEqual({
      ligne: 1,
      saut: 0,
    });
    expect(ancrePosition(['motivon', 'le-fayet'], { gare: 'saint-gervais', vers: null })).toEqual({
      ligne: 1,
      saut: 0,
    });
  });

  it('des données incohérentes (arrivée plus haut que le départ) ne déplacent pas le rond', () => {
    expect(ancrePosition(MONTEE, { gare: 'bellevue', vers: 'motivon' })).toEqual({
      ligne: 4,
      saut: 0,
    });
  });

  it('aucune ligne : pas de rond', () => {
    expect(ancrePosition([], { gare: 'motivon', vers: null })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Le rond dans le tableau
// ---------------------------------------------------------------------------

describe('tableHtml — le rond à quai, en route, express, gare retirée', () => {
  it('à quai : sur la ligne de la gare, sans décalage', () => {
    expect(ronds(table('montee', '07:12:00'))).toEqual([
      { ligne: 'Saint-Gervais', train: 1, enRoute: false, saut: null },
    ]);
  });

  it('en route : dans la cellule de la gare quittée, à un saut, dans la colonne du train', () => {
    expect(ronds(table('montee', '08:45:00', jourAvec(3)))).toEqual([
      { ligne: 'Col de Voza', train: 3, enRoute: true, saut: 1 },
    ]);
  });

  it('descente : la cellule de la gare quittée, lue sur le tableau inversé', () => {
    expect(ronds(table('descente', '10:35:00'))).toEqual([
      { ligne: 'Bellevue', train: 6, enRoute: true, saut: 1 },
    ]);
    // le sens opposé ne porte pas le rond d'un train de l'autre sens
    expect(ronds(table('montee', '10:35:00')).map((r) => r.train)).not.toContain(6);
  });

  it('express : un saut de trois lignes de Motivon au Nid d’Aigle', () => {
    const jour = jourAvec(9);
    const r = ronds(table('montee', '11:00:00', jour)).find((x) => x.train === 9);
    expect(r).toEqual({ ligne: 'Motivon', train: 9, enRoute: true, saut: 3 });
  });

  it('gare retirée du tableau : rond à quai sur la ligne affichée la plus proche, rien d’inventé', () => {
    // Aucune montée n'atteint plus le Nid d'Aigle : le tableau n'a plus sa ligne.
    // Les descentes, elles, en partent encore : le TRAIN 2 y est parti à 08:13:30.
    const sansNid: Grille = {
      ...GRAND,
      montees: GRAND.montees.map((t) => ({
        ...t,
        passages: t.passages.filter((p) => p.gare !== 'nid-daigle'),
      })),
    };
    const jour = generationJour(sansNid, '2026-07-15');
    expect(positionsTrains(sansNid, jour, h('08:20:00')).find((p) => p.numero === 2)).toMatchObject(
      { gare: 'nid-daigle', vers: 'bellevue' },
    );
    const html = table('descente', '08:20:00', jour, { grille: sansNid });
    expect(html).not.toMatch(/<tr><th>Nid d/);
    expect(ronds(html)).toEqual([{ ligne: 'Bellevue', train: 2, enRoute: false, saut: null }]);
  });

  it('le style de la rame est conservé sur le rond en route', () => {
    const html = table('montee', '08:45:00', jourAvec(3));
    expect(html).toMatch(/class="train-pos en-route" style="background:[^"]+--saut:1;"/);
  });
});

// ---------------------------------------------------------------------------
// 4. Colonne éclairée : l'embed jamais, grille.html comme avant
// ---------------------------------------------------------------------------

describe('colonne éclairée', () => {
  const eclairee = (html: string): boolean => /class="[^"]*\bnext\b/.test(html);

  it('grille.html garde son éclairage, avec ou sans gare', () => {
    expect(eclairee(table('montee', '07:30:00'))).toBe(true);
    expect(eclairee(table('montee', '07:30:00', JOUR, { gare: 'saint-gervais' }))).toBe(true);
  });

  it('`sansProchain` supprime th.next ET td.next, même sans gare', () => {
    expect(eclairee(table('montee', '07:30:00', JOUR, { sansProchain: true }))).toBe(false);
    expect(
      eclairee(table('montee', '07:30:00', JOUR, { gare: 'saint-gervais', sansProchain: true })),
    ).toBe(false);
  });

  it('l’embed n’éclaire aucune colonne, quel que soit l’onglet choisi', () => {
    const e = (partiel: Partial<EntreeRendu>): EntreeRendu => ({
      etat: 'horaires',
      grille: GRAND,
      grilleDemain: null,
      jour: JOUR,
      params: null,
      messages: [],
      affluence: [],
      gareUrl: null,
      ongletDemande: null,
      raisonDe: null,
      vue: 'jour',
      maintenant_s: h('07:30:00'),
      maintenantMs: Date.UTC(2026, 6, 15, 5, 30),
      dateISO: '2026-07-15',
      dateLongue: 'mercredi 15 juillet',
      heureSync: '07:29',
      badge: '',
      simulation: null,
      urlInfos: null,
      ...partiel,
    });
    for (const onglet of [null, 'le-fayet', 'saint-gervais', 'bellevue'] as const) {
      const html = rendEmbed(e({ ongletDemande: onglet }));
      expect(html).toContain('<table class="grille">');
      expect(eclairee(html), String(onglet)).toBe(false);
    }
  });

  it('le code de l’embed pose `sansProchain`, celui de grille.html ne le pose pas', () => {
    const lire = (f: string): string => readFileSync(join(RACINE, f), 'utf-8');
    expect(lire('src/pages/embed-logique.ts')).toContain('sansProchain: true');
    expect(lire('src/pages/grille.ts')).not.toContain('sansProchain');
  });
});

// ---------------------------------------------------------------------------
// 5. Un seul vocabulaire : « Montée / Ascent », « Descente / Descent »
// ---------------------------------------------------------------------------

describe('vocabulaire des sens', () => {
  it('titres : le trajet en grand, le sens à côté en plus petit', () => {
    const t = titresDesSens(GRAND, JOUR, (id) => GRAND.gares.find((g) => g.id === id)?.nom ?? id);
    expect(t.montee).toContain('<span class="trajet">Le Fayet → Nid d&#39;Aigle</span>');
    expect(t.montee).toContain('<span class="en sens-mot">Montée / Ascent</span>');
    expect(t.descente).toContain('<span class="trajet">Nid d&#39;Aigle → Le Fayet</span>');
    expect(t.descente).toContain('<span class="en sens-mot">Descente / Descent</span>');
  });

  it('un nom de gare venu de la base est échappé', () => {
    const t = titresDesSens(GRAND, JOUR, () => '<img src=x onerror=alert(1)>');
    expect(t.montee).not.toContain('<img');
    expect(t.montee).toContain('&lt;img');
  });

  it('« Uphill » et « Downhill » n’existent plus dans le HTML rendu de l’embed', () => {
    const base = {
      etat: 'horaires' as const,
      grille: GRAND,
      grilleDemain: null,
      jour: JOUR,
      params: null,
      messages: [],
      affluence: [],
      gareUrl: null,
      raisonDe: null,
      maintenant_s: h('10:30:00'),
      maintenantMs: Date.UTC(2026, 6, 15, 8, 30),
      dateISO: '2026-07-15',
      dateLongue: 'mercredi 15 juillet',
      heureSync: '10:29',
      badge: '',
      simulation: null,
      urlInfos: null,
    };
    for (const vue of ['departs', 'jour'] as const) {
      for (const onglet of [null, 'le-fayet', 'saint-gervais', 'motivon', 'bellevue'] as const) {
        const html = rendEmbed({ ...base, vue, ongletDemande: onglet });
        expect(html, `${vue}/${onglet}`).not.toMatch(/uphill|downhill|ascending|descending/i);
        expect(html, `${vue}/${onglet}`).toMatch(/Montée \/ Ascent/);
      }
    }
    const departs = rendEmbed({ ...base, vue: 'departs', ongletDemande: 'saint-gervais' });
    expect(departs).toContain('Vers le Nid d’Aigle');
    expect(departs).toContain('To Nid d’Aigle');
    expect(departs).toContain('Descente / Descent');
    expect(departs).toContain('To Le Fayet');
  });

  it('aucune formulation concurrente dans ce qu’un voyageur lit (sources et pages)', () => {
    const fichiers = [
      'src/pages/embed-logique.ts',
      'src/pages/grille-tableau.ts',
      'src/pages/grille.ts',
      'src/pages/ecran.ts',
      'embed.html',
      'grille.html',
      'ecran.html',
    ];
    for (const f of fichiers) {
      const code = readFileSync(join(RACINE, f), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(code, f).not.toMatch(/uphill|downhill/i);
      // « Ascent » / « Descent » ne s'écrivent que collés au mot français
      expect(code, f).not.toMatch(/>\s*(Ascent|Descent)\s*</);
      expect(code, f).not.toMatch(/'(Ascent|Descent)'/);
    }
  });

  it('grille.html pose le même rendu que `titresDesSens` : plus de « Ascent » en dur', () => {
    const html = readFileSync(join(RACINE, 'grille.html'), 'utf-8');
    expect(html).toContain('Montée / Ascent');
    expect(html).toContain('Descente / Descent');
    expect(html).not.toMatch(/Montée —|Descente —/);
  });
});

// ---------------------------------------------------------------------------
// 6. Les règles CSS dont dépend le rond, et la pleine largeur
// ---------------------------------------------------------------------------
// Vitest n'a pas de navigateur : ces règles ne se mesurent qu'à la main (voir la
// PR). Ce garde-fou verrouille ce que la mesure a établi, pour qu'un « nettoyage »
// du CSS ne le défasse pas en silence — sans `z-index`, la cellule de la ligne
// suivante COUVRE le rond (constaté au navigateur le 05/11/2026).

describe('CSS — pleine largeur, rond au-dessus des cellules, sous la colonne collante', () => {
  const css = (f: string): string =>
    readFileSync(join(RACINE, f), 'utf-8')
      .replace(/\r\n/g, '\n')
      .replace(/\/\*[\s\S]*?\*\//g, '');
  /** Corps de la PREMIÈRE règle dont le sélecteur est exactement celui-ci. */
  const regle = (source: string, selecteur: string): string => {
    // En début de ligne, suivi de « { » : « .train-pos » ne se confond pas avec
    // « .train-pos.en-route », ni avec une règle imbriquée dans un @media.
    const debut = source.indexOf(`\n${selecteur} {`);
    if (debut < 0) throw new Error(`règle « ${selecteur} » introuvable`);
    const ouvre = source.indexOf('{', debut);
    return source.slice(ouvre + 1, source.indexOf('}', ouvre));
  };
  const embed = css('src/styles/embed.css');
  const grille = css('src/styles/grille.css');

  it('le tableau de l’embed prend toute la largeur du cadre, et le cadre défile', () => {
    expect(regle(embed, 'table.grille')).toMatch(/width:\s*100%/);
    expect(regle(embed, '.defile')).toMatch(/overflow-x:\s*auto/);
    // jamais de largeur fixe : le tableau doit pouvoir dépasser le cadre (téléphone)
    expect(regle(embed, 'table.grille')).not.toMatch(/table-layout:\s*fixed/);
  });

  const SEL_EMBED_BASE = 'table.grille td .train-pos,\ntable.grille td .train-fleche';
  const SEL_EMBED_ROUTE = 'table.grille td .train-pos.en-route,\ntable.grille td .train-fleche';

  it('embed : le rond est posé hors flux sur la voie, au-dessus des cellules voisines', () => {
    const r = regle(embed, SEL_EMBED_BASE);
    expect(r).toMatch(/position:\s*absolute/);
    expect(r).toMatch(/left:\s*var\(--voie-rond\)/);
    expect(r).toMatch(/margin:\s*0/);
    expect(r).toMatch(/transform:\s*translate\(-50%, -50%\)/);
    expect(r).toMatch(/z-index:\s*2/);
  });

  it('embed : en route, la hauteur est calée sur --saut, pour le rond comme pour la flèche', () => {
    const r = regle(embed, SEL_EMBED_ROUTE);
    expect(r).toMatch(
      /top:\s*calc\(50% \+ var\(--saut, 1\) \* 50% \+ \(var\(--saut, 1\) \+ 1\) \* 0\.5px\)/,
    );
  });

  it('la colonne collante des gares passe AU-DESSUS du rond (embed)', () => {
    const r = regle(embed, 'table.grille thead th.col-gare,\ntable.grille tbody th');
    const z = Number(/z-index:\s*(\d+)/.exec(r)?.[1]);
    const zRond = Number(/z-index:\s*(\d+)/.exec(regle(embed, SEL_EMBED_BASE))?.[1]);
    expect(z).toBeGreaterThan(zRond);
  });

  it('grille.html : même hauteur en pourcentage de la cellule, sans unité ajoutée', () => {
    const r = regle(grille, '.train-pos.en-route,\n.train-fleche');
    expect(r).toMatch(/top:\s*calc\(50% \+ var\(--saut, 1\) \* 50%\)/);
    expect(r).toMatch(/z-index:\s*2/);
    // aucune unité d'écran : l'échelle vh / --u reste celle du rond à quai
    expect(r).not.toMatch(/\d(vh|vw|px)\b/);
    // et le diamètre du rond vit à UN endroit, avec ses unités
    expect(regle(grille, '.train-pos')).toMatch(/width:\s*var\(--rond-d\)/);
    expect(grille).toMatch(/--rond-d:\s*1\.7vh/);
  });

  it('il n’existe plus de style de bouton de bascule', () => {
    expect(embed).not.toContain('.bascule');
    expect(embed).not.toContain('.barre {');
  });
});

// ---------------------------------------------------------------------------
// 6 bis. UNE voie pour le rond (lot C du 05/11/2026)
// ---------------------------------------------------------------------------
// Constaté en préversion : à quai le rond poussait l'heure (embed) et se posait
// à droite de la cellule (grille.html) ; en route il était centré. Deux états,
// deux colonnes — et l'heure qui bougeait. Le correctif tient à ce que les deux
// états ne portent AUCUNE abscisse à eux : ce garde-fou échoue dès que l'un d'eux
// en redéclare une.

/** Une règle CSS qui nomme le rond ou la flèche, déclarations comprises. */
interface RegleRond {
  selecteur: string;
  decl: Record<string, string>;
}

/** Toutes les règles (même dans un `@media`) dont un sélecteur est le rond ou la flèche. */
function reglesRond(source: string): RegleRond[] {
  const sansCommentaires = source.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const sortie: RegleRond[] = [];
  for (const m of sansCommentaires.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selecteur = (m[1] ?? '').trim().replace(/\s+/g, ' ');
    const cible = selecteur
      .split(',')
      .map((s) => s.trim())
      .some((s) => /\.train-(pos|fleche)\b/.test(s) && !/\spath\b/.test(s));
    if (!cible) continue;
    const decl: Record<string, string> = {};
    for (const d of (m[2] ?? '').split(';')) {
      const i = d.indexOf(':');
      if (i < 0) continue;
      decl[d.slice(0, i).trim()] = d
        .slice(i + 1)
        .trim()
        .replace(/\s+/g, ' ');
    }
    sortie.push({ selecteur, decl });
  }
  return sortie;
}

describe('la voie du rond — une abscisse, jamais deux', () => {
  const lire = (f: string): string => readFileSync(join(RACINE, f), 'utf-8');
  const feuilles = { embed: lire('src/styles/embed.css'), grille: lire('src/styles/grille.css') };
  /** Les propriétés qui placent un élément sur l'axe HORIZONTAL. */
  const HORIZONTALES = [
    'left',
    'right',
    'inset',
    'inset-inline',
    'inset-inline-start',
    'translate',
  ];

  for (const [nom, css] of Object.entries(feuilles)) {
    describe(nom, () => {
      const regles = reglesRond(css);
      // Dans l'embed, `.train-pos` seul est aussi la pastille de la LÉGENDE (dans
      // le flux) : on ne juge que les règles posées dans une cellule.
      const dansCellule = (r: RegleRond): boolean =>
        nom === 'grille' || r.selecteur.includes('table.grille td');

      it('la voie est définie UNE fois, et le portrait ne la redéfinit pas', () => {
        expect(css.match(/--voie-rond:/g)).toHaveLength(1);
        const portrait = css.slice(css.indexOf('@media (orientation: portrait)'));
        expect(nom === 'grille' ? portrait : '').not.toContain('--voie-rond:');
      });

      it('toute abscisse déclarée pour le rond ou la flèche EST la voie', () => {
        const poseurs = regles.filter(dansCellule).filter((r) => 'left' in r.decl);
        expect(poseurs.length).toBeGreaterThan(0);
        for (const r of poseurs) expect(r.decl['left'], r.selecteur).toBe('var(--voie-rond)');
      });

      it('l’état « en route » ne touche à AUCUN axe horizontal', () => {
        const route = regles.filter(dansCellule).filter((r) => r.selecteur.includes('.en-route'));
        expect(route.length).toBeGreaterThan(0);
        for (const r of route) {
          for (const p of [...HORIZONTALES, 'margin', 'margin-left', 'margin-right', 'transform']) {
            expect(r.decl, `${r.selecteur} ne doit pas poser « ${p} »`).not.toHaveProperty(p);
          }
          // ce qu'il pose : la hauteur (et au plus le calque), rien d'autre
          expect(Object.keys(r.decl)).toContain('top');
          for (const p of Object.keys(r.decl)) expect(['top', 'z-index']).toContain(p);
        }
      });

      it('le rond et la flèche se centrent de la même façon sur la voie', () => {
        const centrages = new Set(
          regles
            .filter(dansCellule)
            .filter((r) => 'transform' in r.decl)
            .map((r) => r.decl['transform']),
        );
        expect([...centrages]).toEqual(['translate(-50%, -50%)']);
      });

      it('la flèche ne pulse pas, et n’est pas un pseudo-élément du rond', () => {
        for (const r of regles.filter((x) => /\.train-fleche/.test(x.selecteur))) {
          expect(r.decl, r.selecteur).not.toHaveProperty('animation');
        }
        expect(css).not.toMatch(/\.train-pos::(before|after)/);
      });

      it('la flèche suit le diamètre du rond, lu à un seul endroit', () => {
        const fleche = regles.find((r) => r.decl['width'] && /\.train-fleche/.test(r.selecteur));
        expect(fleche?.decl['width']).toMatch(/var\(--rond-d\)/);
        expect(fleche?.decl['height']).toMatch(/var\(--rond-d\)/);
        expect(css.match(/--rond-d:/g)?.length).toBeGreaterThanOrEqual(1);
      });
    });
  }

  it('grille.html : le rond garde son animation et le corps de l’heure est lu en un seul endroit', () => {
    const { grille } = feuilles;
    const rond = reglesRond(grille).find((r) => r.selecteur === '.train-pos');
    expect(rond?.decl['animation']).toMatch(/^pulse /);
    // `--corps-heure` EST le corps de l'heure : paysage…
    const sansCommentaires = grille.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(sansCommentaires).toMatch(/--corps-heure:\s*2\.25vh/);
    expect(sansCommentaires).toMatch(
      /tbody td \{\s*background: var\(--marine\);\s*font-size:\s*2\.25vh/,
    );
    // … et portrait
    const portrait = sansCommentaires.slice(
      sansCommentaires.indexOf('@media (orientation: portrait)'),
    );
    expect(portrait).toMatch(/--corps-heure:\s*calc\(2\.25 \* var\(--u\)\)/);
    expect(portrait).toMatch(/tbody td \{\s*font-size:\s*calc\(2\.25 \* var\(--u\)\)/);
    // la voie se compte sur ce corps, pas sur le `em` de la cellule (td.saute est plus petit)
    expect(sansCommentaires).toMatch(
      /--voie-rond:\s*calc\(50% \+ 1\.45 \* var\(--corps-heure\) \+ var\(--rond-d\) \/ 2\)/,
    );
  });

  it('embed : la voie se compte sur le corps de la cellule (td.saute y a le même)', () => {
    expect(feuilles.embed).toMatch(
      /--voie-rond:\s*calc\(50% \+ 1\.3em \+ 0\.37em \+ var\(--rond-d\) \/ 2\)/,
    );
    expect(feuilles.embed).toMatch(/table\.grille td\.saute \{\s*color: var\(--texte-sec\);\s*\}/);
  });
});

// ---------------------------------------------------------------------------
// 6 ter. La flèche entre deux gares (lot C du 05/11/2026)
// ---------------------------------------------------------------------------

describe('la flèche — seulement entre deux gares, toujours vers le bas', () => {
  /** Les flèches d'un tableau : cellule portante et saut, comme `ronds`. */
  function fleches(html: string): Array<{ ligne: string; train: number; saut: number }> {
    const [entete = '', corps = ''] = html.split('<tbody>');
    const numeros = [...entete.matchAll(/<span class="num">TRAIN (\d+)/g)].map((m) => Number(m[1]));
    const sortie: Array<{ ligne: string; train: number; saut: number }> = [];
    for (const ligne of corps.split('<tr>').slice(1)) {
      const nom = /^<th>([^<]*)</.exec(ligne)?.[1] ?? '?';
      ligne
        .split(/<td[ >]/)
        .slice(1)
        .forEach((cellule, i) => {
          const m = /<svg class="train-fleche"[^>]*--saut:(\d+);/.exec(cellule);
          if (m)
            sortie.push({
              ligne: nom.replace('&#39;', "'"),
              train: numeros[i] ?? -1,
              saut: Number(m[1]),
            });
        });
    }
    return sortie;
  }

  it('à quai : le rond seul, sans flèche', () => {
    const html = table('montee', '07:12:00');
    expect(ronds(html)).toHaveLength(1);
    expect(fleches(html)).toEqual([]);
    expect(html).not.toContain('train-fleche');
  });

  it('en route : une flèche dans la cellule du rond, au même saut', () => {
    const html = table('montee', '08:45:00', jourAvec(3));
    expect(fleches(html)).toEqual([{ ligne: 'Col de Voza', train: 3, saut: 1 }]);
    // la flèche est posée AVANT le rond : à calque égal, le rond se peint dessus
    expect(html.indexOf('class="train-fleche"')).toBeLessThan(
      html.indexOf('class="train-pos en-route"'),
    );
  });

  it('express : la flèche suit le saut de trois lignes du rond', () => {
    const html = table('montee', '11:00:00', jourAvec(9));
    expect(fleches(html).find((f) => f.train === 9)).toEqual({
      ligne: 'Motivon',
      train: 9,
      saut: 3,
    });
  });

  it('descente : présente aussi, et identique — elle pointe vers le bas, jamais retournée', () => {
    const descente = table('descente', '10:35:00');
    expect(fleches(descente)).toEqual([{ ligne: 'Bellevue', train: 6, saut: 1 }]);
    const montee = table('montee', '08:45:00', jourAvec(3));
    const pointe = (html: string) =>
      /<svg class="train-fleche"[^>]*>(<path d="[^"]*"\/>)<\/svg>/.exec(html)?.[1];
    expect(pointe(descente)).toBe('<path d="M0 0H10L5 14Z"/>');
    expect(pointe(montee)).toBe(pointe(descente));
    // la base est en haut (y = 0), la pointe en bas (y = 14) ; aucune rotation
    expect(descente).not.toMatch(/train-fleche[^>]*(rotate|scaleY|transform)/);
  });

  it('autant de flèches que de ronds en route, aucune de plus', () => {
    for (const quand of ['07:12:00', '08:45:00', '10:35:00', '11:00:00', '12:00:00']) {
      for (const sens of ['montee', 'descente'] as const) {
        const html = table(sens, quand, jourAvec(3, 9, 10));
        const enRoute = ronds(html).filter((r) => r.enRoute);
        expect(fleches(html), `${sens} ${quand}`).toEqual(
          enRoute.map((r) => ({ ligne: r.ligne, train: r.train, saut: r.saut })),
        );
      }
    }
  });

  it('la flèche prend la couleur de la rame, et son anneau quand elle en a un', () => {
    // le fond du rond devient `--rame` : un `background:` sur l'élément colorerait son CARRÉ
    expect(fleche('background:#FFFFFF;--anneau:#E52A23;', 2)).toBe(
      '<svg class="train-fleche" viewBox="0 0 10 14" style="--rame:#FFFFFF;--anneau:#E52A23;--saut:2;" aria-hidden="true"><path d="M0 0H10L5 14Z"/></svg>',
    );
    expect(fleche('background:#123456;', 1)).toContain('style="--rame:#123456;--saut:1;"');
    expect(fleche('background:#123456;', 1)).not.toContain('background');
  });

  it('dans le tableau : la couleur de la flèche EST celle du rond', () => {
    const html = table('montee', '08:45:00', jourAvec(3));
    const rond = /class="train-pos en-route" style="background:([^;]+);/.exec(html)?.[1];
    const flecheCouleur = /class="train-fleche"[^>]*style="--rame:([^;]+);/.exec(html)?.[1];
    expect(rond).toBeDefined();
    expect(flecheCouleur).toBe(rond);
  });

  it('`styleRame` commence toujours par « background: » — c’est ce dont `fleche` dépend', () => {
    expect(styleRame({ couleur: '#123456' })).toMatch(/^background:#123456;/);
    expect(styleRame({ couleur: '#123456', cercle: '#E52A23' })).toMatch(
      /^background:#123456;--anneau:/,
    );
  });
});

// ---------------------------------------------------------------------------
// 7. Survivantes de la campagne de mutation du 05/11/2026
// ---------------------------------------------------------------------------

describe('positions — données limites (survivantes de la campagne de mutation)', () => {
  /** Le grand service, avec un passage du TRAIN 1 réécrit. */
  function avecPassage(gare: string, changement: { a?: string | null; d?: string | null }): Grille {
    return {
      ...GRAND,
      montees: GRAND.montees.map((t) =>
        t.numero !== 1
          ? t
          : {
              ...t,
              // `null` = la clé est ABSENTE du document (comme un terminus sans « d »)
              passages: t.passages.map((p) =>
                p.gare === gare
                  ? Object.fromEntries(
                      Object.entries({ ...p, ...changement }).filter(([, v]) => v !== null),
                    )
                  : p,
              ),
            },
      ),
    } as Grille;
  }
  const positionDe1 = (grille: Grille, quand: string) =>
    positionsTrains(grille, generationJour(grille, '2026-07-15'), h(quand)).find(
      (p) => p.numero === 1,
    );

  it('un terminus qui a aussi un départ, égal à l’arrivée : à quai, sans gare suivante, sans erreur', () => {
    const grille = avecPassage('nid-daigle', { a: '08:05:30', d: '08:05:30' });
    expect(positionDe1(grille, '08:05:30')).toMatchObject({ gare: 'nid-daigle', vers: null });
  });

  it('un passage intermédiaire sans heure de départ : le train reste à quai, jamais « en route »', () => {
    const grille = avecPassage('motivon', { d: null });
    expect(positionDe1(grille, '07:30:00')).toMatchObject({ gare: 'motivon', vers: null });
  });

  it('le rond tombe sur la cellule « | » d’un express quand sa gare n’a pas de ligne', () => {
    // Plus aucune montée n'atteint le Nid d'Aigle : le tableau n'a plus sa ligne. Le
    // TRAIN 10 (express) en est parti à 11:48:30 vers Motivon : la ligne affichée la
    // plus proche est Bellevue, où il ne s'arrête pas — le rond est posé sur le « | ».
    const sansNid: Grille = {
      ...GRAND,
      montees: GRAND.montees.map((t) => ({
        ...t,
        passages: t.passages.filter((p) => p.gare !== 'nid-daigle'),
      })),
    };
    const jour = generationJour(sansNid, '2026-07-15');
    for (const n of [9, 10]) circ(jour, n).facultatif_actif = true;
    const html = table('descente', '12:00:00', jour, { grille: sansNid });
    expect(ronds(html).find((r) => r.train === 10)).toEqual({
      ligne: 'Bellevue',
      train: 10,
      enRoute: false,
      saut: null,
    });
    expect(html).toMatch(/<td class="saute">\|<span class="train-pos"/);
  });
});
