// Hors saison, les pages d'affichage le DISENT — câblage verrouillé par le texte.
//
// LE DÉFAUT DU 28/09/2026. `rendre()` commençait par `if (!grille || !jour)
// return;` et ne testait `jour.hors_saison` qu'ENSUITE. Or c'est justement
// `grille === null` qui définit le hors-saison : le message existait, traduit
// et mis en page, inatteignable dans le seul cas où il servait. L'écran de
// Saint-Gervais montrait des en-têtes vides — deux blocs dans le mauvais
// ordre depuis le 25/08.
//
// La DÉCISION vit dans `vueJournee()` (src/core/horaires.ts, testée par
// src/core/saison.test.ts). Ici on vérifie que les deux pages la consultent
// AVANT toute sortie sur `!grille`, et qu'elles montrent ce qu'elle dit.
// Les pages ne sont pas importables dans Vitest (DOM au chargement) : on lit
// leur texte, comme demarrage-ecrans.test.ts.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(chemin: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${chemin}`, import.meta.url)), 'utf-8').replace(
    /\r\n/g,
    '\n',
  );
}

/** Code seul : un commentaire citant `if (!grille` fausserait l'ordre mesuré. */
function codeSeul(chemin: string): string {
  return source(chemin)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** Corps d'une fonction, extrait par comptage d'accolades depuis son en-tête. */
function corpsDe(code: string, entete: string): string {
  const debut = code.indexOf(entete);
  if (debut === -1) return '';
  const ouvre = code.indexOf('{', debut);
  let profondeur = 1;
  let i = ouvre + 1;
  while (i < code.length && profondeur > 0) {
    if (code[i] === '{') profondeur++;
    else if (code[i] === '}') profondeur--;
    i++;
  }
  return code.slice(ouvre + 1, i - 1);
}

for (const [page, entete] of [
  ['src/pages/ecran.ts', 'function rendre(gare: GareId)'],
  ['src/pages/grille.ts', 'function rendre()'],
] as const) {
  describe(`${page} — le hors-saison est atteignable quand la grille manque`, () => {
    const corps = corpsDe(codeSeul(page), entete);

    it('rendre() est bien trouvée', () => {
      expect(corps.length).toBeGreaterThan(200);
    });

    it('consulte vueJournee() AVANT toute sortie sur `!grille`', () => {
      const decision = corps.indexOf('vueJournee(');
      expect(decision, 'vueJournee() absente de rendre()').toBeGreaterThan(-1);
      const garde = corps.search(/if \(!grille\b/);
      if (garde !== -1) expect(decision).toBeLessThan(garde);
    });

    it('ne rejuge plus le hors-saison dans la page : la décision est dans src/core/', () => {
      expect(corps).not.toContain('jour.hors_saison');
    });

    it('bascule la classe `mode-fermee` selon la décision', () => {
      expect(corps).toMatch(/classList\.toggle\('mode-fermee', fermee\)/);
      expect(corps).toContain("vue === 'fermee'");
    });

    it('n’annonce la fermeture que sur des données jugées fiables', () => {
      // Données périmées ou horloge du poste fantaisiste (Raspberry sans pile,
      // qui repart sur une date au hasard) : la date elle-même n'est plus sûre,
      // et « fermé » serait une affirmation sur une journée qu'on ne connaît pas.
      expect(corps).toMatch(/const vue = neutreDonnees \? null : vueJournee\(/);
      expect(corps).toMatch(
        /const neutreDonnees =\s*age === null \|\| age > dureeCacheMs\(\) \|\| horloge === 'ecart-bloquant'/,
      );
    });

    it('un trou de saisie mène à l’écran NEUTRE, jamais à la fermeture', () => {
      expect(corps).toMatch(/neutreDonnees \|\| vue === 'indisponible'/);
    });

    it('retient les grilles reçues : sans elles, aucune fermeture ne s’annoncerait jamais', () => {
      // Trouvé par la campagne de mutation : sans cette ligne, `grilles` reste
      // vide, etatSaison() ne voit aucune période et répond « incertaine » —
      // l'écran passe en neutre au lieu d'annoncer la fermeture, sans qu'aucun
      // autre test ne bronche.
      const applique = corpsDe(codeSeul(page), 'const applique = (d:');
      expect(applique).toContain('grilles = d.grilles;');
    });
  });
}

describe('écran de gare — hors saison, veille permanente et message sous l’horloge', () => {
  const corps = corpsDe(codeSeul('src/pages/ecran.ts'), 'function rendre(gare: GareId)');

  it('la fermeture FORCE la veille, quelle que soit l’heure de la plage de nuit', () => {
    expect(corps).toMatch(/const veille = fermee \|\| estEnVeille\(maintenant\)/);
  });

  it('le bandeau ne défile PAS hors saison : la veille sort avant majTicker()', () => {
    const sortie = corps.indexOf('if (veille) {');
    expect(sortie).toBeGreaterThan(-1);
    expect(sortie).toBeLessThan(corps.indexOf('majTicker('));
    expect(corps.slice(sortie, corps.indexOf('}', sortie))).toContain('return');
  });

  it('le message est dans le bloc `.veille`, bilingue, français d’abord', () => {
    const html = source('ecran.html');
    const debut = html.indexOf('<div class="veille">');
    expect(debut).toBeGreaterThan(-1);
    const bloc = html.slice(debut, html.indexOf('<script', debut));
    const horloge = bloc.indexOf('id="horloge-veille"');
    const fr = bloc.indexOf('Le Tramway du Mont-Blanc est fermé');
    const en = bloc.indexOf('The Mont Blanc Tramway is closed');
    expect(horloge).toBeGreaterThan(-1);
    expect(fr, 'message sous l’horloge').toBeGreaterThan(horloge);
    expect(en, 'anglais sous le français').toBeGreaterThan(fr);
    expect(bloc).toContain('Reprise selon le calendrier saisonnier');
  });

  it('le message n’apparaît qu’en fermeture : la veille de nuit reste une horloge seule', () => {
    const css = source('src/styles/ecran.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/\.veille \.fermeture-veille\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(/body\.mode-fermee \.veille \.fermeture-veille\s*\{[^}]*display:\s*block/);
  });

  it('le message reste dans le registre de l’horloge : bleu-gris, estompé, plus petit', () => {
    const css = source('src/styles/ecran.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const regle = (sel: string): string =>
      new RegExp(`${sel.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
    const horloge = regle('.veille .horloge-veille');
    const message = regle('.veille .fermeture-veille');
    const taille = (r: string): number => Number(/font-size:\s*([\d.]+)vh/.exec(r)?.[1] ?? NaN);
    const opacite = (r: string): number => Number(/opacity:\s*([\d.]+)/.exec(r)?.[1] ?? NaN);
    expect(horloge).toContain('var(--bleu-gris)');
    expect(message).toContain('var(--bleu-gris)');
    expect(taille(message)).toBeLessThan(taille(horloge));
    expect(opacite(message)).toBeLessThanOrEqual(opacite(horloge));
  });
});

describe('grille du jour — hors saison, le message en pleine page', () => {
  const corps = corpsDe(codeSeul('src/pages/grille.ts'), 'function rendre()');

  it('garde son bandeau de messages : c’est là que l’exploitation annonce la réouverture', () => {
    const bloc = corps.slice(corps.indexOf('if (fermee) {'));
    expect(bloc.slice(0, bloc.indexOf('return'))).toContain('majTicker(');
  });

  it('sans grille, l’en-tête et le pied ne gardent RIEN de la grille précédente', () => {
    // Trouvé par la campagne de mutation : au passage de minuit, le lendemain
    // de la dernière période, « Today's timetable · Petit service » restait
    // au-dessus du message de fermeture, et la météo du sommet en pied.
    const corps = corpsDe(codeSeul('src/pages/grille.ts'), 'function rendsEntetesEtPied()');
    const sansGrille = corpsDe(corps, 'if (!grille)');
    expect(sansGrille).toContain(`$('sous-titre').textContent = "Today's timetable";`);
    expect(sansGrille).toContain("$('bandeau-section').style.display = 'none';");
    expect(sansGrille).toContain("$('meteo').innerHTML = '';");
    expect(sansGrille).toContain('return;');
    expect(corps.indexOf('if (!grille)')).toBeLessThan(corps.indexOf('grille.libelle'));
  });

  it('porte le message bilingue, français d’abord, avec le logo rond blanc', () => {
    const html = source('grille.html');
    const debut = html.indexOf('<div class="fermeture"');
    expect(debut).toBeGreaterThan(-1);
    const bloc = html.slice(debut, html.indexOf('</div>', html.indexOf('</p>', debut)));
    const fr = bloc.indexOf('Le Tramway du Mont-Blanc est fermé');
    const en = bloc.indexOf('The Mont Blanc Tramway is closed');
    expect(fr).toBeGreaterThan(-1);
    expect(en).toBeGreaterThan(fr);
    expect(bloc).toContain('id="logo-fermeture"');
    expect(source('src/pages/grille.ts')).toContain(
      "($('logo-fermeture') as HTMLImageElement).src = __LOGO_ROND_BLANC__;",
    );
  });

  it('en fermeture, les tableaux et la légende s’effacent au profit du message', () => {
    const css = source('src/styles/grille.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/\.fermeture\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(/body\.mode-fermee \.fermeture\s*\{[^}]*display:\s*flex/);
    expect(css).toMatch(
      /body\.mode-fermee \.sens,\s*body\.mode-fermee \.legende,\s*body\.mode-fermee \.bandeau-section\s*\{[^}]*display:\s*none/,
    );
  });
});
