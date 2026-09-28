// Le signal de vie : ce que le poste ÉCRIT, ce que la base lui ACCORDE, et ce
// que le serveur RÉÉCRIT.
//
// Deux verrous que la relecture de septembre 2026 a trouvés ouverts :
//
//   • R-25 — la liste des colonnes envoyées par `heartbeat()` n'était comparée
//     à aucun GRANT. PostgREST refuse l'UPDATE ENTIER dès qu'une seule colonne
//     n'est pas accordée (« permission denied for column ») : ajouter
//     `gare: e.gare` rendait les six postes muets d'un coup, et le guetteur
//     annonçait une panne générale alors que les écrans tournaient. 2 334
//     tests restaient verts.
//
//   • R-26 (horodatage) — `trg_signal_de_vie`, garde-fou n° 3 de
//     docs/securite.md §4, n'était cité par AUCUN test :
//     `new.derniere_vue := new.derniere_vue;` passait vert. Or ce déclencheur
//     existe pour une raison mesurée — un Raspberry sans pile d'horloge peut
//     se déclarer vivant dans le futur, et le 19/09 a montré ce que vaut
//     l'horloge d'un poste en panne.
//
// Les quatre autres garde-fous SQL relevés par R-26 (purge, identité d'écran,
// rôles, quorum) restent au lot « installation d'une base neuve ».
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { SupabaseProvider } from './supabase';

