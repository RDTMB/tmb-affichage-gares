// §B — ne plus croire l'horloge du poste.
//
// LE CONTEXTE MATÉRIEL, qui n'est pas une hypothèse. Le Raspberry n'a pas de
// pile : à froid il redémarre sur une date fantaisiste, et tant que l'horloge
// est fausse tout HTTPS échoue — certificats « pas encore valides ». Un service
// de correction existe sur le Pi, qui lit l'en-tête `Date` d'une requête HTTPS
// quand le NTP est filtré. Le code, lui, ne savait rien de tout cela : il
// affichait des comptes à rebours calculés sur une horloge qu'il croyait juste.
//
// LES DEUX SEUILS, et leur justification par une conséquence :
//   - 5 s, l'écran le DIT. En dessous, rien de visible ne change — les heures
//     s'affichent à la minute. Et un poste dont la correction fonctionne
//     n'atteint jamais 5 s : le dépasser signifie qu'elle a décroché.
//   - 30 s, l'écran n'affiche PLUS d'horaires. C'est exactement
//     `SEUIL_IMMINENT_S` : « À QUAI » court jusqu'à D − 30 s, « DÉPART
//     IMMINENT » de là au départ. À 30 s d'écart ces états sont décalés d'un
//     cran entier, l'écran peut afficher « PARTI » pour un train encore à quai,
//     et un voyageur qui lit « PARTI » s'en va.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { SEUIL_IMMINENT_S } from './horaires';
import {
  ECART_BLOQUANT_MS,
  ECART_DIT_MS,
  ecartDepuisEntete,
  etatHorloge,
  type EtatHorloge,
} from './horloge';

function source(chemin: string): string {
  const url = new URL(`../../${chemin}`, import.meta.url);
  return readFileSync(fileURLToPath(url), 'utf-8').replace(/\r\n/g, '\n');
}

describe('les deux seuils sont ancrés, pas choisis ronds', () => {
  it('le seuil BLOQUANT vaut la fenêtre des états de quai', () => {
    // Dérivé de la constante du moteur : si la fenêtre de quai change un jour,
    // le seuil suit au lieu de rester un chiffre orphelin.
    expect(SEUIL_IMMINENT_S).toBe(30);
    expect(ECART_BLOQUANT_MS).toBe(SEUIL_IMMINENT_S * 1000);
    expect(source('src/core/horloge.ts')).toContain('SEUIL_IMMINENT_S * 1000');
  });

  it('le seuil DIT est très en dessous, et laisse dix fois l’incertitude de mesure', () => {
    // L'en-tête `Date` n'a qu'une résolution d'une seconde : la mesure porte
    // ±0,5 s. Un seuil de 5 s ne peut donc pas être atteint par le bruit.
    expect(ECART_DIT_MS).toBe(5_000);
    expect(ECART_DIT_MS).toBeLessThan(ECART_BLOQUANT_MS);
    expect(ECART_BLOQUANT_MS / ECART_DIT_MS).toBe(6);
  });
});

describe('etatHorloge() — les trois zones', () => {
  const cas: { ecart: number | null; attendu: EtatHorloge; pourquoi: string }[] = [
    { ecart: 0, attendu: 'juste', pourquoi: 'horloge exacte' },
    { ecart: 4_999, attendu: 'juste', pourquoi: 'juste sous le seuil qui parle' },
    { ecart: 5_000, attendu: 'ecart-dit', pourquoi: 'le seuil est atteint, pas dépassé' },
    { ecart: 20_000, attendu: 'ecart-dit', pourquoi: 'entre les deux seuils' },
    { ecart: 29_999, attendu: 'ecart-dit', pourquoi: 'juste sous le seuil bloquant' },
    { ecart: 30_000, attendu: 'ecart-bloquant', pourquoi: 'la fenêtre de quai est atteinte' },
    { ecart: 3_600_000, attendu: 'ecart-bloquant', pourquoi: 'une heure de dérive' },
  ];

  for (const { ecart, attendu, pourquoi } of cas) {
    it(`${ecart} ms → ${attendu} (${pourquoi})`, () => {
      expect(etatHorloge(ecart)).toBe(attendu);
    });
  }

  it('le SIGNE ne compte pas : en avance fausse autant qu’en retard', () => {
    // Un compte à rebours calculé sur une horloge en avance annonce un départ
    // déjà passé ; en retard, il retient un voyageur sur le quai. Les deux
    // trompent.
    for (const ecart of [5_000, 20_000, 30_000, 120_000]) {
      expect(etatHorloge(-ecart), `−${ecart}`).toBe(etatHorloge(ecart));
    }
  });

  it('AUCUNE mesure vaut « juste », et ce n’est pas de l’optimisme', () => {
    // L'absence prolongée de réponse serveur est DÉJÀ traitée par l'âge des
    // données, qui fait passer l'écran en neutre au-delà de duree_cache_min.
    // Un second chemin vers le même écran neutre donnerait deux causes pour
    // une seule situation, et un diagnostic ambigu le jour où il faudra
    // comprendre pourquoi une gare est noire.
    expect(etatHorloge(null)).toBe('juste');
  });
});

