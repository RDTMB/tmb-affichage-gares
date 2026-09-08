// F-16 — une journée non confirmée ne doit plus être peinte comme confirmée.
//
// `Jour.enregistre` existe, le provider le renseigne, et AUCUN écran ne le
// lisait. À faux, les écrans servent la grille THÉORIQUE : journée jamais
// ouverte en supervision (début de saison, week-end) ou génération interrompue
// entre les deux requêtes. Ce ne sont pas des horaires inventés — c'est
// l'absence de signal quand l'application sait qu'elle ne sert pas la journée
// d'exploitation.
//
// Le badge du coin portait déjà l'ÂGE des données. Les deux situations peuvent
// coexister, d'où la détermination §5.C éprouvée ici : un seul badge, deux
// faits, la nature avant l'âge, et l'âge jamais écrasé en silence.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { badgeFraicheur } from './affichage-commun';
import { SEUIL_BADGE_MS } from './resilience';

const CACHE_MS = 15 * 60_000;
const FRAIS = 30_000;
const AGEES = SEUIL_BADGE_MS + 60_000;

function etat(
  complement: Parameters<typeof badgeFraicheur>[0] extends infer T ? Partial<T> : never,
) {
  return badgeFraicheur({
    ageMs: FRAIS,
    seuilBadgeMs: SEUIL_BADGE_MS,
    dureeCacheMs: CACHE_MS,
    heureSync: '07:12',
    jour: { enregistre: true },
    veille: false,
    ...complement,
  });
}

function source(chemin: string): string {
  const url = new URL(`../../${chemin}`, import.meta.url);
  return readFileSync(fileURLToPath(url), 'utf-8').replace(/\r\n/g, '\n');
}

describe('le badge se tait quand il n’a rien à dire', () => {
  it('journée confirmée et données fraîches : aucun badge', () => {
    expect(etat({})).toEqual({ visible: false, texte: '' });
  });

  it('veille de nuit : rien à l’écran, donc rien à qualifier', () => {
    // Le badge a un z-index supérieur à celui de la veille : il peindrait
    // par-dessus l'écran noir. Le défaut existait déjà pour l'âge seul.
    expect(etat({ veille: true, ageMs: AGEES }).visible).toBe(false);
    expect(etat({ veille: true, jour: { enregistre: false } }).visible).toBe(false);
  });

  it('écran neutre (données au-delà du cache) : aucun badge', () => {
    // Au-delà de `duree_cache_min` l'écran passe en neutre : plus aucun
    // horaire n'est affiché, donc plus rien à qualifier.
    expect(etat({ ageMs: CACHE_MS + 1 }).visible).toBe(false);
    expect(etat({ ageMs: CACHE_MS + 1, jour: { enregistre: false } }).visible).toBe(false);
  });

  it('aucune donnée du tout : aucun badge', () => {
    expect(etat({ ageMs: null }).visible).toBe(false);
    expect(etat({ ageMs: null, jour: { enregistre: false } }).visible).toBe(false);
  });

  it('HORS SAISON : `enregistre` est faux pour une raison légitime', () => {
    // Aucune journée n'est créée quand rien ne circule, et l'écran porte déjà
    // son état « aucun service aujourd'hui ». Le drapeau n'aurait rien à dire,
    // et il s'afficherait tous les jours de l'hiver.
    expect(etat({ jour: { enregistre: false, hors_saison: true } }).visible).toBe(false);
    // Même avec des données âgées, la nature ne s'ajoute pas — seul l'âge.
    const horsSaisonAgee = etat({
      ageMs: AGEES,
      jour: { enregistre: false, hors_saison: true },
    });
    expect(horsSaisonAgee.visible).toBe(true);
    expect(horsSaisonAgee.texte).toBe('Données de 07:12 / Data from 07:12');
    expect(horsSaisonAgee.texte).not.toContain('théoriques');
  });

  it('`jour` absent : aucun drapeau inventé', () => {
    // La journée n'est pas encore arrivée : `enregistre` n'est ni vrai ni
    // faux. Ne rien affirmer.
    expect(etat({ jour: null }).visible).toBe(false);
    expect(etat({ jour: {} }).visible).toBe(false);
  });
});

