// §7 — « Voir comme » : sept règles, sept tests qui meurent avec elles.
//
// Le lot se juge sur UNE promesse : on regarde l'interface d'un autre rôle et
// RIEN ne part en base. Les tests ci-dessous sont écrits pour tomber si la
// promesse se défait — pas pour décrire l'implémentation.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CLE_APERCU,
  ECRITURES,
  LECTURES,
  RefusApercu,
  SORTIE,
  libelleApercu,
  providerApercu,
  rolesApercuStockes,
  rolesApercuValides,
} from './voir-comme';
import { LIBELLE_ROLE, ROLES, ongletsVisibles, type Role } from '../core/roles';
import type { DataProvider } from '../data/provider';

function source(chemin: string): string {
  const url = new URL(`../../${chemin}`, import.meta.url);
  return readFileSync(fileURLToPath(url), 'utf-8').replace(/\r\n/g, '\n');
}

/**
 * Un faux fournisseur qui NOTE tout ce qu'on lui demande. Il ne simule rien :
 * ce qui compte est la liste des appels réellement parvenus jusqu'à lui.
 */
function fauxProvider(): { provider: DataProvider; appels: string[] } {
  const appels: string[] = [];
  const cible = {} as Record<string, unknown>;
  for (const m of [...LECTURES, ...SORTIE, ...ECRITURES]) {
    cible[m] = (...args: unknown[]): unknown => {
      appels.push(m);
      return m === 'getJour' ? args : undefined;
    };
  }
  return { provider: cible as unknown as DataProvider, appels };
}

// ---------------------------------------------------------------------------
// 7.1 — LE TEST QUI COMPTE : l'écriture refuse au FOURNISSEUR, pas au bouton
// ---------------------------------------------------------------------------

describe('7.1 — pendant l’aperçu, aucune écriture n’atteint la base', () => {
  it('les 44 méthodes d’écriture lèvent, et le fournisseur réel n’est jamais appelé', () => {
    const { provider, appels } = fauxProvider();
    const enveloppe = providerApercu(provider, () => true);
    const refuses: string[] = [];
    for (const methode of ECRITURES) {
      expect(() => (enveloppe as unknown as Record<string, () => void>)[methode]()).toThrowError(
        RefusApercu,
      );
      refuses.push(methode);
    }
    expect(refuses).toHaveLength(ECRITURES.length);
    // LA vérification : rien n'est passé. Un refus qui appellerait quand même
    // avant de lever serait pire que pas de refus du tout.
    expect(appels).toEqual([]);
  });

  it('le refus se reconnaît : ce n’est pas une panne, et le message le dit', () => {
    const { provider } = fauxProvider();
    const enveloppe = providerApercu(provider, () => true);
    try {
      void enveloppe.saveParams({});
      expect.unreachable('saveParams aurait dû être refusée');
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(RefusApercu);
      expect((erreur as RefusApercu).methode).toBe('saveParams');
      expect((erreur as Error).message).toContain('saveParams');
    }
  });

  it('les lectures, elles, passent — sinon l’aperçu ne montrerait rien', () => {
    const { provider, appels } = fauxProvider();
    const enveloppe = providerApercu(provider, () => true);
    for (const methode of LECTURES) {
      (enveloppe as unknown as Record<string, () => void>)[methode]();
    }
    expect(appels).toEqual([...LECTURES]);
  });

  it('hors aperçu, l’enveloppe est transparente : TOUT passe', () => {
    const { provider, appels } = fauxProvider();
    const enveloppe = providerApercu(provider, () => false);
    for (const methode of ECRITURES) {
      (enveloppe as unknown as Record<string, () => void>)[methode]();
    }
    expect(appels).toEqual([...ECRITURES]);
  });

  it('la supervision passe bien par l’enveloppe, et sur le vrai fournisseur', () => {
    // Sans cette ligne, tout ce qui précède serait vrai et sans effet.
    const s = source('src/pages/supervision.ts');
    expect(s).toContain('providerApercu(creeProvider({ echecSimule })');
    // Un seul fournisseur dans la page : un second, non enveloppé, rouvrirait
    // la porte sans qu'aucun autre test ne s'en aperçoive.
    expect(s.split('providerApercu(creeProvider({').length - 1).toBe(1);
    // …et AUCUN fournisseur affecté sans enveloppe : c'est cette forme-là
    // qu'une reprise distraite écrirait.
    expect(s).not.toContain('= creeProvider(');
  });
});

