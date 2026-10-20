// Terminus exceptionnel : la perturbation SE VOIT, et l'arrivée s'annonce
// (décisions de l'exploitant du 20/10/2026).
//
// Constaté le 20/10/2026 sur la préversion (base de TEST, 22/12/2026, TRAIN 9
// limité au Col de Voza, motif « Météo ») :
//  - onglet Motivon : « Col de Voza » et « Terminus exceptionnel » de la même
//    couleur que les autres trains — rien ne signalait la perturbation ;
//  - onglet Col de Voza : le TRAIN 9 n'apparaissait pas du tout.
// On REND la page (embed) ; l'écran de gare a son gabarit dans `ecran.ts`, au
// DOM, et ses appels sont vérifiés dans sa source.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { ETE, grilleHiver } from '../core/__fixtures__/grille-hiver-essai';
import { generationJour, heureVersSecondes } from '../core/horaires';
import type { Circulation, GareId, Grille, Jour } from '../core/types';
import { echapper, MOT_ARRIVEE, neContinuePas } from './affichage-commun';
import { MOTS_EMBED, rendEmbed, type EntreeRendu } from './embed-logique';

const RACINE = fileURLToPath(new URL('../../', import.meta.url));
const source = (chemin: string): string =>
  readFileSync(join(RACINE, chemin), 'utf-8').replace(/\r\n/g, '\n');

const HIVER = grilleHiver();
const DATE_HIVER = '2026-12-15';
const h = heureVersSecondes;

function circ(jour: Jour, numero: number): Circulation {
  const c = jour.circulations.find((x) => x.numero === numero);
  if (!c) throw new Error(`TRAIN ${numero} absent`);
  return c;
}

function hiverT5AuColDeVoza(): Jour {
  const jour = generationJour(HIVER, DATE_HIVER);
  circ(jour, 5).terminus = 'col-de-voza';
  return jour;
}

function rend(grille: Grille, jour: Jour, gare: GareId, maintenant: string): string {
  const e: EntreeRendu = {
    etat: 'horaires',
    grille,
    grilleDemain: null,
    jour,
    params: null,
    messages: [],
    affluence: [],
    gareUrl: null,
    ongletDemande: gare,
    raisonDe: null,
    vue: 'departs',
    maintenant_s: h(maintenant),
    maintenantMs: 0,
    dateISO: jour.date,
    dateLongue: 'mardi 15 décembre',
    heureSync: null,
    badge: '',
    simulation: null,
    urlInfos: null,
  };
  return rendEmbed(e);
}

/** Le `<li>` du TRAIN n, ou '' s'il n'est pas dans la page. */
function ligneDuTrain(html: string, n: number): string {
  for (const li of html.split('<li class="depart').slice(1)) {
    const bloc = li.slice(0, li.indexOf('</li>'));
    if (bloc.includes(`class="badge-train">T${n}<`)) return bloc;
  }
  return '';
}

const MENTION = echapper(MOTS_EMBED.terminusExceptionnel);