describe('ecartDepuisEntete() — la mesure ne coûte aucune requête', () => {
  const T0 = Date.UTC(2026, 8, 8, 10, 0, 0);
  const ENTETE = new Date(T0).toUTCString();

  it('horloge juste, aller-retour instantané : écart nul', () => {
    expect(ecartDepuisEntete(ENTETE, T0, T0)).toBe(0);
  });

  it('l’instant retenu est le MILIEU de l’aller-retour, pas la réception', () => {
    // Sans cela, le temps de trajet de la réponse s'ajouterait intégralement à
    // l'écart : une 5G lente passerait pour une horloge fausse. Ici 4 s de
    // trajet sur une horloge juste doivent donner 2 s, pas 4.
    expect(ecartDepuisEntete(ENTETE, T0, T0 + 4_000)).toBe(2_000);
  });

  it('horloge du poste EN AVANCE : écart positif', () => {
    // Le poste croit qu'il est 10:01 quand le serveur dit 10:00.
    expect(ecartDepuisEntete(ENTETE, T0 + 60_000, T0 + 60_000)).toBe(60_000);
  });

  it('horloge du poste EN RETARD : écart négatif', () => {
    expect(ecartDepuisEntete(ENTETE, T0 - 60_000, T0 - 60_000)).toBe(-60_000);
  });

  it('en-tête absent ou illisible : AUCUNE mesure, pas une mesure fausse', () => {
    // L'appelant garde alors la dernière valeur connue : une référence un peu
    // ancienne vaut mieux qu'une référence inventée.
    for (const entete of [null, undefined, '', 'pas une date', 'Mon, 99 Xxx 9999']) {
      expect(ecartDepuisEntete(entete, T0, T0), JSON.stringify(entete)).toBeNull();
    }
  });

  it('un aller-retour NÉGATIF est refusé : l’horloge a sauté pendant la requête', () => {
    // La mesure n'a alors aucun sens, et le milieu d'un intervalle inversé
    // donnerait un écart arbitraire.
    expect(ecartDepuisEntete(ENTETE, T0 + 10_000, T0)).toBeNull();
  });

  it('une dérive d’un jour est mesurée telle quelle, sans borne', () => {
    // Le cas du Raspberry sans pile qui redémarre en 1970 ou en 2035 : c'est
    // `etatHorloge` qui décide quoi en faire, pas la mesure.
    const unJour = 24 * 60 * 60 * 1000;
    expect(ecartDepuisEntete(ENTETE, T0 + unJour, T0 + unJour)).toBe(unJour);
    expect(etatHorloge(unJour)).toBe('ecart-bloquant');
  });
});

describe('les deux pages agissent sur l’état, et de la bonne façon', () => {
  for (const chemin of ['src/pages/ecran.ts', 'src/pages/grille.ts']) {
    it(`${chemin} : bandeau à « ecart-dit », écran neutre à « ecart-bloquant »`, () => {
      const src = source(chemin);
      expect(src).toContain('etatHorloge(fournisseur?.ecartHorlogeMs() ?? null)');
      expect(src).toContain(
        "document.body.classList.toggle('mode-horloge', horloge === 'ecart-dit')",
      );
      // Le seuil bloquant s'ajoute aux causes EXISTANTES de l'écran neutre :
      // une seule sortie, pas un second chemin parallèle.
      expect(src).toMatch(
        /const neutre = age === null \|\| age > dureeCacheMs\(\) \|\| horloge === 'ecart-bloquant'/,
      );
    });

    it(`${chemin} : le bandeau existe dans la page et n’est pas masquable`, () => {
      const html = source(chemin.replace('src/pages/', '').replace('.ts', '.html'));
      expect(html).toContain('id="bandeau-horloge"');
      // Bilingue, comme tout ce que lit un voyageur.
      expect(html).toContain('Horloge du poste déréglée');
      expect(html).toContain('Station clock out of sync');
    });
  }

  it('la mesure lit l’en-tête `Date` des réponses DÉJÀ demandées', () => {
    // « Il n'y a pas de requête supplémentaire à faire, seulement une réponse
    // à lire » : la mesure vit dans le `fetch` du client Supabase.
    const src = source('src/data/supabase.ts');
    expect(src).toContain("ecartDepuisEntete(reponse.headers.get('date')");
    expect(src).toContain('global: {');
    // Une mesure illisible ne remplace pas la précédente.
    expect(src).toContain('if (mesure !== null) this.ecartMs = mesure;');
  });

  it('le bandeau porte le ROUGE de la charte, pas le marine des bandeaux de test', () => {
    // « Heure simulée » et « Démonstration » disent « ceci est un essai ».
    // Celui-ci dit « ce qui est affiché peut être faux » : ce n'est pas le
    // même message, il ne doit pas avoir la même couleur.
    for (const feuille of ['src/styles/ecran.css', 'src/styles/grille.css']) {
      const css = source(feuille);
      const bloc = css.slice(css.indexOf('.bandeau-horloge {'));
      expect(bloc.slice(0, 400), feuille).toContain('background: var(--rouge)');
    }
  });
});
