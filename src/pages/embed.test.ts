// La page d'horaires du SITE WEB (embed.html) — lot du 15/10/2026.
//
// TROIS CHOSES QUE CES TESTS TIENNENT, par ordre de gravité :
//
//  1. JAMAIS « FERMÉ ». Seules les grilles d'été sont saisies en production
//     (constaté le 15/10/2026) : pour toute autre date, `vueJournee()` répond
//     `fermee`, et les écrans de gare annoncent la fermeture. Sur le site
//     public ce serait une annonce fausse dès que la ligne roule sur une
//     période pas encore saisie. On REND la page, on ne cherche pas un mot dans
//     son code.
//  2. JAMAIS DE TEMPS RÉEL, de service worker ni de signal de vie. Un canal par
//     visiteur, sur le projet Supabase des six écrans, pourrait épuiser le
//     quota de connexions et empêcher un écran de gare de se reconnecter.
//  3. UNE SEULE SOURCE pour les règles d'affichage : l'embed appelle ce
//     qu'appellent l'écran de gare et la grille du jour, il ne les recopie pas.
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import grandServiceJson from '../../docs/grilles-historique/2026-ete-grand-service.json';
import petitServiceJson from '../../docs/grilles-historique/2026-ete-petit-service.json';
import {
  generationJour,
  grillePourJour,
  heureVersSecondes,
  passagesPourGare,
  positionsTrains,
  vueJournee,
} from '../core/horaires';
import type { Grille, Jour, Message } from '../core/types';
import { appliqueAffluence, echapper } from './affichage-commun';
import {
  DEPARTS_PAR_SENS,
  departsParSens,
  etatEmbed,
  gareDemandee,
  INTERVALLE_RELECTURE_MS,
  MESSAGES_REPLI,
  MOTS_EMBED,
  ongletRetenu,
  ongletsGares,
  rendEmbed,
  urlInfosValide,
  vueDemandee,
  type EntreeRendu,
} from './embed-logique';
import { tableHtml } from './grille-tableau';

const RACINE = fileURLToPath(new URL('../../', import.meta.url));

function source(chemin: string): string {
  return readFileSync(join(RACINE, chemin), 'utf-8').replace(/\r\n/g, '\n');
}

