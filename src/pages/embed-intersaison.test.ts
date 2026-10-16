// L'embed du site web — l'intersaison se DIT, l'heure vient du SERVEUR
// (lot du 16/10/2026, suite de embed.test.ts).
//
// 1. « Fermé » ne s'écrit QUE dans un cas : aucune grille, et une date
//    strictement entre la fin d'une période déclarée et le début de la
//    suivante. Chaque ligne du tableau de décision est rendue pour de vrai,
//    bornes comprises (veille du début, début, fin, lendemain de la fin).
// 2. Une horloge visiteur en avance de 5 min, ou en retard de 2 min, donne les
//    MÊMES prochains départs qu'une horloge juste : l'écart mesuré sur
//    l'en-tête `Date` est appliqué, et dans le bon sens.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import grandServiceJson from '../../docs/grilles-historique/2026-ete-grand-service.json';
import petitServiceJson from '../../docs/grilles-historique/2026-ete-petit-service.json';
import { ecartDepuisEntete } from '../core/horloge';
import {
  generationJour,
  grillePourJour,
  heureVersSecondes,
  serviceActif,
  vueJournee,
} from '../core/horaires';
import { paramsValides } from '../core/params';
import { apercuSiteWeb, messageSansHoraires } from '../core/periodes-exploitation';
import type { Grille, Jour, Message, Params } from '../core/types';
import {
  departsParSens,
  etatEmbed,
  MESSAGES_REPLI,
  rendEmbed,
  type EntreeRendu,
} from './embed-logique';
import { creeSourceHeure } from './horloge-source';

