// Bandeau voyageurs : quand l'anglais manque (traduction indisponible), le
// français doit s'afficher SEUL — sans séparateur orphelin ni bloc vide, et
// jamais de faux anglais fabriqué.
import { describe, expect, it, vi } from 'vitest';

import grandServiceJson from '../../docs/grilles-historique/2026-ete-grand-service.json';
import { paramsValides } from '../core/params';
import type { Grille, Message, Params } from '../core/types';
import {
  avecDelai,
  CACHE_MAX_MINUTES,
  CACHE_MIN_MINUTES,
  contenuTicker,
  creeJournalHeartbeat,
  dureeCacheMinutes,
  INTERVALLE_HEARTBEAT_MS,
  meteoHtml,
} from './affichage-commun';
import { identifiantEcran, identifiantEcranDeclare } from './supervision-logique';

function message(id: string, fr: string, en: string): Message {
  return {
    id,
    texte_fr: fr,
    texte_en: en,
    cible_type: 'toutes',
    priorite: 'normale',
    actif: true,
  };
}

describe('contenuTicker', () => {
  it('affiche « FR • EN » quand la traduction existe', () => {
    const html = contenuTicker([
      message('a', 'Réservation obligatoire.', 'Booking is compulsory.'),
    ]);
    expect(html).toContain('Réservation obligatoire.');
    expect(html).toContain('class="sep"');
    expect(html).toContain('Booking is compulsory.');
  });

  it('n’affiche QUE le français quand texte_en est vide : aucun séparateur orphelin', () => {
    const html = contenuTicker([message('a', 'Quai glissant, soyez prudents.', '')]);
    expect(html).toBe('Quai glissant, soyez prudents.');
    expect(html).not.toContain('class="sep"');
    expect(html).not.toContain('class="en"');
  });

  it('traite de la même façon un anglais réduit à des espaces', () => {
    expect(contenuTicker([message('a', 'Texte français.', '   ')])).toBe('Texte français.');
  });

  it('n’affiche jamais un préfixe « [EN] » fabriqué', () => {
    const html = contenuTicker([message('a', 'Phrase inconnue du dictionnaire.', '')]);
    expect(html).not.toContain('[EN]');
  });

  it('sépare plusieurs messages, y compris mixtes (traduits et non traduits)', () => {
    const html = contenuTicker([
      message('a', 'Un.', 'One.'),
      message('b', 'Deux.', ''),
      message('c', 'Trois.', 'Three.'),
    ]);
    expect(html.split('<span class="sep">◆</span>')).toHaveLength(3);
    // Le message non traduit n'apporte ni « • » ni bloc anglais
    expect(html.match(/class="en"/g)).toHaveLength(2);
    expect(html.match(/<span class="sep">•<\/span>/g)).toHaveLength(2);
  });

  it('échappe le HTML des deux langues', () => {
    const html = contenuTicker([message('a', '<b>fr</b> & "x"', "<i>en</i> & 'y'")]);
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<i>');
    expect(html).toContain('&amp;');
  });
});

describe('Signal de vie : un échec ne doit jamais interrompre l’affichage', () => {
  it('trace une fois par cause, sans jamais lever', () => {
    const traces: string[] = [];
    const espion = vi.spyOn(console, 'warn').mockImplementation((m: unknown) => {
      traces.push(String(m));
    });
    const journalise = creeJournalHeartbeat();

    // Même cause répétée à chaque cycle : une seule trace (18 h/jour de kiosque)
    for (let i = 0; i < 50; i += 1) {
      expect(() => journalise(new Error('réseau injoignable'))).not.toThrow();
    }
    expect(traces).toHaveLength(1);
    expect(traces[0]).toContain('réseau injoignable');
    expect(traces[0]).toContain('réessai au prochain cycle');

    // Une cause DIFFÉRENTE mérite sa trace
    journalise(new Error('Écran « le-fayet-ecran-1 » non déclaré en supervision'));
    expect(traces).toHaveLength(2);
    expect(traces[1]).toContain('non déclaré');

    // Une valeur qui n'est pas une Error ne casse rien non plus
    expect(() => journalise('panne')).not.toThrow();
    expect(traces).toHaveLength(3);
    espion.mockRestore();
  });

  it('la cadence du signal de vie est celle attendue par la supervision', () => {
    expect(INTERVALLE_HEARTBEAT_MS).toBe(60_000);
  });
});