/** Code seul : un commentaire qui EXPLIQUE l'interdit ne doit pas le déclencher. */
function codeSeul(chemin: string): string {
  return source(chemin)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const GRAND = grandServiceJson as unknown as Grille;
const PETIT = petitServiceJson as unknown as Grille;
/** Été 2026 tel qu'en production : les SEULES grilles saisies au 15/10/2026. */
const ETE = [GRAND, PETIT];

const h = (hhmm: string): number => heureVersSecondes(hhmm);

function entree(partiel: Partial<EntreeRendu>): EntreeRendu {
  return {
    etat: 'horaires',
    grille: null,
    grilleDemain: null,
    jour: null,
    params: null,
    messages: [],
    affluence: [],
    gareUrl: null,
    ongletDemande: null,
    vue: 'departs',
    maintenant_s: h('10:30'),
    maintenantMs: Date.UTC(2026, 6, 15, 8, 30),
    dateLongue: 'mercredi 15 juillet',
    heureSync: '10:29',
    badge: '',
    simulation: null,
    urlInfos: null,
    ...partiel,
  };
}

/** Le rendu de la journée, dans l'état que la page déciderait elle-même. */
function rendJournee(
  grilles: Grille[],
  jour: Jour,
  extra: Partial<EntreeRendu> = {},
): { html: string; vue: string } {
  const grille = grillePourJour(grilles, jour);
  const vue = vueJournee(grilles, jour, grille);
  const html = rendEmbed(entree({ etat: etatEmbed(true, vue), grille, jour, ...extra }));
  return { html, vue };
}

/**
 * Une journée qu'aucune grille ne couvre, telle que le fournisseur la rend
 * (même forme que dans `saison.test.ts`) — par défaut celle du 15/10/2026,
 * APRÈS la dernière période saisie.
 */
function jourSansGrille(date = '2026-10-15'): Jour {
  return {
    date,
    grille_version: '',
    terminus_bellevue: false,
    gare_debut: 'le-fayet',
    gare_fin: 'nid-daigle',
    circulations: [],
    enregistre: false,
    hors_saison: true,
  };
}

// ---------------------------------------------------------------------------
// 1. Sans grille, jamais « fermé »
// ---------------------------------------------------------------------------

describe('sans grille, l’embed n’annonce JAMAIS une fermeture', () => {
  it('le cas est bien celui des écrans « fermé » : vueJournee() répond `fermee`', () => {
    // Sans cette vérification, le test suivant pourrait passer sur un autre
    // état et ne rien prouver.
    const jour = jourSansGrille();
    expect(grillePourJour(ETE, jour)).toBeNull();
    expect(vueJournee(ETE, jour, null)).toBe('fermee');
  });

  for (const urlInfos of [null, 'https://www.example.org/infos']) {
    it(`aucune occurrence de « ferm » ni de « closed » (lien ${urlInfos ? 'fourni' : 'absent'})`, () => {
      const { html, vue } = rendJournee(ETE, jourSansGrille(), {
        urlInfos,
        gareUrl: 'saint-gervais',
        ongletDemande: 'nid-daigle',
      });
      expect(vue).toBe('fermee');
      expect(html).not.toMatch(/ferm/i);
      expect(html).not.toMatch(/closed/i);
      expect(html).toContain(MESSAGES_REPLI.sansGrille.fr);
      expect(html).toContain(MESSAGES_REPLI.sansGrille.en);
    });
  }

  it('la vue « Toute la journée » obéit à la même règle', () => {
    const { html } = rendJournee(ETE, jourSansGrille(), { vue: 'jour' });
    expect(html).not.toMatch(/ferm|closed/i);
    expect(html).toContain(MESSAGES_REPLI.sansGrille.fr);
    expect(html).not.toContain('<table');
  });

  it('le trou de saisie (`indisponible`) dit la même chose, mot pour mot', () => {
    // Une date encadrée de deux périodes proches : écran neutre en gare.
    const hiver: Grille = {
      ...PETIT,
      version: 'hiver',
      periodes: [{ du: '2026-10-20', au: '2026-11-30' }],
    };
    const jour = jourSansGrille('2026-10-05');
    expect(vueJournee([...ETE, hiver], jour, null)).toBe('indisponible');
    const { html } = rendJournee([...ETE, hiver], jour);
    expect(html).not.toMatch(/ferm|closed/i);
    expect(html).toContain(MESSAGES_REPLI.sansGrille.fr);
  });

  it('les deux états non-horaires de vueJournee() donnent le même état d’embed', () => {
    expect(etatEmbed(true, 'fermee')).toBe('sans-grille');
    expect(etatEmbed(true, 'indisponible')).toBe('sans-grille');
    expect(etatEmbed(true, 'horaires')).toBe('horaires');
    expect(etatEmbed(false, 'horaires')).toBe('injoignable');
  });

  it('le lien n’est jamais inventé : sans URL fournie, pas de lien du tout', () => {
    const { html } = rendJournee(ETE, jourSansGrille(), { urlInfos: null });
    expect(html).not.toContain('<a ');
    const avec = rendJournee(ETE, jourSansGrille(), {
      urlInfos: 'https://www.example.org/infos',
    }).html;
    expect(avec).toContain('href="https://www.example.org/infos"');
    expect(avec).toContain('target="_top"');
  });

  it('seule une URL https devient un lien', () => {
    expect(urlInfosValide(undefined)).toBeNull();
    expect(urlInfosValide('')).toBeNull();
    expect(urlInfosValide('   ')).toBeNull();
    expect(urlInfosValide('javascript:alert(1)')).toBeNull();
    expect(urlInfosValide('http://www.example.org')).toBeNull();
    expect(urlInfosValide('pas une url')).toBeNull();
    expect(urlInfosValide(' https://www.example.org/a ')).toBe('https://www.example.org/a');
  });

  it('base injoignable : message bilingue, rien d’autre, jamais « fermé »', () => {
    const html = rendEmbed(entree({ etat: 'injoignable' }));
    expect(html).toContain(MESSAGES_REPLI.injoignable.fr);
    expect(html).toContain(MESSAGES_REPLI.injoignable.en);
    expect(html).not.toMatch(/ferm|closed/i);
    expect(html).not.toContain('class="depart');
  });

  it('la coquille HTML ne dit pas « fermé » non plus, avant le premier rendu', () => {
    const html = source('embed.html').replace(/<!--[\s\S]*?-->/g, '');
    expect(html).not.toMatch(/ferm|closed/i);
  });

  it('les écrans de gare, eux, GARDENT leur message de fermeture', () => {
    expect(source('ecran.html')).toContain('Le Tramway du Mont-Blanc est fermé');
    expect(source('grille.html')).toContain('Le Tramway du Mont-Blanc est fermé');
  });
});

// ---------------------------------------------------------------------------
// 2. Ni temps réel, ni service worker, ni signal de vie
// ---------------------------------------------------------------------------

describe('embed.ts — rien de ce qui pèse sur les écrans de gare', () => {
  const code = codeSeul('src/pages/embed.ts');

  it('n’ouvre JAMAIS de canal temps réel', () => {
    expect(code).not.toContain('onChange(');
    expect(code).not.toContain('.channel(');
  });

  it('n’enregistre JAMAIS de service worker', () => {
    expect(code).not.toContain('enregistreServiceWorker');
    expect(code).not.toContain('serviceWorker');
  });

  it('n’envoie JAMAIS de signal de vie, et ne lit pas `?ecran=`', () => {
    expect(code).not.toContain('heartbeat');
    expect(code).not.toContain("'ecran'");
    expect(code).not.toContain('identifiantEcran');
    expect(code).not.toContain('avertitPosteAnonyme');
  });

  it('rien du kiosque : ni anti-burn-in, ni veille, ni curseur masqué', () => {
    expect(code).not.toContain('demarreAntiBurnIn');
    expect(code).not.toMatch(/\benVeille\b|veilleEffective/);
    expect(source('src/styles/embed.css')).not.toMatch(/cursor:\s*none/);
  });

  it('relit toutes les 60 s, et seulement quand l’onglet est visible', () => {
    expect(INTERVALLE_RELECTURE_MS).toBe(60_000);
    expect(code).toContain('window.setInterval(relis, INTERVALLE_RELECTURE_MS)');
    const relis = code.slice(code.indexOf('function relis()'));
    expect(relis.slice(0, relis.indexOf('\n}'))).toContain(
      "if (document.visibilityState === 'visible') sync?.resynchronise();",
    );
    // …et relit en revenant sur l'onglet.
    expect(code).toContain("document.addEventListener('visibilitychange'");
    // Une seule relecture périodique : pas de second minuteur de 30 s caché.
    expect(code.match(/resynchronise\(\)/g)?.length).toBe(2);
  });

  it('la hauteur part vers la page parente, et RIEN d’autre', () => {
    expect(code).toContain(
      "window.parent.postMessage({ type: TYPE_MESSAGE_HAUTEUR, hauteur }, '*');",
    );
    expect(code.match(/postMessage\(/g)?.length).toBe(1);
  });

  it('n’instancie la démonstration que sur `?demo=1`, chargée à la demande', () => {
    expect(code).toContain('modeDonnees(');
    expect(code).toContain("mode === 'demo'");
    expect(code).not.toMatch(/\bcreeProvider\s*\(/);
    expect(code).toContain("await import('../data/mock')");
  });

  it('n’atteint ni le lecteur Excel ni le code de la supervision', () => {
    const INTERDITS = [
      'src/core/lecture-xlsx.ts',
      'src/core/ecriture-xlsx.ts',
      'src/core/import-grille.ts',
      'src/core/export-grille.ts',
      'src/core/edition-grille.ts',
      'src/pages/supervision.ts',
      'src/pages/supervision-logique.ts',
      'src/pages/onglet-horaires.ts',
      'src/pages/horaires-onglet.ts',
      'src/pages/correction-grille.ts',
    ];
    // Imports STATIQUES et DYNAMIQUES : un chunk chargé à la demande finit
    // lui aussi dans le navigateur du visiteur.
    const atteints = new Set<string>();
    const aVoir = ['src/pages/embed.ts'];
    while (aVoir.length > 0) {
      const fichier = aVoir.pop()!;
      if (atteints.has(fichier)) continue;
      atteints.add(fichier);
      const texte = source(fichier);
      expect(texte, `${fichier} importe fflate`).not.toMatch(
        /from\s*['"]fflate['"]|import\(\s*['"]fflate/,
      );
      for (const m of texte.matchAll(
        /(?:from\s*|import\s*\(\s*|^\s*import\s*)['"](\.[^'"]+)['"]/gm,
      )) {
        const base = resolve(RACINE, dirname(fichier), m[1]!);
        for (const candidat of [`${base}.ts`, base, join(base, 'index.ts')]) {
          if (!/\.ts$/.test(candidat)) continue;
          try {
            readFileSync(candidat);
            aVoir.push(relative(RACINE, candidat).replace(/\\/g, '/'));
            break;
          } catch {
            // candidat suivant
          }
        }
      }
    }
    expect(atteints.has('src/pages/embed-logique.ts'), 'le parcours ne suit pas les imports').toBe(
      true,
    );
    for (const interdit of INTERDITS) expect(atteints.has(interdit), interdit).toBe(false);
  });
});

describe('embed.html — même politique de sécurité que les autres pages', () => {
  function politique(page: string): string {
    const meta = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(
      source(page),
    );
    expect(meta, `${page} n’a pas de balise CSP`).not.toBeNull();
    return (meta?.[1] ?? '').replace(/\s+/g, ' ').trim();
  }

  it('la CSP est IDENTIQUE à celle de grille.html, form-action compris', () => {
    expect(politique('embed.html')).toBe(politique('grille.html'));
    expect(politique('embed.html')).toContain("form-action 'none'");
    expect(politique('embed.html')).not.toContain('frame-ancestors');
  });

  it('la balise est dans le <head>, avant tout script', () => {
    const html = source('embed.html');
    const csp = html.search(/<meta\s+http-equiv="Content-Security-Policy"/);
    expect(csp).toBeGreaterThan(html.search(/<head[\s>]/));
    expect(csp).toBeLessThan(html.search(/<\/head>/));
    expect(csp).toBeLessThan(html.indexOf('<script'));
  });

  it('est une entrée du build, et le portail de test y mène', () => {
    expect(source('vite.config.ts')).toContain("new URL('embed.html', import.meta.url)");
    expect(source('index.html')).toContain('embed.html?demo=1');
  });
});

// ---------------------------------------------------------------------------
// 3. Une seule source pour les règles d'affichage
// ---------------------------------------------------------------------------

describe('les prochains départs sont ceux de l’écran de gare', () => {
  const jour = generationJour(GRAND, '2026-07-15');

  for (const [gare, heure] of [
    ['saint-gervais', '10:30'],
    ['le-fayet', '07:00'],
    ['bellevue', '16:00'],
    ['nid-daigle', '12:00'],
  ] as const) {
    it(`${gare} à ${heure} : mêmes trains, même ordre, coupés à ${DEPARTS_PAR_SENS} par sens`, () => {
      const maintenant = h(heure);
      // La liste de `ecran.ts` (`rendre()`), avant sa coupe à cinq lignes.
      const ecran = appliqueAffluence(passagesPourGare(GRAND, jour, gare, maintenant), []).filter(
        (p) => p.depart_s !== null,
      );
      const d = departsParSens(GRAND, jour, gare, maintenant, []);
      for (const sens of ['montee', 'descente'] as const) {
        const attendu = ecran.filter((p) => p.sens === sens).slice(0, DEPARTS_PAR_SENS);
        expect(d[sens].map((p) => p.numero)).toEqual(attendu.map((p) => p.numero));
      }
      // Les cinq premières lignes de l'écran sont TOUTES dans l'embed.
      const montres = new Set([...d.montee, ...d.descente].map((p) => p.numero));
      for (const p of ecran.slice(0, DEPARTS_PAR_SENS)) expect(montres.has(p.numero)).toBe(true);
    });
  }

  it('le remplissage déclaré arrive sur la ligne, par la jointure de l’écran', () => {
    const maintenant = h('10:30');
    const premier = departsParSens(GRAND, jour, 'saint-gervais', maintenant, []).montee[0]!;
    const d = departsParSens(GRAND, jour, 'saint-gervais', maintenant, [
      { date: jour.date, numero: premier.numero, niveau: 'complet' },
    ]);
    expect(d.montee[0]?.affluence).toBe('complet');
    const html = rendEmbed(
      entree({
        grille: GRAND,
        jour,
        ongletDemande: 'saint-gervais',
        affluence: [{ date: jour.date, numero: premier.numero, niveau: 'complet' }],
      }),
    );
    expect(html).toContain('class="mention complet"');
  });

  it('Le Fayet n’a pas de bloc « vers Le Fayet », le Nid d’Aigle pas de « vers le Nid d’Aigle »', () => {
    expect(departsParSens(GRAND, jour, 'le-fayet', h('07:00'), []).sensDuJour.descente).toBe(false);
    expect(departsParSens(GRAND, jour, 'nid-daigle', h('07:00'), []).sensDuJour.montee).toBe(false);
  });

  it('un train supprimé reste affiché barré, sans pastille ni compte à rebours', () => {
    const premier = departsParSens(GRAND, jour, 'saint-gervais', h('10:30'), []).montee[0]!;
    const supprime: Jour = {
      ...jour,
      circulations: jour.circulations.map((c) =>
        c.numero === premier.numero ? { ...c, statut: 'supprime', motif: 'Panne' } : c,
      ),
    };
    const html = rendEmbed(
      entree({ grille: GRAND, jour: supprime, ongletDemande: 'saint-gervais' }),
    );
    const ligne = html.slice(html.indexOf('<li class="depart supprime'));
    expect(ligne.length).toBeLessThan(html.length);
    const bloc = ligne.slice(0, ligne.indexOf('</li>'));
    expect(bloc).toContain(MOTS_EMBED.supprime.fr);
    expect(bloc).not.toContain('class="rebours');
    expect(bloc).not.toContain('class="mention');
  });

  it('les mots de statut sont ceux de l’écran de gare — s’il en change un, ce test tombe', () => {
    const ecran = source('src/pages/ecran.ts');
    const mots = [
      MOTS_EMBED.supprime.fr,
      MOTS_EMBED.supprime.en,
      MOTS_EMBED.retard.fr,
      MOTS_EMBED.retard.en,
      MOTS_EMBED.aLHeure.fr,
      MOTS_EMBED.aLHeure.en,
      MOTS_EMBED.theorique,
      MOTS_EMBED.express,
      MOTS_EMBED.sansArret,
      MOTS_EMBED.terminusExceptionnel,
      MOTS_EMBED.departConfirme,
      MOTS_EMBED.velos,
      MOTS_EMBED.prive,
      MOTS_EMBED.montee,
      MOTS_EMBED.descente,
      MOTS_EMBED.serviceTermine,
    ];
    for (const mot of mots) expect(ecran, mot).toContain(echapper(mot));
  });

  it('les mentions passent par la règle partagée, pas par des mots recopiés', () => {
    const code = codeSeul('src/pages/embed-logique.ts');
    expect(code).toContain('mentionCourse(');
    expect(code).toContain('LIBELLE_MENTION[mention]');
    for (const mot of ['Dernières places', 'Few seats', 'Complet', 'Full', 'Privé', 'Private']) {
      expect(code, `« ${mot} » écrit en dur`).not.toContain(`'${mot}'`);
    }
  });
});

describe('la grille complète est CELLE de grille.html', () => {
  const jour = generationJour(GRAND, '2026-07-15');

  it('l’embed pose, au caractère près, les tableaux que grille.html construit', () => {
    const maintenant = h('10:30');
    const html = rendEmbed(
      entree({ grille: GRAND, jour, vue: 'jour', ongletDemande: 'saint-gervais' }),
    );
    const ctx = {
      grille: GRAND,
      jour,
      gare: 'saint-gervais' as const,
      machines: [],
      affluence: [],
    };
    const positions = new Map(
      positionsTrains(GRAND, jour, maintenant).map((p) => [p.numero, p.gare]),
    );
    expect(html).toContain(tableHtml(ctx, 'montee', maintenant, positions));
    expect(html).toContain(tableHtml(ctx, 'descente', maintenant, positions));
    expect(html).not.toContain('class="onglets"');
  });

  it('le lien bascule dans les deux sens', () => {
    const departs = rendEmbed(entree({ grille: GRAND, jour }));
    expect(departs).toContain('data-vue="jour"');
    expect(departs).toContain('Toute la journée');
    expect(departs).toContain('Full day');
    const tout = rendEmbed(entree({ grille: GRAND, jour, vue: 'jour' }));
    expect(tout).toContain('data-vue="departs"');
  });
});

// ---------------------------------------------------------------------------
// Paramètres d'URL, onglets, section exploitée, messages
// ---------------------------------------------------------------------------

describe('paramètres d’URL — une page publique ne casse pas sur une faute de frappe', () => {
  it('`?gare=` inconnu : ignoré, l’onglet par défaut s’affiche', () => {
    expect(gareDemandee('saint-gervais')).toBe('saint-gervais');
    expect(gareDemandee('St-Gervais')).toBeNull();
    expect(gareDemandee('')).toBeNull();
    expect(gareDemandee(null)).toBeNull();
    const jour = generationJour(GRAND, '2026-07-15');
    const html = rendEmbed(entree({ grille: GRAND, jour, ongletDemande: gareDemandee('xyz') }));
    expect(html).toContain('class="onglet choisi" data-gare="le-fayet"');
    expect(html).not.toMatch(/erreur|error/i);
  });

  it('`?vue=jour` ouvre la grille complète, toute autre valeur les départs', () => {
    expect(vueDemandee('jour')).toBe('jour');
    expect(vueDemandee('JOUR')).toBe('departs');
    expect(vueDemandee(null)).toBe('departs');
  });

  it('les onglets suivent l’ordre de la ligne, avec les noms officiels', () => {
    const jour = generationJour(GRAND, '2026-07-15');
    const html = rendEmbed(entree({ grille: GRAND, jour }));
    const ordre = [...html.matchAll(/role="tab"[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect(ordre).toEqual(GRAND.gares.map((g) => echapper(g.nom)));
  });
});

describe('section exploitée — une gare hors section n’a pas d’onglet actif', () => {
  const jour: Jour = { ...generationJour(GRAND, '2026-07-15'), gare_fin: 'motivon' };

  it('Col de Voza, Bellevue et Nid d’Aigle sont grisés, non cliquables', () => {
    const onglets = ongletsGares(GRAND, jour, h('10:30'));
    const inactifs = onglets.filter((o) => o.inactif !== null).map((o) => o.id);
    expect(inactifs).toEqual(['col-de-voza', 'bellevue', 'nid-daigle']);
    const html = rendEmbed(entree({ grille: GRAND, jour }));
    expect(html).toMatch(/class="onglet inactif" disabled[^>]*>Bellevue</);
    expect(html).not.toContain('data-gare="bellevue"');
  });

  it('un `?gare=` sur une gare hors section retombe sur un onglet actif', () => {
    const onglets = ongletsGares(GRAND, jour, h('10:30'));
    expect(ongletRetenu(onglets, 'bellevue')).toBe('le-fayet');
    expect(ongletRetenu(onglets, 'motivon')).toBe('motivon');
  });

  it('la restriction est annoncée en tête, avec la formulation des écrans', () => {
    const html = rendEmbed(entree({ grille: GRAND, jour }));
    expect(html).toContain('class="bandeau-section"');
    expect(html).toContain('Ligne fermée entre Le Fayet et Motivon — travaux');
  });
});

describe('messages — bloc statique, mêmes règles de ciblage que les écrans', () => {
  const jour = generationJour(GRAND, '2026-07-15');
  const msg = (id: string, extra: Partial<Message>): Message => ({
    id,
    texte_fr: `fr-${id}`,
    texte_en: `en-${id}`,
    cible_type: 'toutes',
    priorite: 'normale',
    actif: true,
    ...extra,
  });
  const messages = [
    msg('tous', {}),
    msg('sg', { cible_type: 'gares', gares: ['saint-gervais'] }),
    msg('expire', { expire_at: '2020-01-01T00:00:00Z' }),
    msg('inactif', { actif: false }),
  ];

  it('sans `?gare=`, seuls les messages qui visent toutes les gares', () => {
    const html = rendEmbed(entree({ grille: GRAND, jour, messages }));
    expect(html).toContain('fr-tous');
    expect(html).not.toContain('fr-sg');
    expect(html).not.toContain('fr-expire');
    expect(html).not.toContain('fr-inactif');
  });

  it('avec `?gare=`, ceux de la gare en plus', () => {
    const html = rendEmbed(entree({ grille: GRAND, jour, messages, gareUrl: 'saint-gervais' }));
    expect(html).toContain('fr-tous');
    expect(html).toContain('fr-sg');
    expect(html).toContain('en-sg');
  });

  it('un message est ÉCHAPPÉ : la saisie de la supervision ne devient jamais du HTML', () => {
    const html = rendEmbed(
      entree({
        grille: GRAND,
        jour,
        messages: [msg('x', { texte_fr: '<img src=x onerror=alert(1)>' })],
      }),
    );
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});
