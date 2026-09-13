// Cinq pièges désarmés — lot du 13/09/2026.
//
// CE QUE CES TESTS PROTÈGENT. Aucun des points de ce lot n'est une
// fonctionnalité : ce sont des pièges, c'est-à-dire des endroits où le
// logiciel réel et ce qu'on en croit divergeaient sans que rien ne le dise.
// Trois d'entre eux ne se voient PAS en s'en servant :
//
//  1. une borne appliquée à la LECTURE seulement laisse une valeur aberrante
//     entrer en base, et corrige ensuite en silence — l'agent voit sa valeur
//     acceptée, l'écran en affiche une autre, personne n'apprend que les deux
//     diffèrent ;
//  2. un paramètre corrigé sans le dire laisse sa CAUSE en place : la panne est
//     réparée, muette, et se reproduira ;
//  3. une confirmation qui promet « immédiatement » là où le code met au
//     brouillon trompe l'agent au moment précis où il décide.
//
// Non prouvé ici : la règle `.gitattributes` (mesurée par `git add
// --renormalize`, résultat dans la PR) et le contenu de docs/01, qui se
// relisent et ne se testent pas.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  DUREE_HORAIRES_MAX_S,
  DUREE_HORAIRES_MIN_S,
  PARAMS_DEFAUT,
  paramsAvecCorrections,
  paramsValides,
} from '../core/params';
import { dureeHoraireSaisie } from './supervision-logique';

