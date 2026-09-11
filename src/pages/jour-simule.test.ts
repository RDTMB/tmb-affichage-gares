// `?jour=AAAA-MM-JJ` — simuler la JOURNÉE D'EXPLOITATION sur un écran.
//
// CE QUE CES TESTS PROTÈGENT. Le paramètre existe pour qu'on puisse regarder
// aujourd'hui ce que l'écran de gare montrera demain — sans quoi un train créé
// pour demain n'est vérifiable que demain. Deux choses peuvent se casser en
// silence :
//
//  1. qu'il déplace AUSSI l'horloge. Décaler `maintenantMs()` de plusieurs
//     jours ferait expirer tous les messages et fausserait le cycle des
//     médias : l'écran aurait l'air de marcher tout en montrant autre chose
//     que la réalité. C'est le seul point du lot qui se verrait trop tard ;
//  2. qu'il se taise. Une heure décalée de trois heures se remarque au premier
//     coup d'œil ; la grille de demain a l'air parfaitement normale. Un écran
//     qui affiche une autre journée sans le dire ment plus que l'heure simulée.
//
// Non prouvé ici : le rendu du bandeau (mesuré au navigateur).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { bandeauSimulation } from './affichage-commun';
import { creeSourceHeure } from './horloge-source';

/** Fins de ligne normalisées : poste en CRLF, coureur d'intégration en LF. */
function source(chemin: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${chemin}`, import.meta.url)), 'utf-8').replace(
    /\r\n/g,
    '\n',
  );
}

describe('`?jour=` déplace la JOURNÉE, pas l’horloge', () => {
  it('`dateISO()` suit le paramètre, au jour près', () => {
    const source = creeSourceHeure(null, '2026-09-12');
    expect(source.dateISO()).toBe('2026-09-12');
    expect(source.jourSimule).toBe('2026-09-12');
  });

  it('`maintenantMs()` n’est PAS décalé — c’est tout l’intérêt', () => {
    // Les `expire_at` des messages et le cycle des médias se comparent à cet
    // horodatage : le décaler de trois mois éteindrait tous les messages.
    const avance = creeSourceHeure(null, '2027-01-15');
    expect(Math.abs(avance.maintenantMs() - Date.now())).toBeLessThan(2000);
  });

  it('`maintenantS()` non plus : l’écran reste à l’heure du poste', () => {
    const reel = creeSourceHeure(null);
    const simule = creeSourceHeure(null, '2027-01-15');
    expect(Math.abs(simule.maintenantS() - reel.maintenantS())).toBeLessThanOrEqual(1);
  });

  it('`dateLongue()` suit le jour simulé', () => {
    expect(creeSourceHeure(null, '2026-09-12').dateLongue()).toBe('Samedi 12 septembre');
  });

  it('sans le paramètre, rien ne bouge', () => {
    const source = creeSourceHeure(null);
    expect(source.jourSimule).toBeNull();
    expect(source.dateISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('une valeur invalide est IGNORÉE, jamais fatale', () => {
  // Même règle que `?simule=` avec une heure mal formée : on ne casse pas un
  // écran de gare sur une faute de frappe dans une URL.
  it.each([
    ['forme libre', 'demain'],
    ['sans zéros', '2026-9-1'],
    ['à l’américaine', '09/12/2026'],
    ['vide', ''],
    ['mois inexistant', '2026-13-01'],
    ['jour zéro', '2026-09-00'],
    ['31 juin', '2026-06-31'],
    ['29 février hors bissextile', '2027-02-29'],
  ])('%s : « %s » ne simule rien', (_cas, valeur) => {
    const source = creeSourceHeure(null, valeur);
    expect(source.jourSimule).toBeNull();
    // Et la date réelle continue d'être servie : pas de `null`, pas de NaN.
    expect(source.dateISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('le 29 février d’une année bissextile, lui, passe', () => {
    // Sans ce cas, un contrôle trop zélé (« février fait 28 jours ») passerait
    // tous les autres.
    expect(creeSourceHeure(null, '2028-02-29').jourSimule).toBe('2028-02-29');
  });
});

describe('`?jour=` et `?simule=` se combinent', () => {
  it('la date vient de l’un, l’heure de l’autre', () => {
    const source = creeSourceHeure('06:30:00', '2026-09-12');
    expect(source.dateISO()).toBe('2026-09-12');
    expect(source.simulee).toBe(true);
    expect(source.maintenantS()).toBeGreaterThanOrEqual(6 * 3600 + 30 * 60);
    expect(source.maintenantS()).toBeLessThan(6 * 3600 + 31 * 60);
  });

  it('une heure invalide n’emporte pas la date, et réciproquement', () => {
    expect(creeSourceHeure('n’importe quoi', '2026-09-12').jourSimule).toBe('2026-09-12');
    expect(creeSourceHeure('n’importe quoi', '2026-09-12').simulee).toBe(false);
    expect(creeSourceHeure('06:30', 'demain').simulee).toBe(true);
    expect(creeSourceHeure('06:30', 'demain').jourSimule).toBeNull();
  });
});

describe('le bandeau dit CE QUI est simulé', () => {
  it('rien de simulé : pas de bandeau', () => {
    expect(bandeauSimulation({ heureSimulee: false, jourSimule: null })).toBeNull();
  });

  it('heure seule : la formulation d’origine, au mot près', () => {
    // Elle est en gare depuis le lot 5 : la changer sans raison serait la
    // changer pour tout le monde.
    expect(bandeauSimulation({ heureSimulee: true, jourSimule: null })).toEqual({
      fr: 'Heure simulée — affichage de test',
      en: 'Simulated time — test display',
    });
  });

  it('journée seule : la DATE est écrite, pas seulement « test »', () => {
    // « affichage de test » seul laisserait croire à un décalage d'heure.
    const b = bandeauSimulation({ heureSimulee: false, jourSimule: '2026-09-12' });
    expect(b?.fr).toBe('Journée simulée : samedi 12 septembre 2026 — affichage de test');
    expect(b?.en).toBe('Simulated day: Saturday, 12 September 2026 — test display');
  });

  it('les deux : le bandeau le dit, et reste UN seul bandeau', () => {
    const b = bandeauSimulation({ heureSimulee: true, jourSimule: '2026-09-12' });
    expect(b?.fr).toBe('Journée et heure simulées : samedi 12 septembre 2026 — affichage de test');
    expect(b?.en).toBe('Simulated day and time: Saturday, 12 September 2026 — test display');
  });

  it('l’année en fait partie : une saison se prépare en consultant la précédente', () => {
    expect(bandeauSimulation({ heureSimulee: false, jourSimule: '2027-07-01' })?.fr).toContain(
      '2027',
    );
  });
});

describe('les deux pages d’affichage le câblent, et de la même façon', () => {
  for (const [page, html] of [
    ['src/pages/ecran.ts', 'ecran.html'],
    ['src/pages/grille.ts', 'grille.html'],
  ] as const) {
    it(`${page} lit \`?jour=\` et pose le bandeau`, () => {
      const code = source(page);
      expect(code).toContain("creeSourceHeure(url.get('simule'), url.get('jour'))");
      // Le bandeau est posé dès que l'UN des deux est simulé.
      expect(code).toContain(
        "if (heure.simulee || heure.jourSimule) document.body.classList.add('mode-simule');",
      );
      expect(code).toContain('bandeauSimulation({');
      expect(code).toContain("poser('bandeau-simule-fr'");
      expect(code).toContain("poser('bandeau-simule-en'");
      // « AVANT le premier await » est déjà verrouillé par
      // demarrage-ecrans.test.ts, sur le code débarrassé de ses commentaires —
      // le refaire ici sur la source brute revient à mesurer le mot « await »
      // écrit dans un commentaire, ce qui a effectivement échoué.
    });

    it(`${html} porte les deux textes, adressables`, () => {
      const balisage = source(html);
      expect(balisage).toContain('id="bandeau-simule-fr"');
      expect(balisage).toContain('id="bandeau-simule-en"');
      // Le texte écrit en dur reste celui de l'heure seule : c'est ce qui
      // s'affiche si le script échoue avant de le remplacer.
      expect(balisage).toContain('Heure simulée — affichage de test');
    });
  }

  it('la supervision n’est pas concernée : elle affiche déjà la date qu’elle veut', () => {
    expect(source('src/pages/supervision.ts')).not.toContain("url.get('jour')");
  });
});

describe('le commentaire de `badgeFraicheur` ne ment plus', () => {
  it('il ne prétend plus que la date future n’existe pas', () => {
    // Il l'affirmait — « vérifié, pas supposé » — et ce lot l'a rendu faux.
    const code = source('src/pages/affichage-commun.ts');
    expect(code).not.toContain('le cas « date future consultée volontairement »');
    expect(code).toContain('DATE FUTURE CONSULTÉE VOLONTAIREMENT');
  });

  it('et le badge reste juste sans être touché', () => {
    // Une journée à venir non ouverte porte `enregistre: false` : c'est
    // exactement ce que le badge doit annoncer. Rien à adapter.
    const code = source('src/pages/affichage-commun.ts');
    const corps = /export function badgeFraicheur\([\s\S]*?\n}\n/.exec(code)?.[0] ?? '';
    expect(corps, 'badgeFraicheur introuvable').not.toBe('');
    expect(corps).toContain('e.jour?.enregistre === false');
    expect(corps).not.toContain('jourSimule');
  });
});
