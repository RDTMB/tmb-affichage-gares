// Supervision — adaptation au TÉLÉPHONE, pour les gestes d'urgence.
//
// Ce que la supervision doit permettre au doigt à 390 px (et 768) : se
// connecter, publier un message de bandeau, changer le statut d'un train,
// recharger un écran. Les autres onglets doivent seulement rester lisibles
// sans jamais faire déborder la page. Mesuré au navigateur le 06/09/2026 :
// 0 px de débordement horizontal à 1440, 1280, 1024, 768 et 390.
//
// Verrouillage du TEXTE des fichiers, comme demarrage-ecrans.test.ts : la
// page n'est pas importable dans Vitest (DOM dès le chargement, pas de jsdom).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(chemin: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${chemin}`, import.meta.url)), 'utf-8');
}

/** Feuille sans commentaires : un exemple cité en commentaire fausserait les tests. */
const css = source('src/styles/supervision.css').replace(/\/\*[\s\S]*?\*\//g, '');
const html = source('supervision.html');
const ts = source('src/pages/supervision.ts');

interface BlocMedia {
  requete: string;
  corps: string;
}

interface Regle {
  selecteurs: string[];
  declarations: string;
}

/** Sépare les règles hors `@media` des blocs `@media` (accolades appariées). */
function decoupe(feuille: string): { horsMedia: string; medias: BlocMedia[] } {
  const medias: BlocMedia[] = [];
  let horsMedia = '';
  let i = 0;
  while (i < feuille.length) {
    const debut = feuille.indexOf('@media', i);
    if (debut === -1) {
      horsMedia += feuille.slice(i);
      break;
    }
    horsMedia += feuille.slice(i, debut);
    const ouvre = feuille.indexOf('{', debut);
    let profondeur = 1;
    let j = ouvre + 1;
    while (j < feuille.length && profondeur > 0) {
      if (feuille[j] === '{') profondeur++;
      else if (feuille[j] === '}') profondeur--;
      j++;
    }
    medias.push({
      requete: feuille.slice(debut + '@media'.length, ouvre).trim(),
      corps: feuille.slice(ouvre + 1, j - 1),
    });
    i = j;
  }
  return { horsMedia, medias };
}

/** Règles `sélecteurs { déclarations }` d'un fragment sans `@media` imbriqué. */
function regles(fragment: string): Regle[] {
  const out: Regle[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fragment)) !== null) {
    const selecteurs = (m[1] ?? '')
      .split(',')
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    out.push({ selecteurs, declarations: m[2] ?? '' });
  }
  return out;
}

/** Valeur d'une propriété dans un bloc de déclarations, ou null. */
function valeur(declarations: string, propriete: string): string | null {
  const m = new RegExp(`(?:^|;|\\s)${propriete.replace(/-/g, '\\-')}\\s*:\\s*([^;]+)`).exec(
    declarations,
  );
  return m ? (m[1] ?? '').trim() : null;
}

/** Règles d'un fragment portant `propriete`, indexées par sélecteur individuel. */
function parSelecteur(fragment: string, propriete: string): Map<string, string> {
  const index = new Map<string, string>();
  for (const regle of regles(fragment)) {
    const v = valeur(regle.declarations, propriete);
    if (v === null) continue;
    for (const s of regle.selecteurs) index.set(s, v);
  }
  return index;
}

const { horsMedia, medias } = decoupe(css);
const telephone = medias.find((b) => b.requete === '(max-width: 768px)');
const etroit = medias.find((b) => b.requete === '(max-width: 700px)');
const corpsTelephone = telephone?.corps ?? '';