function sql(fichier: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../supabase/${fichier}`, import.meta.url)),
    'utf-8',
  ).replace(/\r\n/g, '\n');
}

/** Instructions seules : commentaires retirés, blancs ramenés à une espace. */
function instructions(texte: string): string {
  return texte
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// R-25 — ce que le poste écrit, comparé à ce que la base accorde
// ---------------------------------------------------------------------------

/**
 * Les colonnes que `heartbeat()` envoie RÉELLEMENT : la méthode est exécutée,
 * sur un client d'essai qui note ce qu'on lui demande d'écrire. Une lecture du
 * texte de `supabase.ts` se laisserait tromper par un commentaire ou une
 * propagation d'objet ; l'exécution, non.
 */
async function colonnesEnvoyees(): Promise<{ table: string; colonnes: string[] }> {
  const provider = new SupabaseProvider(
    'https://exemple.supabase.co',
    'sb_publishable_essai',
    true,
  );
  let table = '';
  let valeurs: Record<string, unknown> = {};
  const client = {
    from(nom: string) {
      return {
        update(v: Record<string, unknown>) {
          table = nom;
          valeurs = v;
          return {
            eq: () => ({
              select: async () => ({
                data: [
                  {
                    recharger_demande_at: null,
                    veille_debut: null,
                    veille_fin: null,
                    vitesse_ticker_px_s: null,
                  },
                ],
                error: null,
              }),
            }),
          };
        },
      };
    },
  };
  // `client` est privé pour TypeScript, pas pour l'exécution : c'est le seul
  // point par lequel remplacer le vrai client sans toucher au code livré.
  Object.defineProperty(provider, 'client', { value: client });
  await provider.heartbeat({
    // TOUS les champs renseignés, y compris ceux qui ne doivent pas partir :
    // une colonne qu'on ajouterait en recopiant `e` serait ainsi présente.
    id: 'saint-gervais-ecran-1',
    gare: 'saint-gervais',
    type: 'depart',
    vitesse_ticker_px_s: 90,
    derniere_vue: '2026-09-19T10:00:00Z',
    donnees_maj: '2026-09-19T09:59:00Z',
    date_affichee: '2026-09-19',
    version_app: 'essai',
    reseau: 'wifi',
  });
  return { table, colonnes: Object.keys(valeurs).sort() };
}

/** Les colonnes accordées à `anon` en UPDATE sur `ecrans`, dans un script. */
function colonnesAccordees(fichier: string): string[] {
  const code = instructions(sql(fichier));
  const grants = [...code.matchAll(/grant update \(([^)]*)\) on ecrans to anon;/g)];
  // UN seul GRANT de colonnes : deux listes cumulées ne se liraient plus
  // d'un coup d'œil, et ce test en comparerait une seule.
  expect(grants, `${fichier} : GRANT de colonnes sur ecrans`).toHaveLength(1);
  return (grants[0]?.[1] ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
    .sort();
}

describe('R-25 — les colonnes du signal de vie sont celles que la base accorde', () => {
  const ECRITS_AVEC_LE_GRANT = ['schema.sql', 'securite-advisors.sql'];

  for (const fichier of ECRITS_AVEC_LE_GRANT) {
    it(`heartbeat() envoie EXACTEMENT les colonnes accordées par ${fichier}`, async () => {
      // Égalité d'ensembles, dans les DEUX sens. Une colonne de plus côté
      // poste : PostgREST refuse tout, les six postes deviennent muets. Une
      // colonne accordée qu'on n'envoie plus : un droit ouvert pour rien, sur
      // une table qu'écrit n'importe qui muni de la clé publique.
      const { table, colonnes } = await colonnesEnvoyees();
      expect(table).toBe('ecrans');
      expect(colonnes).toEqual(colonnesAccordees(fichier));
    });
  }

  it('les deux scripts accordent la même liste', () => {
    expect(colonnesAccordees('securite-advisors.sql')).toEqual(colonnesAccordees('schema.sql'));
  });

  it('`derniere_vue` part bien : c’est elle qui déclenche l’horodatage serveur', async () => {
    // Le déclencheur est CONDITIONNEL (« si la colonne change »). Retirer le
    // champ de l'UPDATE laisserait `derniere_vue` intacte : le poste
    // battrait, et la supervision le croirait muet.
    expect((await colonnesEnvoyees()).colonnes).toContain('derniere_vue');
  });
});

// ---------------------------------------------------------------------------
// R-26 — l'horodatage serveur du signal de vie
// ---------------------------------------------------------------------------

const SIGNATURE = 'create or replace function private.horodate_signal_de_vie()';

/**
 * Le corps ATTENDU, instruction par instruction. Écrit ici en toutes lettres
 * parce que c'est un garde-fou de sécurité : le changer doit être un acte
 * délibéré, qui passe par ce fichier, et non une retouche d'une ligne dans
 * `schema.sql` qu'aucun test ne verrait.
 */
const CORPS_ATTENDU = instructions(`
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if new.derniere_vue is distinct from old.derniere_vue then
    new.derniere_vue := now();
  end if;
  if new.donnees_maj is distinct from old.donnees_maj and new.donnees_maj is not null then
    new.donnees_maj := least(new.donnees_maj, now());
  end if;
  return new;
end;
$fn$;`);

const DECLENCHEUR_ATTENDU =
  'create trigger trg_signal_de_vie before update on public.ecrans for each row execute function private.horodate_signal_de_vie();';

/** Toutes les définitions de la fonction dans un script, corps normalisé. */
function definitions(fichier: string): string[] {
  const code = instructions(sql(fichier));
  const corps: string[] = [];
  let i = code.indexOf(SIGNATURE);
  while (i !== -1) {
    const debut = i + SIGNATURE.length;
    const fin = code.indexOf('$fn$;', debut);
    expect(fin, `${fichier} : corps non refermé`).toBeGreaterThan(-1);
    corps.push(code.slice(debut, fin + '$fn$;'.length).trim());
    i = code.indexOf(SIGNATURE, fin);
  }
  return corps;
}

/** Tous les scripts SQL du dépôt, pour qu'aucune copie n'échappe. */
function tousLesScripts(): string[] {
  const dossier = (d: string) =>
    readdirSync(fileURLToPath(new URL(`../../supabase/${d}`, import.meta.url)))
      .filter((f) => f.endsWith('.sql'))
      .map((f) => (d === '.' ? f : `${d}/${f}`));
  return [...dossier('.'), ...dossier('migrations'), ...dossier('tests')];
}

describe('R-26 — trg_signal_de_vie : le serveur, et non le poste, date le signal', () => {
  const PORTEURS = ['schema.sql', 'migrations/2026-08-signal-de-vie-serveur.sql'];

  for (const fichier of PORTEURS) {
    it(`${fichier} : la fonction est définie une fois, au caractère près`, () => {
      // La mutation de la relecture, `new.derniere_vue := new.derniere_vue;`,
      // passait sur toute la suite. Elle ne passe plus : le corps entier est
      // comparé, et avec lui `least(…, now())` sur `donnees_maj`, le
      // `security definer` et le `search_path` vide.
      expect(definitions(fichier)).toEqual([CORPS_ATTENDU]);
    });

    it(`${fichier} : le déclencheur est posé AVANT chaque UPDATE, sur chaque ligne`, () => {
      // `after update` laisserait passer la valeur du poste ; `for each
      // statement` n'aurait pas de `new`. Et le `drop` qui précède rend le
      // script rejouable sans empiler deux déclencheurs.
      const code = instructions(sql(fichier));
      const pose = code.indexOf(DECLENCHEUR_ATTENDU);
      expect(pose, 'déclencheur introuvable ou modifié').toBeGreaterThan(-1);
      expect(code.indexOf(SIGNATURE)).toBeLessThan(pose);
      expect(
        code.indexOf('drop trigger if exists trg_signal_de_vie on public.ecrans;'),
      ).toBeLessThan(pose);
      expect(code).toContain(
        'revoke all on function private.horodate_signal_de_vie() from public;',
      );
    });
  }

  it('aucun script du dépôt ne redéfinit la fonction autrement', () => {
    // Un script plus récent qui recopierait une version affaiblie gagnerait
    // au rejeu : chaque définition, où qu'elle soit, doit être LA définition.
    let vues = 0;
    for (const fichier of tousLesScripts()) {
      for (const corps of definitions(fichier)) {
        expect(corps, fichier).toBe(CORPS_ATTENDU);
        vues++;
      }
    }
    expect(vues).toBeGreaterThanOrEqual(2);
  });

  it('aucun script ne désarme le déclencheur hors commentaire', () => {
    // La recette du guetteur (migration 2026-09-alerte-ecrans.sql, 9.d) le
    // désarme le temps d'un essai — en COMMENTAIRE, à jouer à la main sur la
    // base de test. Une instruction exécutable qui le ferait, jouée sur la
    // production, rendrait la fraîcheur à l'horloge des postes.
    for (const fichier of tousLesScripts()) {
      expect(instructions(sql(fichier)), fichier).not.toMatch(
        /disable trigger (trg_signal_de_vie|all|user)/i,
      );
      expect(instructions(sql(fichier)), fichier).not.toMatch(
        /drop trigger if exists trg_signal_de_vie on public\.ecrans;(?! create trigger trg_signal_de_vie)/,
      );
    }
  });
});
