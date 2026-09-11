// §C — une surface d'AFFICHAGE ne doit jamais créer de journée.
//
// LE DÉFAUT, vérifié le 08/09/2026. Le bouton « Aperçu » de la supervision
// ouvre `ecran.html` dans le MÊME navigateur, donc avec la session du
// superviseur. Le paramètre `?apercu=1` ne fait qu'une chose : couper le signal
// de vie, pour qu'un onglet de supervision ne batte pas sous l'identifiant du
// Raspberry Pi. Il n'empêchait pas `getJour` de CRÉER la journée, ce que le
// provider faisait dès que la date n'était pas passée et que l'appelant avait
// le droit d'écrire — droit lu dans la session locale.
//
// Conséquence, et elle visait le bandeau livré la veille : cliquer « Aperçu »
// sur une journée non ouverte la créait. Le bandeau « journée non confirmée »
// n'était donc JAMAIS visible depuis l'aperçu, et le geste d'aller le chercher
// effaçait le signal pour les vrais écrans en gare. Une alerte qu'on détruit
// en la regardant. Les Raspberry n'étaient pas touchés — ils n'ont aucune
// session : c'est la personne qui pouvait agir sur l'alerte qui ne la voyait
// jamais.
//
// Le comportement est éprouvé sur le MockProvider (mock.test.ts, « une surface
// d'AFFICHAGE n'écrit jamais »). Ce fichier verrouille ce que l'exécution ne
// peut pas voir : QUI passe l'option, dans quels fichiers.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(chemin: string): string {
  const url = new URL(`../../${chemin}`, import.meta.url);
  return readFileSync(fileURLToPath(url), 'utf-8').replace(/\r\n/g, '\n');
}

/** Les appels à `provider.getJour(…)` d'un fichier, texte complet de l'appel. */
function appelsGetJour(chemin: string): string[] {
  return [...source(chemin).matchAll(/provider\.getJour\([^)]*\)/g)].map((m) => m[0]);
}

const SURFACES = ['src/pages/ecran.ts', 'src/pages/grille.ts'] as const;

describe('les surfaces d’affichage ne demandent JAMAIS la création', () => {
  for (const chemin of SURFACES) {
    it(`${chemin} appelle getJour sans l’option`, () => {
      const appels = appelsGetJour(chemin);
      expect(appels, `aucun appel à getJour trouvé dans ${chemin}`).toHaveLength(1);
      for (const appel of appels) {
        expect(appel, chemin).not.toContain('creerSiAbsent');
      }
    });
  }

  it('aucune des deux surfaces ne mentionne l’option, même ailleurs', () => {
    // Un contournement — une variable, un objet d'options monté plus haut —
    // rendrait le contrôle précédent aveugle.
    for (const chemin of SURFACES) {
      expect(source(chemin), chemin).not.toContain('creerSiAbsent');
    }
  });
});

describe('la supervision, elle, la demande — partout où elle lit une journée', () => {
  it('les trois appels de supervision.ts passent l’option', () => {
    // Sans elle, l'amélioration exploitant du 25/08 serait perdue : ouvrir
    // une date à venir la crée d'emblée, sans action manuelle.
    const appels = appelsGetJour('src/pages/supervision.ts');
    expect(appels).toHaveLength(3);
    for (const appel of appels) {
      // Pas l'accolade entière : l'appel porte depuis le 11/09/2026 une
      // seconde option (`avecCommanditaire`). Ce qui compte reste que la
      // création soit demandée.
      expect(appel).toContain('creerSiAbsent: true');
    }
  });
});

describe('le DÉFAUT de l’option est de ne pas créer', () => {
  it('l’interface la déclare facultative, jamais requise', () => {
    // Le sens du défaut est le correctif. Un futur appelant qui oublie
    // l'option ne pourra pas écrire par inadvertance ; c'est l'inverse qui a
    // produit ce défaut.
    const provider = source('src/data/provider.ts');
    // La signature a gagné une seconde option le 11/09/2026
    // (`avecCommanditaire`) et tient désormais sur plusieurs lignes : ce qui
    // est verrouillé ici est le SENS — les deux points d'interrogation — et
    // non la mise en forme, qu'un passage de Prettier suffirait à casser.
    const signature = /getJour\(([\s\S]*?)\): Promise<Jour>;/.exec(provider)?.[1] ?? '';
    expect(signature, 'getJour introuvable dans provider.ts').not.toBe('');
    expect(signature, 'le sac d’options est devenu obligatoire').toContain('options?:');
    expect(signature, 'creerSiAbsent est devenue obligatoire').toContain('creerSiAbsent?: boolean');
  });

  it('les deux fournisseurs exigent `=== true`, pas une valeur qui traîne', () => {
    // `if (options?.creerSiAbsent)` accepterait n'importe quelle valeur vraie
    // arrivant d'ailleurs ; la comparaison stricte ne laisse passer que
    // l'intention explicite.
    for (const chemin of ['src/data/supabase.ts', 'src/data/mock.ts']) {
      expect(source(chemin), chemin).toContain('options?.creerSiAbsent === true');
    }
  });

  it('dans les deux fournisseurs, l’option est testée AVANT les droits', () => {
    // Ce n'est pas de la sécurité — la session et RLS restent la frontière —
    // mais c'est ce qui rend le refus lisible : la surface d'affichage passe
    // tout droit vers l'aperçu théorique, sans même interroger la session.
    //
    // La recherche est BORNÉE au corps de `getJour` : les deux fichiers lisent
    // la session ailleurs (signIn, getProfil…), et un `indexOf` sur tout le
    // fichier attraperait la mauvaise occurrence — il l'a fait.
    const corpsGetJour = (chemin: string): string => {
      const src = source(chemin);
      const debut = src.indexOf('async getJour(');
      expect(debut, `${chemin} : getJour introuvable`).toBeGreaterThan(0);
      const fin = src.indexOf('\n  async ', debut + 1);
      return src.slice(debut, fin === -1 ? undefined : fin);
    };

    for (const [chemin, marqueurDroits] of [
      ['src/data/supabase.ts', 'peutEcrireExploitation()'],
      ['src/data/mock.ts', 'peutOuvrirUneJournee()'],
    ] as const) {
      const corps = corpsGetJour(chemin);
      const option = corps.indexOf('options?.creerSiAbsent === true');
      const droits = corps.indexOf(marqueurDroits);
      expect(option, `${chemin} : option introuvable dans getJour`).toBeGreaterThan(0);
      expect(droits, `${chemin} : contrôle de droits introuvable dans getJour`).toBeGreaterThan(0);
      expect(option, chemin).toBeLessThan(droits);
    }
  });
});

describe('`?apercu=1` garde son rôle, qui n’a jamais été celui-là', () => {
  it('il coupe le signal de vie, et rien d’autre', () => {
    // Un onglet de supervision qui battrait sous l'identifiant du Raspberry
    // fausserait sa dernière vue et consommerait son ordre de rechargement.
    // C'est utile, mais ça ne protégeait pas de l'écriture — d'où §C.
    for (const chemin of SURFACES) {
      expect(source(chemin), chemin).toContain("url.get('apercu') !== '1'");
    }
  });
});