const RACINE = fileURLToPath(new URL('../../', import.meta.url));
const codeSeul = (chemin: string): string =>
  readFileSync(join(RACINE, chemin), 'utf-8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const GRAND = grandServiceJson as unknown as Grille;
const PETIT = petitServiceJson as unknown as Grille;
const ETE = [GRAND, PETIT];

/** Valeurs initiales données par l'exploitant le 16/10/2026. */
const PERIODES = [
  { du: '2026-06-13', au: '2026-09-27' },
  { du: '2026-12-12', au: '2027-03-29' },
];

const avecPeriodes = (periodes: unknown): Params =>
  paramsValides({ periodes_exploitation: periodes });

function jourSansGrille(date: string): Jour {
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

/** La page, rendue comme `embed.ts` la rendrait pour ce jour, ces grilles, ces périodes. */
function rendDate(
  date: string,
  grilles: Grille[],
  params: Params | null,
  extra: Partial<EntreeRendu> = {},
): string {
  // Comme le fournisseur : une journée générée sur la grille en vigueur, ou
  // une journée hors saison quand aucune ne couvre la date.
  const enVigueur = serviceActif(grilles, date);
  const jour = enVigueur ? generationJour(enVigueur, date) : jourSansGrille(date);
  const grille = grillePourJour(grilles, jour);
  return rendEmbed({
    etat: etatEmbed(true, vueJournee(grilles, jour, grille)),
    grille,
    grilleDemain: null,
    jour,
    params,
    messages: [],
    affluence: [],
    gareUrl: null,
    ongletDemande: null,
    vue: 'departs',
    maintenant_s: heureVersSecondes('10:30'),
    maintenantMs: Date.parse(`${date}T08:30:00Z`),
    dateISO: date,
    dateLongue: date,
    heureSync: '10:29',
    badge: '',
    simulation: null,
    urlInfos: 'https://www.tramwaydumontblanc.fr/horaires-tarifs/',
    ...extra,
  });
}

const FERME = /ferm|closed/i;

// ---------------------------------------------------------------------------
// Le tableau de décision, ligne par ligne
// ---------------------------------------------------------------------------

describe('sans grille : l’intersaison déclarée se dit, le reste ne dit rien', () => {
  const P = avecPeriodes(PERIODES);

  it('une grille couvre la date : les HORAIRES, même hors des périodes déclarées', () => {
    // Le 15/07/2026, le grand service roule. Une déclaration qui l'exclurait
    // (saisie erronée, ou dates déplacées) ne doit pas masquer des trains qui
    // circulent : la grille l'emporte.
    const horsPeriodes = avecPeriodes([
      { du: '2026-06-13', au: '2026-07-01' },
      { du: '2026-12-12', au: '2027-03-29' },
    ]);
    const html = rendDate('2026-07-15', ETE, horsPeriodes);
    expect(html).toContain('class="depart');
    expect(html).not.toContain('class="repli');
    expect(html).not.toContain('intersaison');
  });

  it('aucune grille, date STRICTEMENT entre deux périodes : intersaison, avec la réouverture', () => {
    const html = rendDate('2026-10-16', ETE, P);
    expect(html).toContain('Le Tramway du Mont-Blanc est fermé pour l&#39;intersaison.');
    expect(html).toContain('Réouverture le samedi 12 décembre 2026.');
    expect(html).toContain('The Mont Blanc Tramway is closed between seasons.');
    expect(html).toContain('Reopening on Saturday 12 December 2026.');
    // Le lien vers la page d'informations suit le message, comme pour le neutre.
    expect(html).toContain('href="https://www.tramwaydumontblanc.fr/horaires-tarifs/"');
    expect(html).not.toContain(MESSAGES_REPLI.sansGrille.fr);
  });

  it('aucune grille, date DANS une période déclarée : le message neutre', () => {
    // Hiver 2026-2027 : déclaré, mais sa grille n'est pas encore saisie.
    const html = rendDate('2027-01-15', ETE, P);
    expect(html).not.toMatch(FERME);
    expect(html).toContain(MESSAGES_REPLI.sansGrille.fr);
  });

  for (const [cas, date] of [
    ['avant la première période', '2026-05-01'],
    ['après la dernière période', '2027-04-15'],
  ] as const) {
    it(`aucune grille, date ${cas} : le message neutre — personne n’a dit quand ça rouvre`, () => {
      const html = rendDate(date, ETE, P);
      expect(html).not.toMatch(FERME);
      expect(html).toContain(MESSAGES_REPLI.sansGrille.fr);
    });
  }

  it('aucune période déclarée (ou liste corrompue) : le message neutre, comme au 15/10', () => {
    for (const params of [null, avecPeriodes([]), avecPeriodes('n’importe quoi')]) {
      const html = rendDate('2026-10-16', ETE, params);
      expect(html).not.toMatch(FERME);
      expect(html).toContain(MESSAGES_REPLI.sansGrille.fr);
    }
  });

  it('base injoignable : inchangé, même en pleine intersaison déclarée', () => {
    const html = rendDate('2026-10-16', ETE, P, { etat: 'injoignable' });
    expect(html).not.toMatch(FERME);
    expect(html).toContain(MESSAGES_REPLI.injoignable.fr);
  });

  it('les messages d’exploitation restent masqués sans grille, intersaison comprise', () => {
    const message: Message = {
      id: 'm',
      texte_fr: 'Message de la ligne',
      texte_en: 'Line message',
      cible_type: 'toutes',
      priorite: 'normale',
      actif: true,
    };
    const html = rendDate('2026-10-16', ETE, P, { messages: [message] });
    expect(html).toContain('intersaison');
    expect(html).not.toContain('Message de la ligne');
  });

  it('la vue « Toute la journée » dit la même chose', () => {
    const html = rendDate('2026-10-16', ETE, P, { vue: 'jour' });
    expect(html).toContain('Réouverture le samedi 12 décembre 2026.');
    expect(html).not.toContain('<table');
  });
});

describe('les bornes : inclusives dans la période, strictes dans l’intersaison', () => {
  const P = avecPeriodes(PERIODES);
  // Aucune grille du tout : chaque date tombe dans le cas « sans grille »,
  // et seule la déclaration décide.
  const AUCUNE: Grille[] = [];

  for (const [nom, date, intersaison] of [
    ['le `au` de l’été lui-même', '2026-09-27', false],
    ['le lendemain du `au`', '2026-09-28', true],
    ['la veille du `du` de l’hiver', '2026-12-11', true],
    ['le `du` de l’hiver lui-même', '2026-12-12', false],
  ] as const) {
    it(`${nom} (${date}) : ${intersaison ? 'intersaison' : 'message neutre'}`, () => {
      const html = rendDate(date, AUCUNE, P);
      if (intersaison) {
        expect(html).toMatch(FERME);
        expect(html).toContain('Réouverture le samedi 12 décembre 2026.');
      } else {
        expect(html).not.toMatch(FERME);
        expect(html).toContain(MESSAGES_REPLI.sansGrille.fr);
      }
    });
  }

  it('une liste saisie dans le DÉSORDRE est triée à la lecture : l’intersaison se trouve', () => {
    // Survivant visé : sans le tri, la recherche de la période suivante
    // tomberait sur l'hiver en premier et ne trouverait pas l'été avant lui.
    const desordre = avecPeriodes([PERIODES[1], PERIODES[0]]);
    expect(desordre.periodes_exploitation).toEqual(PERIODES);
    expect(rendDate('2026-10-16', AUCUNE, desordre)).toContain(
      'Réouverture le samedi 12 décembre 2026.',
    );
  });
});

describe('la date de réouverture ne dépend ni du fuseau ni de la locale du visiteur', () => {
  it('« samedi 12 décembre 2026 », quel que soit le fuseau du poste qui exécute', () => {
    // La suite tourne sous Europe/Paris ET sous UTC (coureur CI) : ce test
    // est donc éprouvé dans les deux.
    const m = messageSansHoraires(avecPeriodes(PERIODES).periodes_exploitation, '2026-10-16');
    expect(m.fr[1]).toBe('Réouverture le samedi 12 décembre 2026.');
    expect(m.en[1]).toBe('Reopening on Saturday 12 December 2026.');
  });

  it('l’aperçu de la supervision cite LE texte de l’embed, produit par la même fonction', () => {
    const periodes = avecPeriodes(PERIODES).periodes_exploitation;
    const m = messageSansHoraires(periodes, '2026-10-16');
    expect(apercuSiteWeb(ETE, periodes, '2026-10-16')).toContain(m.fr.join(' '));
    expect(apercuSiteWeb(ETE, periodes, '2027-01-15')).toContain(MESSAGES_REPLI.sansGrille.fr);
    expect(apercuSiteWeb(ETE, periodes, '2026-07-15')).toContain('horaires du jour');
    // Et l'embed comme la supervision passent par elle.
    expect(codeSeul('src/pages/embed-logique.ts')).toContain('messageSansHoraires(');
    expect(codeSeul('src/pages/supervision.ts')).toContain('apercuSiteWeb(');
  });
});

// ---------------------------------------------------------------------------
// L'heure vient du serveur
// ---------------------------------------------------------------------------

describe('l’embed se cale sur l’heure du serveur', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** 15/07/2026, 10:30:00 à Paris (UTC+2) : l'heure JUSTE, celle du serveur. */
  const JUSTE_MS = Date.UTC(2026, 6, 15, 8, 30, 0);
  const jour = generationJour(GRAND, '2026-07-15');

  /** Source d'heure d'un visiteur dont l'horloge a `avanceMs` d'avance. */
  function sourceDecalee(avanceMs: number): ReturnType<typeof creeSourceHeure> {
    vi.useFakeTimers();
    vi.setSystemTime(JUSTE_MS + avanceMs);
    // L'écart, mesuré comme le fournisseur le mesure : en-tête `Date` du
    // serveur (heure juste), envoi et réception à l'horloge locale.
    const entete = new Date(JUSTE_MS).toUTCString();
    const ecart = ecartDepuisEntete(entete, Date.now(), Date.now());
    return creeSourceHeure(null, null, () => ecart);
  }

  it('le SIGNE de l’écart : une horloge en avance donne un écart positif', () => {
    vi.useFakeTimers();
    vi.setSystemTime(JUSTE_MS + 300_000);
    expect(ecartDepuisEntete(new Date(JUSTE_MS).toUTCString(), Date.now(), Date.now())).toBe(
      300_000,
    );
  });

  for (const [nom, avance] of [
    ['en avance de 5 min', 300_000],
    ['en retard de 2 min', -120_000],
    ['juste', 0],
  ] as const) {
    it(`horloge visiteur ${nom} : mêmes prochains départs qu’à l’heure juste`, () => {
      const source = sourceDecalee(avance);
      expect(source.maintenantS()).toBe(heureVersSecondes('10:30'));
      expect(source.maintenantMs()).toBe(JUSTE_MS);
      expect(source.dateISO()).toBe('2026-07-15');
      const attendus = departsParSens(GRAND, jour, 'saint-gervais', heureVersSecondes('10:30'), []);
      const vus = departsParSens(GRAND, jour, 'saint-gervais', source.maintenantS(), []);
      expect(vus.montee.map((p) => p.numero)).toEqual(attendus.montee.map((p) => p.numero));
      expect(vus.descente.map((p) => p.numero)).toEqual(attendus.descente.map((p) => p.numero));
    });
  }

  it('une horloge décalée d’UN JOUR voit la bonne journée', () => {
    expect(sourceDecalee(86_400_000).dateISO()).toBe('2026-07-15');
    expect(sourceDecalee(-86_400_000).dateISO()).toBe('2026-07-15');
  });

  it('tant qu’aucune mesure n’existe, l’horloge locale sert', () => {
    vi.useFakeTimers();
    vi.setSystemTime(JUSTE_MS + 300_000);
    expect(creeSourceHeure(null, null, () => null).maintenantMs()).toBe(JUSTE_MS + 300_000);
  });

  it('une heure SIMULÉE n’est pas recalée : elle sauterait à la première réponse', () => {
    vi.useFakeTimers();
    vi.setSystemTime(JUSTE_MS);
    const avant = creeSourceHeure('14:05', null).maintenantS();
    expect(creeSourceHeure('14:05', null, () => 300_000).maintenantS()).toBe(avant);
  });

  it('embed.ts branche la correction, et l’écart ne le rend plus jamais indisponible', () => {
    const code = codeSeul('src/pages/embed.ts');
    expect(code).toContain('() => fournisseur?.ecartHorlogeMs() ?? null');
    expect(code).not.toContain('etatHorloge');
    expect(code).not.toContain('ecart-bloquant');
  });

  it('les écrans de gare et la grille gardent LEUR règle : ni correction, ni changement', () => {
    for (const page of ['src/pages/ecran.ts', 'src/pages/grille.ts']) {
      const code = codeSeul(page);
      expect(code, page).toContain("creeSourceHeure(url.get('simule'), url.get('jour'));");
      expect(code, page).toContain("horloge === 'ecart-bloquant'");
    }
  });
});