describe('Identifiant de poste : déclaration et écran tombent sur la même chaîne', () => {
  it('la convention est partagée', () => {
    expect(identifiantEcranDeclare('ecran', 'le-fayet')).toBe('le-fayet-ecran-1');
    expect(identifiantEcranDeclare('grille', 'bellevue', 2)).toBe('bellevue-grille-2');
    // Ce que l'écran calcule pour lui-même doit être déclarable à l'identique
    expect(identifiantEcran('ecran', 'motivon', null)).toBe(
      identifiantEcranDeclare('ecran', 'motivon'),
    );
    expect(identifiantEcran('grille', 'col-de-voza', null)).toBe(
      identifiantEcranDeclare('grille', 'col-de-voza'),
    );
  });

  it('le paramètre ?ecran= reste prioritaire (poste nommé à la main)', () => {
    expect(identifiantEcran('ecran', 'le-fayet', 'hall-principal')).toBe('hall-principal');
  });
});

// ---------------------------------------------------------------------------
// C-01 — la température vient du jsonb `params.valeur` : le typage TypeScript
// ne vaut qu'à la compilation, et le rôle `caisse` peut y écrire n'importe
// quoi. Rien de ce qu'elle contient ne doit atteindre le DOM.
// ---------------------------------------------------------------------------

const GRILLE = grandServiceJson as unknown as Grille;

function paramsMeteo(meteo: unknown): Params {
  return paramsValides({ meteo_sommet: meteo });
}