describe('supervision.css — les seuils', () => {
  it('quatre requêtes par largeur, pas une de plus : 1150, 1100 (préexistantes), 768 et 700', () => {
    // 1100 et 1150 protègent la barre du jour et la grille des paramètres ;
    // elles ne bougent pas sans mesure (consigne). 768 est le seuil
    // téléphone/tablette, 700 celui où la carte passe de quatre colonnes à
    // deux. Un cinquième seuil serait une valeur non mesurée.
    const largeurs = medias
      .map((b) => /max-width:\s*(\d+)px/.exec(b.requete)?.[1])
      .filter(Boolean)
      .map(Number)
      .sort((a, b) => b - a);
    expect(largeurs).toEqual([1150, 1100, 768, 700]);
    expect(medias).toHaveLength(4);
  });

  it('les seuils préexistants gardent leur rôle', () => {
    const m1100 = medias.find((b) => b.requete === '(max-width: 1100px)');
    const m1150 = medias.find((b) => b.requete === '(max-width: 1150px)');
    expect(parSelecteur(m1100?.corps ?? '', 'overflow-x').get('.barre-jour .rang-journee')).toBe(
      'auto',
    );
    expect(parSelecteur(m1150?.corps ?? '', 'grid-template-columns').get('.param-grid')).toBe(
      '1fr',
    );
  });
});