describe('§1 — en amont, la perturbation se voit', () => {
  it('Motivon : destination ET mention portent la classe d’alerte, la mention en gras', () => {
    const t5 = ligneDuTrain(rend(HIVER, hiverT5AuColDeVoza(), 'motivon', '08:00'), 5);
    expect(t5).not.toBe('');
    expect(t5).toContain('<span class="nom-dest alerte">Col de Voza</span>');
    expect(t5).toContain(`<b class="alerte">${MENTION}</b>`);
  });

  it('les autres trains ne portent AUCUNE alerte', () => {
    const html = rend(HIVER, hiverT5AuColDeVoza(), 'motivon', '08:00');
    const t7 = ligneDuTrain(html, 7);
    expect(t7).not.toBe('');
    expect(t7).not.toContain('alerte');
    expect(t7).not.toContain(MENTION);
  });

  it('la DESCENTE qui part du Col de Voza porte le drapeau, mais pas l’orange', () => {
    // `terminusExceptionnel` vaut aussi pour la descente « partant de là » :
    // elle part à son heure, d'une gare desservie — rien d'anormal à
    // signaler au voyageur de Motivon qui descend.
    const jour = hiverT5AuColDeVoza();
    const t6 = ligneDuTrain(rend(HIVER, jour, 'motivon', '10:00'), 6);
    expect(t6).not.toBe('');
    expect(t6).not.toContain('alerte');
    expect(t6).not.toContain(MENTION);
  });

  it('un train limité SUPPRIMÉ reste barré, sans orange', () => {
    const jour = hiverT5AuColDeVoza();
    Object.assign(circ(jour, 5), { statut: 'supprime', motif: 'Météo' });
    const t5 = ligneDuTrain(rend(HIVER, jour, 'motivon', '08:00'), 5);
    expect(t5).not.toBe('');
    expect(t5).not.toContain('alerte');
  });

  it('la feuille de l’embed colore bien `.alerte` de l’orange du retard', () => {
    const css = source('src/styles/embed.css');
    expect(css).toMatch(
      /\.depart \.nom-dest\.alerte,\s*\.depart \.note \.alerte \{\s*color: var\(--retard\);/,
    );
  });
});

describe('§2 — au terminus exceptionnel, une ligne d’ARRIVÉE', () => {
  it('Col de Voza : la ligne du TRAIN 5, à l’heure d’arrivée, dans la colonne de montée', () => {
    const html = rend(HIVER, hiverT5AuColDeVoza(), 'col-de-voza', '09:00');
    const montee = html.slice(html.indexOf('sens-montee'), html.indexOf('sens-descente'));
    const t5 = ligneDuTrain(montee, 5);
    expect(t5).not.toBe('');
    expect(t5.startsWith(' arrivee-terminus"')).toBe(true);
    expect(t5).toContain('<span class="heure">09:40</span>');
    const mots = neContinuePas('bellevue', 'Bellevue');
    expect(t5).toContain(`<b class="alerte">${echapper(`${mots.fr} / ${mots.en}`)}</b>`);
    expect(t5).toContain('<span class="nom-dest alerte">');
  });

  it('pas de compte à rebours de départ, pas de « PARTI » — une étiquette « Arrivée »', () => {
    for (const heure of ['09:00', '09:40', '09:42']) {
      const t5 = ligneDuTrain(rend(HIVER, hiverT5AuColDeVoza(), 'col-de-voza', heure), 5);
      expect(t5, heure).toContain('class="rebours arrivee-terminus"');
      expect(t5, heure).toContain(MOT_ARRIVEE.fr);
      expect(t5, heure).not.toContain('PARTI');
      expect(t5, heure).not.toContain(' min<');
      expect(t5, heure).not.toContain(MENTION);
    }
  });

  it('la descente qui repart du Col de Voza reste une ligne de départ ordinaire', () => {
    const html = rend(HIVER, hiverT5AuColDeVoza(), 'col-de-voza', '09:00');
    const descente = html.slice(html.indexOf('sens-descente'));
    const t6 = ligneDuTrain(descente, 6);
    expect(t6).not.toBe('');
    expect(t6.startsWith(' arrivee-terminus"')).toBe(false);
    expect(t6).not.toContain('rebours arrivee-terminus');
  });

  it('la ligne disparaît 2 min après l’heure d’arrivée', () => {
    expect(ligneDuTrain(rend(HIVER, hiverT5AuColDeVoza(), 'col-de-voza', '09:42:30'), 5)).not.toBe(
      '',
    );
    expect(ligneDuTrain(rend(HIVER, hiverT5AuColDeVoza(), 'col-de-voza', '09:42:31'), 5)).toBe('');
  });

  it('terminus NORMAL (Bellevue en hiver) : aucune ligne d’arrivée', () => {
    const html = rend(HIVER, generationJour(HIVER, DATE_HIVER), 'bellevue', '08:00');
    expect(html).not.toContain('depart arrivee-terminus');
    expect(html).not.toContain('rebours arrivee-terminus');
  });

  it('train SUPPRIMÉ : aucune ligne d’arrivée', () => {
    const jour = hiverT5AuColDeVoza();
    Object.assign(circ(jour, 5), { statut: 'supprime', motif: 'Météo' });
    expect(ligneDuTrain(rend(HIVER, jour, 'col-de-voza', '09:00'), 5)).toBe('');
  });

  it('été : « ne continue pas vers le Nid d’Aigle »', () => {
    const jour = generationJour(ETE, '2026-07-15');
    circ(jour, 5).terminus = 'bellevue';
    const t5 = ligneDuTrain(rend(ETE, jour, 'bellevue', '08:00'), 5);
    expect(t5).toContain(echapper("Terminus — ne continue pas vers le Nid d'Aigle"));
    expect(t5).toContain(echapper("does not continue to Nid d'Aigle"));
  });

  it('un retard : heure d’arrivée réelle, l’heure théorique barrée dessous', () => {
    const jour = hiverT5AuColDeVoza();
    Object.assign(circ(jour, 5), { statut: 'retard', retard_min: 10, motif: 'Météo' });
    const t5 = ligneDuTrain(rend(HIVER, jour, 'col-de-voza', '09:00'), 5);
    expect(t5).toContain('<span class="heure">09:50<s class="theorique"');
    expect(t5).toContain('>09:40</s>');
    expect(t5).toContain('Météo');
  });
});

describe('l’écran de gare suit les mêmes règles', () => {
  const ecran = source('src/pages/ecran.ts');

  it('sa liste est `lignesDuTableau`, la même que l’embed', () => {
    expect(ecran).toContain('const departs = lignesDuTableau(passages).slice(0, 5);');
    expect(ecran).not.toMatch(/passages\.filter\(\(p\) => p\.depart_s !== null\)/);
  });

  it('la case et la note de l’arrivée viennent de la règle commune', () => {
    expect(ecran).toMatch(
      /if \(arriveeAuTerminusExceptionnel\(p\)\) \{\s*return `<span class="chip arrivee-terminus">/,
    );
    expect(ecran).toContain('neContinuePas(vers, nomGare(vers))');
  });

  it('les quatre lignes de décision sont MOT POUR MOT celles de l’embed, testé au rendu', () => {
    // Le gabarit de l'écran vit au DOM, avec l'état du module : il n'est pas
    // rendu ici. Ce qui le rend sûr, c'est qu'il décide EXACTEMENT comme
    // l'embed — dont chaque décision est éprouvée ci-dessus. Une ligne qui
    // diverge dans l'un des deux fait tomber ce test (campagne du 20/10/2026 :
    // ces mutations survivaient sur l'écran seul).
    const embed = source('src/pages/embed-logique.ts');
    for (const ligne of [
      "const limitee = !supprime && p.terminusExceptionnel && p.sens === 'montee';",
      'const arrivee = arriveeAuTerminusExceptionnel(p);',
      'const reelle = arrivee ? p.arrivee_s : p.depart_s;',
      'const theorique = arrivee ? p.arrivee_theorique_s : p.depart_theorique_s;',
    ]) {
      expect(embed, ligne).toContain(ligne);
      expect(ecran, ligne).toContain(ligne);
    }
    // …et l'heure affichée est bien tirée de ces deux-là.
    expect(ecran).toContain(
      '`${formatHeure(reelle)}<span class="retard-old">théorique ${formatHeure(theorique)}</span>`',
    );
    expect(ecran).toMatch(/: formatHeure\(theorique\);/);
  });

  it('jamais la classe `arrivee` : c’est celle du bandeau « prochaine arrivée »', () => {
    // Constaté au navigateur le 20/10/2026 : une rangée `.arrivee` héritait du
    // bandeau (flex, marges de 2vw) et ses colonnes se décalaient de 160 à
    // 290 px par rapport aux autres rangées.
    expect(source('src/styles/ecran.css')).toMatch(/^\.arrivee \{/m);
    // (`$('arrivee')`, l'identifiant du bandeau lui-même, reste permis.)
    expect(ecran).not.toMatch(/' arrivee'|class="chip arrivee"|rangee arrivee/);
    expect(ecran).toContain("${arrivee ? ' arrivee-terminus' : ''}");
  });

  it('la note d’arrivée prend la taille réduite des longues mentions (mesuré à 1920×1080)', () => {
    // 81 caractères à 1,95vh : 795,6 px pour 748 px utiles — la colonne
    // Destination s'élargissait de 47 px. En `note-exp` (1,62vh), elle tient.
    expect(ecran).toContain(
      "p.express || sansArret !== '' || prive !== '' || arrivee ? ' note-exp' : ''",
    );
  });

  it('la note d’arrivée porte la classe d’alerte', () => {
    expect(ecran).toContain(
      'note = `<b class="alerte">${echapper(`${mots.fr} / ${mots.en}`)}</b>`;',
    );
  });

  it('destination et mention portent la classe d’alerte', () => {
    expect(ecran).toContain("<span class=\"nom-dest${limitee ? ' alerte' : ''}\">");
    expect(ecran).toContain(`<b class="alerte">${MOTS_EMBED.terminusExceptionnel}</b>`);
    const css = source('src/styles/ecran.css');
    expect(css).toMatch(/\.r-dest \.dest \.nom-dest\.alerte \{\s*color: var\(--retard\);/);
  });
});