describe('meteoHtml — la charge d’attaque n’atteint jamais le DOM', () => {
  it('une température porteuse de HTML n’injecte rien et affiche « — »', () => {
    const html = meteoHtml(paramsMeteo({ t: '<img src=x onerror=alert(1)>' }), GRILLE);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror');
    expect(html).toContain('—°C');
  });

  it('même sans validation préalable, le rendu seul neutralise la charge', () => {
    // Ceinture ET bretelles : la page ne doit pas dépendre du fournisseur.
    const brut = {
      meteo_sommet: { t: '<script>alert(1)</script>', ciel_fr: 'Beau', ciel_en: 'Fine' },
    } as unknown as Params;
    const html = meteoHtml(brut, GRILLE);
    expect(html).not.toContain('<script>');
    expect(html).toContain('—°C');
  });

  it('un libellé de ciel porteur de HTML est échappé', () => {
    const html = meteoHtml(
      paramsMeteo({ t: 9, ciel_fr: '<script>x</script>', ciel_en: 'Fine' }),
      GRILLE,
    );
    expect(html).not.toContain('<script>');
  });

  it('affiche les températures légitimes, négatives comprises', () => {
    expect(meteoHtml(paramsMeteo({ t: -3, ciel_fr: 'Neige', ciel_en: 'Snow' }), GRILLE)).toContain(
      '-3°C',
    );
    expect(meteoHtml(paramsMeteo({ t: 9, ciel_fr: 'Dégagé', ciel_en: 'Clear' }), GRILLE)).toContain(
      '9°C',
    );
  });

  it('ne LÈVE pas sur une heure de relevé non textuelle (écran figé sinon)', () => {
    const brut = {
      meteo_sommet: { t: 9, ciel_fr: 'A', ciel_en: 'B', heure_releve: 915 },
    } as unknown as Params;
    expect(() => meteoHtml(brut, GRILLE)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// C-06 — ?cache= est une commande de TEST, pas une porte ouverte.
// ---------------------------------------------------------------------------

describe('dureeCacheMinutes : la bascule vers l’écran neutre reste bornée', () => {
  const BASE = 15;

  it('sans surcharge, le paramètre de base s’applique', () => {
    expect(dureeCacheMinutes(null, BASE)).toBe(BASE);
    expect(dureeCacheMinutes('', BASE)).toBe(BASE);
    expect(dureeCacheMinutes('   ', BASE)).toBe(BASE);
  });

  it('sans paramètre de base non plus, on retombe sur 15 min', () => {
    // Un instantané d'avant le déploiement n'a pas la colonne.
    expect(dureeCacheMinutes(null, undefined)).toBe(15);
  });

  it('?cache=5 est bien APPLIQUÉ : la commande de test sert encore', () => {
    expect(dureeCacheMinutes('5', BASE)).toBe(5);
    expect(dureeCacheMinutes('30', BASE)).toBe(30);
  });

  it('?cache=0 retombe sur la base : jamais d’écran neutre immédiat', () => {
    // Zéro basculait l'écran en neutre à la seconde même, en pleine journée
    // d'exploitation, sans que personne sur place puisse en trouver la cause.
    expect(dureeCacheMinutes('0', BASE)).toBe(BASE);
    expect(dureeCacheMinutes('-10', BASE)).toBe(BASE);
    expect(dureeCacheMinutes('2', BASE)).toBe(BASE);
  });

  it('?cache=99999 retombe sur la base : jamais les horaires de la veille', () => {
    // L'inverse, et le plus grave : des horaires périmés affichés comme
    // valides, indéfiniment.
    expect(dureeCacheMinutes('99999', BASE)).toBe(BASE);
    expect(dureeCacheMinutes('61', BASE)).toBe(BASE);
    expect(dureeCacheMinutes('Infinity', BASE)).toBe(BASE);
  });

  it('?cache=abc retombe sur la base, sans NaN qui contamine le calcul', () => {
    // `Number('abc')` valait NaN, et toute comparaison avec NaN étant fausse,
    // l'écran ne passait JAMAIS en neutre.
    for (const brut of ['abc', 'quinze', '1e999', 'null']) {
      const d = dureeCacheMinutes(brut, BASE);
      expect(Number.isFinite(d)).toBe(true);
      expect(d).toBe(BASE);
    }
  });

  it('les bornes exactes sont acceptées', () => {
    expect(dureeCacheMinutes(String(CACHE_MIN_MINUTES), BASE)).toBe(CACHE_MIN_MINUTES);
    expect(dureeCacheMinutes(String(CACHE_MAX_MINUTES), BASE)).toBe(CACHE_MAX_MINUTES);
  });

  it('quelle que soit l’entrée, la durée reste exploitable', () => {
    for (const brut of [null, '', 'abc', '0', '-1', '99999', '7', 'NaN']) {
      const d = dureeCacheMinutes(brut, BASE);
      expect(d).toBeGreaterThanOrEqual(CACHE_MIN_MINUTES);
      expect(d).toBeLessThanOrEqual(CACHE_MAX_MINUTES);
    }
  });
});

describe('avecDelai : une première synchronisation ne bloque jamais la page', () => {
  // `avecDelai` s'appuie sur `window.setTimeout` (code de page) ; la suite
  // tourne en environnement Node.
  function avecFenetre<T>(action: () => Promise<T>): Promise<T> {
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    return action().finally(() => vi.unstubAllGlobals());
  }

  it('rend la valeur quand la promesse aboutit à temps', async () => {
    await avecFenetre(async () => {
      expect(await avecDelai(Promise.resolve(true), 1000, false)).toBe(true);
    });
  });

  it('rend la valeur de repli quand la promesse ÉCHOUE', async () => {
    await avecFenetre(async () => {
      expect(await avecDelai(Promise.reject(new Error('réseau')), 1000, false)).toBe(false);
    });
  });

  it('rend la valeur de repli quand la promesse ne revient JAMAIS', async () => {
    // Le cas réel : une requête qui ne rend pas la main laissait la page sur
    // sa coquille HTML, tableau VIDE — lu en gare comme « plus aucun train ».
    await avecFenetre(async () => {
      const jamais = new Promise<boolean>(() => {});
      expect(await avecDelai(jamais, 20, false)).toBe(false);
    });
  });

  it('une promesse tardive n’écrase pas le repli déjà rendu', async () => {
    await avecFenetre(async () => {
      let resoud: (v: boolean) => void = () => {};
      const tardive = new Promise<boolean>((r) => (resoud = r));
      const resultat = await avecDelai(tardive, 20, false);
      expect(resultat).toBe(false);
      resoud(true); // arrive après : la valeur déjà rendue ne change pas
      expect(resultat).toBe(false);
    });
  });

  it('le minuteur est TOUJOURS nettoyé (18 h d’affichage par jour)', async () => {
    const poses = new Set<unknown>();
    vi.stubGlobal('window', {
      setTimeout: (fn: () => void, ms: number) => {
        const id = setTimeout(fn, ms);
        poses.add(id);
        return id;
      },
      clearTimeout: (id: unknown) => {
        poses.delete(id);
        clearTimeout(id as ReturnType<typeof setTimeout>);
      },
    });
    try {
      await avecDelai(Promise.resolve(true), 5000, false);
      await avecDelai(Promise.reject(new Error('réseau')), 5000, false);
      expect(poses.size).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