describe('l’âge seul — le comportement d’avant, inchangé', () => {
  it('rend exactement le texte historique', () => {
    // Aucune régression sur ce que les six écrans affichent déjà.
    const r = etat({ ageMs: AGEES });
    expect(r.visible).toBe(true);
    expect(r.texte).toBe('Données de 07:12 / Data from 07:12');
  });

  it('sous le seuil, rien : deux minutes de retard ne se signalent pas', () => {
    expect(etat({ ageMs: SEUIL_BADGE_MS }).visible).toBe(false);
    expect(etat({ ageMs: SEUIL_BADGE_MS + 1 }).visible).toBe(true);
  });

  it('sans heure de synchronisation, le badge le dit plutôt que de mentir', () => {
    expect(etat({ ageMs: AGEES, heureSync: null }).texte).toBe(
      'Données de --:-- / Data from --:--',
    );
  });
});

describe('§5.C — la journée non confirmée, et la cohabitation', () => {
  it('journée non confirmée avec données FRAÎCHES : la nature, bilingue', () => {
    const r = etat({ jour: { enregistre: false } });
    expect(r.visible).toBe(true);
    expect(r.texte).toBe(
      'Horaires théoriques — journée non confirmée / Theoretical timetable — day not confirmed',
    );
  });

  it('les DEUX faits quand les deux s’appliquent, la nature d’abord', () => {
    // C'est la détermination. La nature passe devant : « Données de 07:12 »
    // laisse conclure que l'information est vraie et vieille de trois minutes,
    // ce qui est plus trompeur qu'utile quand la journée n'a jamais été
    // confirmée. Mais l'âge n'est PAS écrasé — un message qui en écrase un
    // autre en silence est le défaut qu'on corrige.
    const r = etat({ ageMs: AGEES, jour: { enregistre: false } });
    expect(r.visible).toBe(true);
    expect(r.texte).toBe(
      'Horaires théoriques — journée non confirmée / Theoretical timetable — day not confirmed' +
        ' · Données de 07:12 / Data from 07:12',
    );
    // L'ordre compte : la nature en tête, elle se lit la première.
    expect(r.texte.indexOf('non confirmée')).toBeLessThan(r.texte.indexOf('Données de'));
  });

  it('UN SEUL badge, jamais deux : un écran de gare n’est pas un mur de bandeaux', () => {
    // Le contrat est une chaîne unique. Deux badges auraient demandé un
    // second emplacement, une seconde couleur, et un écran qui empile.
    const r = etat({ ageMs: AGEES, jour: { enregistre: false } });
    expect(r.texte.split('·')).toHaveLength(2);
    expect(typeof r.texte).toBe('string');
  });

  it('`enregistre: true` ne déclenche jamais la nature', () => {
    expect(etat({ ageMs: AGEES, jour: { enregistre: true } }).texte).not.toContain('théoriques');
  });
});

describe('les deux pages lisent bien le drapeau', () => {
  for (const fichier of ['src/pages/ecran.ts', 'src/pages/grille.ts']) {
    it(`${fichier} appelle badgeFraicheur() et lui passe \`jour\``, () => {
      // Avant le correctif, `Jour.enregistre` n'était lu par AUCUN écran :
      // c'est ce branchement qui est le correctif, pas la fonction pure.
      const src = source(fichier);
      expect(src).toContain('badgeFraicheur({');
      expect(src).toMatch(/jour,/);
      expect(src).toContain("document.body.classList.toggle('mode-degrade', badge.visible)");
      // Plus aucun texte de badge construit sur place : une seule voix.
      expect(src).not.toContain('`Données de ${quand}');
    });
  }

  it('l’écran de gare ne calcule sa veille QU’UNE fois, et la passe au badge', () => {
    // Le badge peignait par-dessus l'écran de veille (z-index 60 contre 50)
    // quand les données avaient plus de deux minutes à 22 h. Passer `veille`
    // au badge corrige ce défaut préexistant par la même occasion.
    const src = source('src/pages/ecran.ts');
    expect(src.match(/estEnVeille\(maintenant\)/g) ?? []).toHaveLength(1);
    expect(src).toMatch(/veille,\r?\n\s*\}\);/);
  });

  it('la grille n’a pas de veille de nuit, et le dit', () => {
    expect(source('src/pages/grille.ts')).toContain('veille: false');
  });
});