/** Fins de ligne normalisées : poste en CRLF, coureur d'intégration en LF. */
function source(chemin: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${chemin}`, import.meta.url)), 'utf-8').replace(
    /\r\n/g,
    '\n',
  );
}

// ===========================================================================
// §3 — la durée d'affichage est bornée À L'ÉCRITURE
// ===========================================================================
describe('la durée d’affichage se refuse à la saisie, plus seulement à la lecture', () => {
  it('une valeur DANS les bornes passe', () => {
    expect(dureeHoraireSaisie('20')).toBe(20);
    expect(dureeHoraireSaisie(String(DUREE_HORAIRES_MIN_S))).toBe(DUREE_HORAIRES_MIN_S);
    expect(dureeHoraireSaisie(String(DUREE_HORAIRES_MAX_S))).toBe(DUREE_HORAIRES_MAX_S);
  });

  it('une valeur HORS bornes est refusée, dans les deux sens', () => {
    // C'est le défaut : `Number(value) || 20` acceptait 9 000, l'écrivait en
    // base, et la lecture le ramenait à 600 sans rien dire.
    expect(dureeHoraireSaisie(String(DUREE_HORAIRES_MIN_S - 1))).toBeNull();
    expect(dureeHoraireSaisie(String(DUREE_HORAIRES_MAX_S + 1))).toBeNull();
    expect(dureeHoraireSaisie('9000')).toBeNull();
    expect(dureeHoraireSaisie('0')).toBeNull();
    expect(dureeHoraireSaisie('-30')).toBeNull();
  });

  it('ce qui n’est pas un entier est refusé, et `0` n’est pas traité comme vide', () => {
    // `Number('abc') || 20` rendait 20 : une saisie fautive devenait une
    // valeur, et le « || » confondait 0, NaN et la chaîne vide.
    for (const brut of ['', '   ', 'abc', '20,5', '20.5', 'NaN', 'Infinity', '1e400']) {
      expect(dureeHoraireSaisie(brut), brut).toBeNull();
    }
  });

  it('la chaîne vide n’est refusée QUE parce que zéro est hors bornes', () => {
    // Une garde explicite sur la chaîne vide existait ; la campagne de
    // mutation du 13/09 l'a montrée REDONDANTE — `Number('')` vaut 0, que la
    // borne basse rejette déjà, et aucun test ne pouvait distinguer sa
    // présence de son absence. Elle a donc été retirée.
    //
    // Ce test monte la garde sur l'hypothèse qui la rendrait nécessaire :
    // si la borne basse descendait à 0, la chaîne vide deviendrait une durée
    // valide, et il faudrait la rétablir.
    expect(Number('')).toBe(0);
    expect(
      DUREE_HORAIRES_MIN_S,
      'la borne basse est descendue à 0 : rétablir le refus explicite de la chaîne vide',
    ).toBeGreaterThan(0);
    expect(dureeHoraireSaisie('')).toBeNull();
    expect(dureeHoraireSaisie('   ')).toBeNull();
  });

  it('les bornes du CHAMP sont celles de la LECTURE — une seule source', () => {
    // Le cœur du point : deux constantes recopiées finiraient par diverger.
    // On vérifie que la lecture emploie les mêmes symboles, pas les mêmes
    // chiffres.
    const params = source('src/core/params.ts');
    expect(params).toContain('export const DUREE_HORAIRES_MIN_S');
    expect(params).toContain('export const DUREE_HORAIRES_MAX_S');
    expect(params, 'la lecture est repassée à des chiffres écrits en dur').toContain(
      'DUREE_HORAIRES_MIN_S,\n      DUREE_HORAIRES_MAX_S,',
    );
    const logique = source('src/pages/supervision-logique.ts');
    expect(logique).toContain("from '../core/params'");
    expect(logique).toContain('n < DUREE_HORAIRES_MIN_S || n > DUREE_HORAIRES_MAX_S');
    // …et elles se comportent pareil : ce que la saisie accepte, la lecture le
    // garde INTACT. Une divergence de bornes se verrait ici même si les deux
    // fichiers citaient les bons symboles.
    for (const v of [DUREE_HORAIRES_MIN_S, 20, 300, DUREE_HORAIRES_MAX_S]) {
      expect(dureeHoraireSaisie(String(v)), String(v)).toBe(v);
      expect(paramsValides({ duree_horaires_s: v }).duree_horaires_s, String(v)).toBe(v);
    }
  });

  it('le champ porte ses bornes, et le HTML n’en garde pas une copie', () => {
    const ts = source('src/pages/supervision.ts');
    expect(ts).toContain('dureeHoraires.min = String(DUREE_HORAIRES_MIN_S);');
    expect(ts).toContain('dureeHoraires.max = String(DUREE_HORAIRES_MAX_S);');
    expect(ts).toContain('dureeHoraires.title =');
    // Le HTML portait `min="5" max="600"` en dur pendant que l'écriture ne
    // contrôlait rien : deux copies, dont une seule servait.
    const html = source('supervision.html');
    const champ = /<input type="number" id="duree-horaires"[^>]*>/.exec(html)?.[0] ?? '';
    expect(champ, 'champ duree-horaires introuvable').not.toBe('');
    expect(champ, 'les bornes sont de nouveau recopiées dans le HTML').not.toMatch(/min=|max=/);
  });

  it('le gestionnaire REFUSE au lieu de laisser passer', () => {
    const ts = source('src/pages/supervision.ts');
    // Commentaires retirés : celui qui explique le correctif CITE le défaut
    // (« `Number(value) || 20` n'était pas une borne »). Le lire reviendrait à
    // mesurer une explication au lieu d'une instruction.
    const corps = (
      /\$\('duree-horaires'\)\.addEventListener\([\s\S]*?\n  \}\);/.exec(ts)?.[0] ?? ''
    )
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('//'))
      .join('\n');
    expect(corps, 'gestionnaire introuvable').not.toBe('');
    expect(corps).toContain('dureeHoraireSaisie(champ.value)');
    expect(corps, 'le repli silencieux est revenu').not.toContain('|| 20');
    // Le message DIT les bornes : « valeur invalide » obligerait à les chercher.
    expect(corps).toContain('DUREE_HORAIRES_MIN_S');
    expect(corps).toContain('DUREE_HORAIRES_MAX_S');
  });
});

// ===========================================================================
// §4 — un paramètre corrigé se signale
// ===========================================================================
describe('l’assainissement ne corrige plus en silence', () => {
  it('une valeur aberrante produit un signal, avec le reçu ET le retenu', () => {
    const { params, corriges } = paramsAvecCorrections({ duree_horaires_s: 9000 });
    expect(params.duree_horaires_s).toBe(DUREE_HORAIRES_MAX_S);
    const signal = corriges.find((c) => c.cle === 'duree_horaires_s');
    expect(signal, 'aucun signal pour une valeur hors bornes').toBeDefined();
    expect(signal?.recu).toBe('9000');
    expect(signal?.retenu).toBe(String(DUREE_HORAIRES_MAX_S));
  });

  it('une valeur CORRECTE n’en produit aucun', () => {
    // Un avertissement permanent finit par ne plus être lu.
    expect(paramsAvecCorrections({ duree_horaires_s: 20 }).corriges).toEqual([]);
    expect(paramsAvecCorrections(PARAMS_DEFAUT).corriges).toEqual([]);
  });

  it('un paramètre JAMAIS POSÉ n’est pas une correction', () => {
    // Sinon toute base neuve crierait au loup sur chacun de ses défauts.
    expect(paramsAvecCorrections({}).corriges).toEqual([]);
  });

  it('le signal couvre les autres bornes, pas seulement celle du jour', () => {
    const cles = paramsAvecCorrections({
      duree_cache_min: 9999,
      a_quai_origine_s: -5,
      vitesse_ticker_px_s: 1,
      mode_medias: 'zigzag',
    }).corriges.map((c) => c.cle);
    expect(cles).toContain('duree_cache_min');
    expect(cles).toContain('a_quai_origine_s');
    expect(cles).toContain('vitesse_ticker_px_s');
    expect(cles).toContain('mode_medias');
  });

  it('une température illisible est signalée, une absente ne l’est pas', () => {
    const avec = paramsAvecCorrections({ meteo_sommet: { t: 'chaud' } }).corriges;
    expect(avec.map((c) => c.cle)).toContain('meteo_sommet.t');
    expect(paramsAvecCorrections({ meteo_sommet: {} }).corriges).toEqual([]);
  });

  it('`paramsValides()` garde sa signature : les ÉCRANS ne changent pas', () => {
    // Elle est PURE et appelée par les écrans de gare autant que par la
    // supervision. Lui faire rendre la liste aurait obligé quatre appelants à
    // s'en occuper, dont deux qui n'ont personne devant eux pour agir.
    const params = source('src/core/params.ts');
    expect(params).toContain('export function paramsValides(brut: unknown): Params {');
    // Et une SEULE fonction calcule les deux : deux bornages séparés
    // finiraient par ne plus borner pareil.
    expect(params).toContain('const params = paramsValides(o);');
  });

  it('le signal s’affiche en SUPERVISION, et nulle part ailleurs', () => {
    const sup = source('src/pages/supervision.ts');
    expect(sup).toContain('provider.correctionsParams()');
    expect(sup).toContain('bloc.hidden = corriges.length === 0;');
    expect(source('supervision.html')).toContain('id="params-corriges"');
    // Un écran de gare n'a personne pour corriger un paramètre, et le voyageur
    // n'a que faire de savoir que la durée d'affichage était à 9 000 s.
    for (const page of ['src/pages/ecran.ts', 'src/pages/grille.ts'] as const) {
      expect(source(page), `${page} affiche un avertissement de paramètre`).not.toContain(
        'correctionsParams',
      );
    }
  });

  it('les DEUX fournisseurs le tiennent — le mock rejoue le signal', () => {
    // Un mock qui ne le déclencherait jamais laisserait croire qu'il n'existe
    // pas, et la démonstration sert justement à montrer la supervision.
    for (const p of ['src/data/supabase.ts', 'src/data/mock.ts'] as const) {
      expect(source(p), `${p} : paramsAvecCorrections absent`).toContain('paramsAvecCorrections(');
      expect(source(p), `${p} : correctionsParams absent`).toContain('correctionsParams()');
      // LE REPORT, à la lettre. C'est lui qui porte tout le point : sans lui,
      // la liste est calculée et personne ne la voit jamais. Survivante du
      // 13/09 — `this.corrections = []` passait les deux assertions
      // ci-dessus.
      //
      // Pour le MOCK, trois tests de COMPORTEMENT le tiennent aussi
      // (src/data/mock.test.ts). Pour SupabaseProvider, ce verrou est TEXTUEL,
      // et c'est tout ce qui est possible ici : la classe demande une base, et
      // le dépôt n'a ni jsdom ni harnais réseau. C'est déjà la technique
      // employée sur ce même fichier par affichage-sans-ecriture.test.ts et
      // maj-honnete.test.ts.
      expect(source(p), `${p} : le report des corrections a disparu`).toContain(
        'this.corrections = lu.corriges;',
      );
    }
  });
});

// ===========================================================================
// §5 — les deux avis triés sont INSCRITS
// ===========================================================================
describe('les avis du Security Advisor examinés sont écrits', () => {
  const advisors = source('supabase/securite-advisors.sql');

  it('l’avis sur `definir_acces` est nommé, avec ce que le linter ne voit pas', () => {
    expect(advisors).toContain('Signed-In Users Can Execute SECURITY DEFINER Function');
    expect(advisors).toContain('public.definir_acces');
    // Il renvoie aux garanties, sinon « assumé » n'est qu'une affirmation.
    expect(advisors).toContain('src/data/securite.test.ts');
    expect(advisors).toContain('search_path');
  });

  it('l’avis sur `ecrans` est nommé, et son RÉSIDU aussi', () => {
    expect(advisors).toContain('RLS Policy Always True');
    expect(advisors).toContain('signal de vie');
    // ⚠ Le point qui compte : ne pas écrire que l'avis est sans objet.
    expect(advisors, 'le résidu réel n’est pas nommé').toContain(
      'le signal de vie D’UN AUTRE ÉCRAN'.replace('’', "'"),
    );
    expect(advisors).toContain('RELECTURE GÉNÉRALE D’AVANT'.replace('’', "'"));
  });

  it('chacun porte la requête qui permet de le revérifier', () => {
    // C'est ce qui distingue une entrée de ce fichier d'un commentaire : la
    // forme des contrôles (a)…(g) existants.
    const bloc = advisors.slice(advisors.indexOf('AVIS DU SECURITY ADVISOR'));
    expect(bloc, 'section des avis triés introuvable').not.toBe('');
    // CHAÎNE EXACTE : `has_function_privilege` apparaît deux fois dans
    // l'entrée (h), et n'en lire que le nom laissait retirer la ligne qui
    // compte — celle qui contrôle `anon`. Survivante du 13/09.
    expect(bloc).toContain(
      "--     select has_function_privilege('anon',\n" +
        "--              'public.definir_acces(date, int, text, text)', 'execute') as anon_execute,",
    );
    expect(bloc).toContain('information_schema.column_privileges');
    for (const marque of ['-- (h)', '-- (i)']) {
      expect(bloc, `entrée ${marque} absente`).toContain(marque);
    }
  });
});

// ===========================================================================
// §6 — les 30 secondes : une trace, pas un correctif
// ===========================================================================
describe('les demi-minutes sont expliquées là où l’agent les rencontre', () => {
  it('la mention est dans le FORMULAIRE de création', () => {
    const html = source('supervision.html');
    expect(html).toContain('id="sup-note-30s"');
    const bloc = /<div class="note-30s" id="sup-note-30s">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';
    expect(bloc, 'mention introuvable').not.toBe('');
    // Elle dit les trois choses utiles : où ça apparaît, d'où ça vient, et que
    // ce n'est pas une erreur.
    expect(bloc).toContain('Motivon');
    expect(bloc).toContain("document d'exploitation");
    expect(bloc).toMatch(/pas une erreur/i);
  });

  it('elle INFORME : elle ne refuse rien et ne modifie aucune valeur', () => {
    // Une mention qui bloquerait la création, ou qui arrondirait les heures,
    // serait un correctif déguisé — or la décision est de ne rien coder.
    const ts = source('src/pages/supervision.ts');
    expect(ts, 'la mention est devenue une condition').not.toContain('sup-note-30s');
    const css = source('src/styles/supervision.css');
    expect(css).toContain('.note-30s');
    expect(css, 'la mention est présentée comme une alerte').not.toMatch(
      /\.note-30s \{[^}]*var\(--alerte\)/,
    );
  });

  it('la mesure qui la fonde est écrite dans docs/01', () => {
    const doc = source('docs/01-spec-fonctionnelle.md');
    expect(doc).toContain('11 min 30 s partout');
    expect(doc).toContain('07:26:30');
    expect(doc).toContain('2026-05-29-JMC-1-Horaires été 2026-exploit-v1.xlsx');
  });
});

// ===========================================================================
// §1 — la confirmation ne promet plus ce que le brouillon ne tient pas
// ===========================================================================
describe('§5.6 existe, et rien ne promet plus d’immédiateté à tort', () => {
  it('la section que le code cite dix fois existe enfin', () => {
    // Les renvois « docs/01 §5.6 » pointaient vers une section ABSENTE : la
    // spécification ne décrivait pas le brouillon, elle n'en parlait nulle
    // part sous ce numéro.
    const doc = source('docs/01-spec-fonctionnelle.md');
    expect(doc).toMatch(/^### 5\.6 /m);
    const renvois = [
      ...source('src/pages/supervision.ts').matchAll(/docs\/01 §5\.6/g),
      ...source('src/pages/brouillon.ts').matchAll(/docs\/01 §5\.6/g),
    ];
    expect(renvois.length, 'plus aucun renvoi vers §5.6 : la section ne sert plus').toBeGreaterThan(
      0,
    );
  });

  it('elle décrit les TROIS écritures immédiates, et elles seules', () => {
    const doc = source('docs/01-spec-fonctionnelle.md');
    const section = /### 5\.6 [\s\S]*?\n6\. \*\*Publication\*\*/.exec(doc)?.[0] ?? '';
    expect(section, 'section §5.6 introuvable').not.toBe('');
    for (const exception of ['Départ réel', 'Affluence', 'Accès']) {
      expect(section, `exception « ${exception} » absente`).toContain(exception);
    }
    expect(section).toContain('brouillon.ts');
  });

  it('l’action groupée ne promet plus « immédiatement »', () => {
    // Elle passe par le brouillon depuis le 29/08 ; la confirmation disait le
    // contraire, et deux tests l'y maintenaient.
    const logique = source('src/pages/supervision-logique.ts');
    const corps = /export function actionGroupeeFacultatifs\([\s\S]*?\n\}/.exec(logique)?.[0] ?? '';
    expect(corps, 'actionGroupeeFacultatifs introuvable').not.toBe('');
    expect(corps).toContain('APRÈS publication');
    expect(corps, 'la promesse d’immédiateté est revenue').not.toMatch(
      /'Ils (?:apparaîtront|disparaîtront)[^']*immédiat/,
    );
  });
});