describe('barre « Publier » — une réserve qui suit la hauteur réelle', () => {
  it('body et toast lisent --barre-publier-h, avec les valeurs de bureau en repli', () => {
    // 70 + 22 = les 92 px d'origine ; le toast reste AU-DESSUS de la barre.
    expect(parSelecteur(horsMedia, 'padding-bottom').get('body')).toBe(
      'calc(var(--barre-publier-h, 70px) + 22px)',
    );
    expect(parSelecteur(horsMedia, 'bottom').get('.toast')).toBe(
      'calc(var(--barre-publier-h, 70px) + 30px)',
    );
  });

  it('au téléphone, le repli est la barre mesurée sur deux rangs (115 px)', () => {
    // Mesuré à 390 : 124 px de barre pour 92 de réserve avant correction —
    // la dernière carte restait cachée. Le repli vaut avant la première
    // image, ou sans ResizeObserver.
    expect(parSelecteur(corpsTelephone, 'padding-bottom').get('body')).toBe(
      'calc(var(--barre-publier-h, 115px) + 22px)',
    );
  });

  it('supervision.ts publie la hauteur réelle par ResizeObserver, sans jamais planter sans lui', () => {
    const fonction = /function suitHauteurBarrePublier\(\): void \{([\s\S]*?)\n\}/.exec(ts)?.[1];
    expect(fonction, 'suitHauteurBarrePublier() absente').toBeDefined();
    expect(fonction).toContain("if (typeof ResizeObserver === 'undefined') return;");
    expect(fonction).toContain("$('barre-publier')");
    expect(fonction).toContain("setProperty('--barre-publier-h'");
    // Barre masquée avant connexion : hauteur nulle, on garde le repli.
    expect(fonction).toMatch(/if \(hauteur > 0\)/);
    // Appelée à l'initialisation, avant la connexion : l'observateur voit la
    // barre apparaître.
    expect(ts).toMatch(/function initPublication\(\): void \{\s*suitHauteurBarrePublier\(\);/);
  });
});

describe('tableaux trop larges — ils défilent dans leur cadre', () => {
  it('.defilable enveloppe #tab-circ et #tab-grilles, et seulement des tableaux', () => {
    // Entre 769 et ~1075 px le tableau des circulations (1 022 px au plus
    // serré) dépassait la carte, dont `overflow: hidden` rognait la colonne
    // Motif sans rien dire ; les quatre colonnes fixes des grilles (740 px)
    // débordaient partout sous 800.
    expect(html).toMatch(/<div class="defilable">\s*<table id="tab-circ">/);
    expect(html).toMatch(/<div class="defilable">\s*<table id="tab-grilles">/);
    const enveloppes = html.match(/<div class="defilable">\s*<(\w+)/g) ?? [];
    expect(enveloppes).toHaveLength(2);
    expect(parSelecteur(horsMedia, 'overflow-x').get('.defilable')).toBe('auto');
  });
});

describe('sous 768 px — la circulation devient une carte par train (§A.3)', () => {
  it('le bloc téléphone existe, et le bloc 700 ne fait que réordonner la carte', () => {
    expect(telephone).toBeDefined();
    expect(etroit).toBeDefined();
    // À 700 : uniquement #tab-circ (colonnes et zones), rien d'autre.
    for (const regle of regles(etroit?.corps ?? '')) {
      for (const s of regle.selecteurs) expect(s, s).toMatch(/^#tab-circ /);
    }
  });

  it('le tableau ENTIER quitte la mise en page tabulaire — aucune cellule ne « sort de son rang »', () => {
    // Le piège du 5 septembre : `td { display: flex }` casse la hauteur de
    // rang (39 px pour 52). Ici il n'y a plus de rang : table, tbody, tr et
    // td sont tous sortis de la mise en page tabulaire ensemble.
    const display = parSelecteur(corpsTelephone, 'display');
    expect(display.get('#tab-circ thead')).toBe('none');
    expect(display.get('#tab-circ')).toBe('block');
    expect(display.get('#tab-circ tbody')).toBe('block');
    expect(display.get('#tab-circ tbody tr')).toBe('grid');
    expect(display.get('#tab-circ tbody td')).toBe('block');
  });

  it('aucun <td> en display: flex, dans aucun bloc — c’est .sens-groupe qui porte le flex', () => {
    const fragments = [horsMedia, ...medias.map((b) => b.corps)];
    for (const fragment of fragments) {
      for (const regle of regles(fragment)) {
        const viseTd = regle.selecteurs.some((s) => /(^|\s)td(\.[\w-]+)*$/.test(s));
        if (viseTd)
          expect(valeur(regle.declarations, 'display'), regle.selecteurs.join()).not.toBe('flex');
      }
    }
    expect(parSelecteur(horsMedia, 'display').get('td.cell-sens > .sens-groupe')).toBe('flex');
  });

  it('quatre colonnes de 701 à 768, deux sous 700, l’heure en tête et le statut à sa droite', () => {
    // Critère de l'exploitant : passer un train en retard en trois gestes
    // sans se tromper de ligne. L'heure (1re cellule) ouvre la carte, le
    // statut (7e) est sur le même rang, à droite.
    const colonnes = parSelecteur(corpsTelephone, 'grid-template-columns');
    expect(colonnes.get('#tab-circ tbody tr')).toBe('repeat(4, minmax(0, 1fr))');
    const zones = parSelecteur(corpsTelephone, 'grid-area');
    expect(zones.get('#tab-circ tbody td:nth-child(1)')).toMatch(/^1 \/ 1 \//);
    expect(zones.get('#tab-circ tbody td:nth-child(7)')).toMatch(/^1 \/ 3 \//);

    const colonnesEtroit = parSelecteur(etroit?.corps ?? '', 'grid-template-columns');
    expect(colonnesEtroit.get('#tab-circ tbody tr')).toBe('minmax(0, 1fr) minmax(0, 1.6fr)');
    const zonesEtroit = parSelecteur(etroit?.corps ?? '', 'grid-area');
    expect(zonesEtroit.get('#tab-circ tbody td:nth-child(1)')).toMatch(/^1 \/ 1 \//);
    expect(zonesEtroit.get('#tab-circ tbody td:nth-child(7)')).toMatch(/^1 \/ 2 \//);
  });

  it('les huit cellules ont une zone, et la cellule « aucun service » prend toute la largeur', () => {
    for (const corps of [corpsTelephone, etroit?.corps ?? '']) {
      const zones = parSelecteur(corps, 'grid-area');
      for (let i = 1; i <= 8; i++) {
        expect(zones.get(`#tab-circ tbody td:nth-child(${i})`), `cellule ${i}`).toBeDefined();
      }
      expect(zones.get('#tab-circ tbody td[colspan]')).toBe('auto / 1 / auto / -1');
    }
  });

  it('les étiquettes ::before reprennent EXACTEMENT le texte des <th> masqués', () => {
    // Sans en-tête de colonne, une rame ou un terminus seuls ne se comprennent
    // pas ; l'heure, le sens et les trois statuts se lisent sans étiquette.
    const thead = /<table id="tab-circ">\s*<thead>([\s\S]*?)<\/thead>/.exec(html)?.[1] ?? '';
    const entetes = [...thead.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => (m[1] ?? '').trim());
    expect(entetes).toEqual([
      'Train',
      'Sens',
      'Rame',
      'Terminus',
      'Facultatif',
      'Sans voyageurs',
      'Statut',
      'Motif',
    ]);
    const contenu = parSelecteur(corpsTelephone, 'content');
    for (const i of [3, 4, 5, 6, 8]) {
      expect(contenu.get(`#tab-circ tbody td:nth-child(${i})::before`), `cellule ${i}`).toBe(
        `'${entetes[i - 1]}'`,
      );
    }
    for (const i of [1, 2, 7]) {
      expect(contenu.has(`#tab-circ tbody td:nth-child(${i})::before`), `cellule ${i}`).toBe(false);
    }
  });
});

describe('sous 768 px — cibles tactiles et bloc collant', () => {
  it('44 px pour les segments de statut, les boutons ±, les boutons légers et les champs', () => {
    // Mesuré avant : segments 59 × 24, boutons ± 26 × 20, boutons légers 27.
    const minH = parSelecteur(corpsTelephone, 'min-height');
    const minW = parSelecteur(corpsTelephone, 'min-width');
    for (const s of ['.seg button', '.retard-ctrl button']) {
      expect(minH.get(s), s).toBe('44px');
      expect(minW.get(s), s).toBe('44px');
    }
    for (const s of [
      'button.leger',
      '.chip-btn',
      'nav.tabs button',
      '.switch',
      '.ajout input',
      '.ajout select',
      '.connexion-carte input',
      '.connexion-carte button',
      "select[data-action='motif']",
      '#tab-circ select',
    ]) {
      expect(minH.get(s), s).toBe('44px');
    }
    expect(minH.get('.publier button')).toBe('48px');
  });

  it('seuls les onglets restent collants, sur une seule rangée qui défile', () => {
    // Mesuré à 390 : en-tête 221 px + onglets = 268 px collants, 32 % d'un
    // écran de 844. `display: contents` sort l'en-tête et les onglets de leur
    // enveloppe : les onglets deviennent collants à top: 0 sans qu'aucune
    // hauteur d'en-tête soit supposée.
    expect(parSelecteur(corpsTelephone, 'display').get('.barre-haute')).toBe('contents');
    expect(parSelecteur(corpsTelephone, 'position').get('nav.tabs')).toBe('sticky');
    expect(parSelecteur(corpsTelephone, 'top').get('nav.tabs')).toBe('0');
    expect(parSelecteur(corpsTelephone, 'overflow-x').get('nav.tabs')).toBe('auto');
    expect(parSelecteur(corpsTelephone, 'white-space').get('nav.tabs button')).toBe('nowrap');
  });

  it('les pastilles de sécurité #pill-base / #pill-simule ne sont masquées par AUCUN bloc', () => {
    // Elles disent sur quelle base on écrit : toujours visibles (§A.4).
    for (const b of medias) {
      for (const regle of regles(b.corps)) {
        const visePastille = regle.selecteurs.some((s) => /#pill-(base|simule)/.test(s));
        if (visePastille) expect(valeur(regle.declarations, 'display')).not.toBe('none');
      }
    }
  });

  it('la carte de connexion tient dans 320 px', () => {
    // 380 px sur un écran de 390 tenait à 5 px près ; à 320 elle débordait.
    expect(horsMedia).toMatch(/width:\s*min\(380px, calc\(100% - 20px\)\)/);
  });

  it('les grilles de médias et d’écrans n’imposent plus 330 px fixes', () => {
    const colonnes = parSelecteur(horsMedia, 'grid-template-columns');
    for (const s of ['.medias', '.ecrans']) {
      expect(colonnes.get(s), s).toBe('repeat(auto-fill, minmax(min(330px, 100%), 1fr))');
    }
  });
});

describe('ce qui ne bouge pas', () => {
  it('base.css et tokens.css ne portent aucune requête média', () => {
    for (const f of ['src/styles/base.css', 'src/styles/tokens.css']) {
      expect(source(f), f).not.toContain('@media');
    }
  });

  it('supervision.html : aucun framework CSS, aucun lien externe', () => {
    expect(html).not.toMatch(/<link[^>]+href="https?:/);
    expect(html).not.toMatch(/<script[^>]+src="https?:/);
    expect(html).toContain('name="viewport"');
  });
});