// ---------------------------------------------------------------------------
// 7.2 — FERMÉ PAR DÉFAUT, et impossible à oublier
// ---------------------------------------------------------------------------

describe('7.2 — une méthode non classée est refusée, et ne peut pas rester non classée', () => {
  it('une méthode absente des trois listes lève, elle aussi', () => {
    const cible = { methodeAjouteeDemain: (): string => 'écrit' } as unknown as DataProvider;
    const enveloppe = providerApercu(cible, () => true);
    expect(() =>
      (enveloppe as unknown as Record<string, () => void>).methodeAjouteeDemain(),
    ).toThrowError(RefusApercu);
  });

  it('les trois listes couvrent EXACTEMENT l’interface DataProvider', () => {
    // Le classement est comparé à l'interface elle-même, lue dans le fichier :
    // ajouter une méthode à `DataProvider` sans la classer rend ce test rouge,
    // et c'est le seul moyen que la liste ne dérive pas en silence. Même motif
    // que `commanditaire.test.ts`, qui compare le select du front aux droits
    // de colonne SQL.
    const texte = source('src/data/provider.ts');
    const debut = texte.indexOf('export interface DataProvider {');
    expect(debut, 'interface DataProvider introuvable').toBeGreaterThan(-1);
    const corps = texte.slice(debut);
    const declarees = [...corps.matchAll(/^ {2}([a-zA-Z][a-zA-Z0-9]*)\(/gm)].map((m) => m[1]);
    expect(declarees.length, 'aucune méthode relevée : la lecture a dérivé').toBeGreaterThan(50);

    const classees = [...LECTURES, ...SORTIE, ...ECRITURES];
    expect([...classees].sort()).toEqual([...declarees].sort());
    // Aucun doublon : une méthode à la fois lue et refusée serait autorisée
    // (l'autorisation est vérifiée en premier).
    expect(new Set(classees).size).toBe(classees.length);
  });

  it('les méthodes qu’on croirait inoffensives sont bien refusées', () => {
    // Chacune a été instruite : `heartbeat` inscrirait l'onglet dans la liste
    // des écrans, `signIn` changerait la session sous l'aperçu, `traduire`
    // appelle une fonction facturée pour un résultat qu'on jette, et
    // `logPublication` laisserait la trace que le §6 interdit.
    for (const m of ['heartbeat', 'signIn', 'traduire', 'logPublication']) {
      expect(ECRITURES as readonly string[], m).toContain(m);
    }
  });

  it('`signOut` est la SEULE exception : sans elle, on s’enferme dans l’aperçu', () => {
    expect([...SORTIE]).toEqual(['signOut']);
    const { provider, appels } = fauxProvider();
    providerApercu(provider, () => true).signOut();
    expect(appels).toEqual(['signOut']);
  });
});

// ---------------------------------------------------------------------------
// 7.3 — LE PIÈGE : la seule lecture qui sache écrire
// ---------------------------------------------------------------------------

describe('7.3 — prévisualiser une journée non ouverte ne l’ouvre pas', () => {
  it('`creerSiAbsent` est neutralisée pendant l’aperçu', () => {
    const { provider } = fauxProvider();
    const enveloppe = providerApercu(provider, () => true);
    const recu = enveloppe.getJour('2026-09-20', {
      creerSiAbsent: true,
      avecCommanditaire: true,
    }) as unknown as [string, Record<string, unknown>];
    expect(recu[0]).toBe('2026-09-20');
    expect(recu[1].creerSiAbsent).toBe(false);
    // …et les autres options survivent : sans `avecCommanditaire`, l'aperçu
    // perdrait une colonne que la supervision voit vraiment.
    expect(recu[1].avecCommanditaire).toBe(true);
  });

  it('hors aperçu, la supervision crée toujours la journée', () => {
    // C'est l'amélioration du 25/08 : ouvrir une date à venir la crée.
    // La neutraliser hors aperçu serait une régression silencieuse.
    const { provider } = fauxProvider();
    const enveloppe = providerApercu(provider, () => false);
    const recu = enveloppe.getJour('2026-09-20', { creerSiAbsent: true }) as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(recu[1].creerSiAbsent).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7.4 — DES RÔLES, CUMULABLES, JAMAIS UNE PERSONNE
// ---------------------------------------------------------------------------

describe('7.4 — ce qui est simulé, c’est un jeu de rôles', () => {
  it('le cumul change réellement ce qui est vu', () => {
    const caisse = ongletsVisibles(['caisse']);
    const cumul = ongletsVisibles(['supervision', 'caisse']);
    expect(cumul.length).toBeGreaterThan(caisse.length);
    for (const onglet of caisse) expect(cumul).toContain(onglet);
    // Et c'est bien la MÊME fonction que la supervision emploie : un second
    // calcul « pour l'aperçu » finirait par diverger du vrai.
    expect(source('src/pages/supervision.ts')).toContain(
      'ongletsVisibles(roles, visibiliteOnglets)',
    );
  });

  it('le bandeau nomme des RÔLES, et le cas « sans aucun rôle » se dit', () => {
    expect(libelleApercu(['supervision', 'caisse'], LIBELLE_ROLE)).toBe('SUPERVISION + CAISSE');
    expect(libelleApercu([], LIBELLE_ROLE)).toBe('un compte SANS AUCUN RÔLE');
  });

  it('l’entrée depuis l’annuaire prend les RÔLES du compte, pas le compte', () => {
    const s = source('src/pages/supervision.ts');
    expect(s).toContain('if (u) entreApercu(u.roles);');
    // Rien de personnel ne doit entrer dans l'aperçu : ni l'adresse, ni le nom.
    expect(s).not.toContain('entreApercu(u.email');
    expect(s).not.toContain('entreApercu(u.nom');
  });

  it('l’aperçu n’élargit jamais la matrice : il ne pose aucun droit nouveau', () => {
    // §1 : le droit d'entrée est `comptes.lire`, un droit qui EXISTE déjà.
    const roles = source('src/core/roles.ts');
    expect(roles).not.toContain('apercu');
    expect(roles).not.toContain('voir-comme');
    // Le droit d'entrée est vérifié DANS `entreApercu`, et non seulement au
    // rendu de la carte : une carte masquée se rouvre dans l'inspecteur.
    const s = source('src/pages/supervision.ts');
    const debut = s.indexOf('function entreApercu(');
    expect(debut).toBeGreaterThan(-1);
    expect(s.slice(debut, s.indexOf('\n}\n', debut))).toContain(
      "if (!peut('comptes.lire')) return;",
    );
  });
});

// ---------------------------------------------------------------------------
// 7.5 — LE BROUILLON EST SUSPENDU, PAS DÉTRUIT
// ---------------------------------------------------------------------------

describe('7.5 — le travail en attente survit à l’aperçu', () => {
  it('les trois surimpressions du brouillon sont neutralisées en aperçu', () => {
    // Ces trois fonctions sont les SEULS endroits où le brouillon se pose sur
    // ce qui vient de la base. Si l'une redevenait inconditionnelle, l'aperçu
    // montrerait le travail non publié d'un agent à un rôle qui ne le voit
    // pas — un aperçu faux, et faux dans le sens qui rassure.
    const s = source('src/pages/supervision.ts');
    for (const [fn, garde] of [
      ['rafraichitMessagesEffectifs', 'messages = enApercu() ? messagesBase :'],
      ['rafraichitParamsEffectifs', 'params = paramsBase;'],
      ['rafraichitJourEffectif', 'if (enApercu()) return;'],
    ] as const) {
      const debut = s.indexOf(`function ${fn}(`);
      expect(debut, fn).toBeGreaterThan(-1);
      const corps = s.slice(debut, s.indexOf('\n}\n', debut));
      expect(corps, fn).toContain('enApercu()');
      expect(corps, fn).toContain(garde);
    }
  });

  it('entrer dans l’aperçu et en sortir ne RECHARGE jamais la page', () => {
    // Contrainte dure : les `Map` du brouillon vivent en mémoire. Un
    // rechargement les détruirait, donc détruirait le brouillon — la promesse
    // ci-dessus ne tiendrait plus.
    const s = source('src/pages/supervision.ts');
    for (const fn of [
      'function entreApercu(',
      'function sortApercu(',
      'function rechargePourApercu(',
    ]) {
      const debut = s.indexOf(fn);
      expect(debut, fn).toBeGreaterThan(-1);
      const corps = s.slice(debut, s.indexOf('\n}\n', debut));
      expect(corps, fn).not.toContain('location.reload');
      expect(corps, fn).not.toContain('location.href');
    }
  });

  it('la sortie REND ses vrais rôles à l’agent, elle ne fait pas qu’éteindre le mode', () => {
    // Oublier cette ligne laisserait l'agent avec les rôles du rôle simulé —
    // un aperçu dont on ne sort jamais vraiment, et dont la seule issue
    // visible serait de se déconnecter.
    const s = source('src/pages/supervision.ts');
    const debut = s.indexOf('function sortApercu(');
    const corps = s.slice(debut, s.indexOf('\n}\n', debut));
    expect(corps).toContain('rolesSimules = null;');
    expect(corps).toContain('roles = rolesReels;');
  });

  it('le BANDEAU porte le compte des modifications en attente, la barre ne le peut pas', () => {
    // MESURÉ au navigateur le 13/09/2026 : avec quatre modifications en
    // attente, la barre « Publier » affiche « Tout est publié ✓ » pendant
    // l'aperçu — elle compare ce qui est AFFICHÉ, et l'affichage est revenu à
    // la base. Le compte doit donc être pris à la SOURCE, dans le brouillon.
    const s = source('src/pages/supervision.ts');
    const debut = s.indexOf('function nbEnAttente(');
    expect(debut, 'nbEnAttente introuvable').toBeGreaterThan(-1);
    const corps = s.slice(debut, s.indexOf('\n}\n', debut));
    // Les cinq réservoirs du brouillon, et non `modifs` — qui vaudrait zéro.
    for (const reservoir of [
      'brouillonCirc.size',
      'brouillonTerminus.size',
      'brouillonSection.size',
      'brouillonMessages.size',
      'Object.keys(brouillonParams).length',
    ]) {
      expect(corps, reservoir).toContain(reservoir);
    }
    expect(corps).not.toContain('modifs');
    // …et il est bien affiché dans le bandeau.
    const bandeau = s.indexOf('function rendreBandeauApercu(');
    const corpsBandeau = s.slice(bandeau, s.indexOf('\n}\n', bandeau));
    expect(corpsBandeau).toContain('nbEnAttente()');
    // …et il est POSÉ dans le bandeau : compter sans afficher ne dit rien à
    // personne. (Sans cette ligne, la mutation n'était tuée que par `tsc`,
    // qui voyait une variable inutilisée — une protection qui dépend du
    // compilateur, pas d'un test.)
    expect(corpsBandeau).toContain("$('apercu-attente').textContent =");
    expect(source('supervision.html')).toContain('id="apercu-attente"');
  });

  it('l’avertissement de déconnexion ne compte plus ZÉRO pendant l’aperçu', () => {
    // DÉFAUT TROUVÉ AU NAVIGATEUR le 13/09/2026, pas aux tests : `modifs`
    // compte les écarts avec ce qui est AFFICHÉ, et l'aperçu suspend la
    // surimpression du brouillon. L'avertissement annonçait donc
    // « 0 modification(s) seront perdues » alors qu'il y en avait — le
    // garde-fou (`rienEnAttente`) tenait, mais le nombre mentait.
    const s = source('src/pages/supervision.ts');
    const debut = s.indexOf("$('btn-deconnexion')");
    const corps = s.slice(debut, debut + 2000);
    expect(corps).toContain('const enAttente = enApercu() ? nbEnAttente() : modifs;');
    expect(corps).toContain('${enAttente} modification(s) en attente');
  });

  it('« Publier » ne peut pas partir depuis l’aperçu, même par un chemin détourné', () => {
    // La barre reste visible — le compteur est la preuve que le brouillon est
    // gardé — mais toutes les écritures de la publication sont refusées.
    for (const m of [
      'saveCirculations',
      'saveCirculation',
      'saveMessage',
      'saveParams',
      'logPublication',
    ]) {
      expect(ECRITURES as readonly string[], m).toContain(m);
    }
  });
});

// ---------------------------------------------------------------------------
// 7.6 — LE MODE MEURT AVEC LA SESSION
// ---------------------------------------------------------------------------

describe('7.6 — l’aperçu ne survit ni à la déconnexion ni à une valeur forgée', () => {
  it('il vit dans `sessionStorage`, que la déconnexion vide déjà', () => {
    const s = source('src/pages/supervision.ts');
    expect(s).toContain('sessionStorage.setItem(CLE_APERCU');
    expect(s).not.toContain('localStorage.setItem(CLE_APERCU');
    // Le bouton « Quitter » vide sessionStorage : c'est ce geste, et non un
    // second mécanisme, qui efface l'aperçu à la déconnexion.
    const debut = s.indexOf("$('btn-deconnexion')");
    expect(debut).toBeGreaterThan(-1);
    expect(s.slice(debut, debut + 2000)).toContain('sessionStorage.clear();');
  });

  it('une valeur forgée à la main n’accorde rien et ne casse rien', () => {
    expect(rolesApercuValides('pas du json')).toBeNull();
    expect(rolesApercuValides('{"roles":["technique"]}')).toBeNull();
    expect(rolesApercuValides('["dieu","technique"]')).toEqual(['technique']);
    expect(rolesApercuValides('[]')).toEqual([]);
    // L'ordre canonique est rétabli : le bandeau ne doit pas dépendre de
    // l'ordre d'écriture d'une valeur bricolée.
    expect(rolesApercuValides('["caisse","admin"]')).toEqual(
      ROLES.filter((r) => r === 'admin' || r === 'caisse'),
    );
  });

  it('absence de clé = pas d’aperçu, et ensemble vide ≠ absence', () => {
    const vide: Pick<Storage, 'getItem'> = { getItem: () => null };
    expect(rolesApercuStockes(vide)).toBeNull();
    const sansRole: Pick<Storage, 'getItem'> = { getItem: () => '[]' };
    expect(rolesApercuStockes(sansRole)).toEqual([]);
    // Un stockage qui LÈVE (navigation privée saturée) ne doit pas empêcher la
    // supervision de s'ouvrir.
    const casse: Pick<Storage, 'getItem'> = {
      getItem: () => {
        throw new Error('refusé');
      },
    };
    expect(rolesApercuStockes(casse)).toBeNull();
  });

  it('l’en-tête continue de dire QUI ON EST, même pendant l’aperçu', () => {
    // Deux questions, deux endroits : l'en-tête répond à « qui agit », le
    // bandeau à « qu'est-ce que je regarde ». Avec `roles`, un rechargement
    // en cours d'aperçu — le mode est restauré AVANT ce rendu — afficherait
    // les rôles simulés comme s'ils étaient les siens.
    const s = source('src/pages/supervision.ts');
    expect(s).toContain("$('user-role').innerHTML = badgesRoles(rolesReels);");
    expect(s).not.toContain("$('user-role').innerHTML = badgesRoles(roles);");
  });

  it('le droit d’entrée est revérifié sur les rôles RÉELS à la restauration', () => {
    const s = source('src/pages/supervision.ts');
    expect(s).toContain("aLeDroit(rolesReels, 'comptes.lire')");
    expect(CLE_APERCU).toBe('tmb-apercu-roles');
  });
});

// ---------------------------------------------------------------------------
// 7.7 — AUCUNE TRACE, AUCUNE MIGRATION
// ---------------------------------------------------------------------------

describe('7.7 — un aperçu ne laisse rien derrière lui', () => {
  it('le module de l’aperçu ne parle pas à la base', () => {
    const s = source('src/pages/voir-comme.ts');
    expect(s).not.toContain('supabase');
    expect(s).not.toContain('from(');
    // Il n'importe QUE des types et la matrice des rôles : pas de fournisseur
    // concret, donc aucun chemin d'écriture propre.
    expect(s).toContain('import type { DataProvider }');
  });

  it('entrer ou sortir n’écrit aucune ligne de journal', () => {
    // `bump()` est le geste qui pousse au journal d'exploitation et fait
    // avancer la fraîcheur des écrans. Ni l'entrée ni la sortie ne doivent
    // l'appeler : regarder n'est pas agir (§6).
    const s = source('src/pages/supervision.ts');
    for (const fn of [
      'function entreApercu(',
      'function sortApercu(',
      'function rechargePourApercu(',
    ]) {
      const debut = s.indexOf(fn);
      const corps = s.slice(debut, s.indexOf('\n}\n', debut));
      expect(corps, fn).not.toContain('bump(');
      expect(corps, fn).not.toContain('logPublication');
    }
  });

  it('le bandeau et sa sortie vivent au-dessus des onglets, donc visibles depuis tous', () => {
    const html = source('supervision.html');
    const barre = html.indexOf('<div class="barre-haute">');
    const bandeau = html.indexOf('id="bandeau-apercu"');
    const onglets = html.indexOf('<nav class="tabs"');
    expect(barre).toBeGreaterThan(-1);
    // Dans la barre COLLANTE, et AVANT la barre d'onglets : un clic pour
    // sortir, quel que soit l'onglet ouvert et quel que soit le défilement.
    expect(bandeau).toBeGreaterThan(barre);
    expect(bandeau).toBeLessThan(onglets);
    const fin = html.indexOf('</div>', bandeau);
    expect(html.slice(bandeau, fin)).toContain('id="apercu-sortir"');
  });

  it('le verrou d’interface s’ajoute au refus, il ne le remplace pas', () => {
    // Le motif du dépôt est les DEUX (onglet Places : `disabled` ET le
    // gestionnaire qui refuse). Si `verrouilleApercu` devenait le seul
    // mécanisme, retirer un attribut dans l'inspecteur rouvrirait l'écriture.
    const s = source('src/pages/supervision.ts');
    expect(s).toContain('function verrouilleApercu(');
    expect(s).toContain('commande.disabled = true;');
    expect(s).toContain('providerApercu(');
    // Il doit être REPOSÉ après chaque rendu : le DOM est réécrit, un verrou
    // posé une fois pour toutes s'appliquerait au DOM d'avant. `rendreTout`
    // plus les trois rendus atteignables sans lui (barre de date, journal).
    expect(s.split('verrouilleApercu();').length - 1).toBeGreaterThanOrEqual(4);
    const debut = s.indexOf('function rendreTout(');
    expect(s.slice(debut, s.indexOf('\n}\n', debut))).toContain('verrouilleApercu();');
  });

  it('le verrou laisse passer ce qui est marqué « lecture », sinon on ne peut plus regarder', () => {
    // Navigation par date et filtres du journal : sans eux, l'aperçu ne
    // permettrait plus de changer de jour ni de faire défiler le journal —
    // donc de vérifier ce qu'on est venu vérifier.
    const s = source('src/pages/supervision.ts');
    const debut = s.indexOf('function verrouilleApercu(');
    const corps = s.slice(debut, s.indexOf('\n}\n', debut));
    expect(corps).toContain("if (commande.dataset.apercu === 'lecture') return;");
    const html = source('supervision.html');
    for (const id of ['date-picker', 'journal-du', 'btn-journal-suiv']) {
      expect(html, id).toContain(`id="${id}" data-apercu="lecture"`);
    }
  });
});

// ---------------------------------------------------------------------------
// Le cas qu'on ne veut PAS : un rôle simulé qui donne plus que le vrai
// ---------------------------------------------------------------------------

describe('l’aperçu ne peut pas servir d’élévation de privilège', () => {
  it('quels que soient les rôles simulés, aucune écriture ne passe', () => {
    // Même en simulant `technique`, le rôle le plus large, l'enveloppe refuse.
    // C'est la garantie qui autorise à ne PAS restreindre les rôles simulables.
    const { provider, appels } = fauxProvider();
    for (const role of ROLES) {
      const simules: Role[] = [role];
      const enveloppe = providerApercu(provider, () => simules.length > 0);
      expect(() => enveloppe.setRolesUser('u', ['technique'])).toThrowError(RefusApercu);
      expect(() => enveloppe.deleteUser('u')).toThrowError(RefusApercu);
    }
    expect(appels).toEqual([]);
  });
});
