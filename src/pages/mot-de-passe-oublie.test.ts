// « Mot de passe oublié » en libre-service.
//
// CE QUE CES TESTS PROTÈGENT. Le point sensible n'est pas l'envoi, c'est la
// RÉPONSE : si un jour quelqu'un « améliore » la carte en remontant l'erreur
// du fournisseur, le formulaire devient un annuaire des adresses valides de la
// Régie, interrogeable depuis Internet sans aucun compte. Le premier describe
// est écrit pour ÉCHOUER dans ce cas-là — c'est sa seule raison d'être.
//
// Comment, sans jsdom (le projet n'en a pas, et l'ajouter pour cette carte
// serait une dépendance de plus) : le branchement de la carte prend son DOM et
// son horloge en PARAMÈTRES. On éprouve donc la fonction telle qu'elle est
// livrée — pas une réécriture — contre un faux DOM et un temps qu'on avance à
// la main, sans attendre soixante secondes.
//
// Non prouvé ici : le rendu au navigateur et l'envoi réel du courriel. Ils
// restent dans la recette (docs/mise-en-service.md).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { MockProvider } from '../data/mock';
import {
  DELAI_REESSAI_S,
  MESSAGE_ADRESSE,
  MESSAGE_DEBIT,
  MESSAGE_DEMO,
  MESSAGE_GENERIQUE,
  adresseUtilisable,
  brancheMotDePasseOublie,
  creeDecompte,
  demandeReinitialisation,
  estLimiteDeDebit,
  messageRefusConnexion,
} from './mot-de-passe-oublie';
import type { CarteOubli } from './mot-de-passe-oublie';

// Les fins de ligne du poste (CRLF) ne sont pas celles du coureur (LF) :
// normaliser AVANT tout repère de texte.
function source(chemin: string): string {
  const url = new URL(`../../${chemin}`, import.meta.url);
  return readFileSync(fileURLToPath(url), 'utf-8').replace(/\r\n/g, '\n');
}

// ---------------------------------------------------------------------------
// Faux DOM et fausse horloge, réduits à ce dont la carte a besoin
// ---------------------------------------------------------------------------

class ElementFactice {
  readonly ecouteurs = new Map<string, ((e: { preventDefault(): void }) => void)[]>();
  hidden = false;
  disabled = false;
  value = '';
  textContent: string | null = '';
  focusRecu = 0;
  readonly classes = new Set<string>();
  readonly classList = {
    toggle: (nom: string, actif: boolean): void => {
      if (actif) this.classes.add(nom);
      else this.classes.delete(nom);
    },
  };

  addEventListener(nom: string, fn: (e: { preventDefault(): void }) => void): void {
    const liste = this.ecouteurs.get(nom) ?? [];
    liste.push(fn);
    this.ecouteurs.set(nom, liste);
  }

  focus(): void {
    this.focusRecu++;
  }

  /** Joue un événement du navigateur. Lève si personne ne l'écoute. */
  declenche(nom: string): void {
    const liste = this.ecouteurs.get(nom);
    if (!liste?.length) throw new Error(`aucun écouteur « ${nom} »`);
    for (const fn of liste) fn({ preventDefault: () => undefined });
  }
}

const DEPART_MS = 1_780_000_000_000;

class HorlogeFactice {
  ms = DEPART_MS;
  private battements: (() => void)[] = [];

  maintenantMs = (): number => this.ms;

  chaqueSeconde = (fn: () => void): (() => void) => {
    this.battements.push(fn);
    return () => {
      this.battements = this.battements.filter((b) => b !== fn);
    };
  };

  /** Avance le temps et joue les battements, seconde par seconde. */
  avance(secondes: number): void {
    for (let i = 0; i < secondes; i++) {
      this.ms += 1000;
      for (const fn of [...this.battements]) fn();
    }
  }

  /** Un battement est-il encore armé ? (fuite de minuterie) */
  get armee(): boolean {
    return this.battements.length > 0;
  }
}

interface Banc {
  dom: Record<'formConnexion' | 'formOubli' | 'lienOubli' | 'lienRetour' | 'champLogin' | 'champOubli' | 'bouton' | 'zone', ElementFactice>; // prettier-ignore
  horloge: HorlogeFactice;
  /** Adresses réellement passées au fournisseur. */
  appels: string[];
}

function monteLaCarte(
  options: {
    reset?: (email: string) => Promise<void>;
    modeDemo?: boolean;
  } = {},
): Banc {
  const elements = {
    formConnexion: new ElementFactice(),
    formOubli: new ElementFactice(),
    lienOubli: new ElementFactice(),
    lienRetour: new ElementFactice(),
    champLogin: new ElementFactice(),
    champOubli: new ElementFactice(),
    bouton: new ElementFactice(),
    zone: new ElementFactice(),
  };
  elements.formOubli.hidden = true;
  elements.bouton.textContent = 'Envoyer le lien';
  const appels: string[] = [];
  const horloge = new HorlogeFactice();
  const dom: CarteOubli = {
    ...elements,
    formulaireOubli: elements.formOubli,
  };
  brancheMotDePasseOublie({
    dom,
    reset: async (email) => {
      appels.push(email);
      await options.reset?.(email);
    },
    modeDemo: options.modeDemo ?? false,
    horlogerie: { maintenantMs: horloge.maintenantMs, chaqueSeconde: horloge.chaqueSeconde },
  });
  return { dom: elements, horloge, appels };
}

/** Ouvre la carte puis envoie l'adresse, et rend la main après la réponse. */
async function envoie(banc: Banc, adresse: string): Promise<void> {
  banc.dom.champLogin.value = adresse;
  banc.dom.lienOubli.declenche('click');
  banc.dom.formOubli.declenche('submit');
  // Deux tours de boucle de micro-tâches : l'appel au fournisseur, puis le
  // `.then` qui affiche.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// ---------------------------------------------------------------------------
// §3 — la réponse est TOUJOURS la même
// ---------------------------------------------------------------------------

describe('§3 — la carte ne dit jamais si le compte existe', () => {
  it('le message est identique, que le fournisseur réussisse ou échoue', async () => {
    // LE test du chantier. Il doit échouer si quelqu'un remonte un jour
    // l'erreur du fournisseur « pour aider l'utilisateur ».
    const succes = await demandeReinitialisation({
      adresse: 'agent@tramwaydumontblanc.fr',
      modeDemo: false,
      reset: async () => undefined,
    });
    const echecs = await Promise.all(
      [
        new Error('User not found'),
        new Error('Failed to fetch'),
        new Error('Internal Server Error'),
        new Error('Email address is invalid'),
        'une chaîne, pas une Error',
        undefined,
      ].map((erreur) =>
        demandeReinitialisation({
          adresse: 'agent@tramwaydumontblanc.fr',
          modeDemo: false,
          reset: () => Promise.reject(erreur),
        }),
      ),
    );
    for (const echec of echecs) {
      expect(echec.message).toBe(succes.message);
    }
    // Au caractère près : c'est ce que Thomas comparera en recette, avec une
    // adresse réelle puis une adresse inexistante.
    expect(succes.message).toBe(
      "Si un compte existe pour cette adresse, un lien vient d'être envoyé. " +
        'Pensez à regarder vos courriers indésirables.',
    );
  });

  it('la carte affiche ce même message, compte inconnu compris', async () => {
    // Cette fois par le vrai branchement, pas par la fonction seule.
    const inconnu = monteLaCarte({ reset: () => Promise.reject(new Error('User not found')) });
    await envoie(inconnu, 'personne@exemple-inexistant.invalid');
    const connu = monteLaCarte();
    await envoie(connu, 'agent@tramwaydumontblanc.fr');
    expect(inconnu.dom.zone.textContent).toBe(MESSAGE_GENERIQUE);
    expect(connu.dom.zone.textContent).toBe(inconnu.dom.zone.textContent);
  });

  it('le message normal n’est pas peint en rouge d’alerte', async () => {
    // Ce n'est pas un refus : la zone d'erreur passe en couleur neutre.
    const banc = monteLaCarte();
    await envoie(banc, 'agent@tramwaydumontblanc.fr');
    expect(banc.dom.zone.classes.has('dit')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §3 — l'unique exception : la limite de débit
// ---------------------------------------------------------------------------

describe('§3 — la limite de débit est dite honnêtement', () => {
  it('une erreur « rate limit » rend un message DIFFÉRENT', async () => {
    const debit = await demandeReinitialisation({
      adresse: 'agent@tramwaydumontblanc.fr',
      modeDemo: false,
      reset: () => Promise.reject(new Error('email rate limit exceeded')),
    });
    expect(debit.message).toBe(MESSAGE_DEBIT);
    expect(debit.message).not.toBe(MESSAGE_GENERIQUE);
    // Un échec muet aurait laissé l'agent attendre un courriel jamais parti :
    // c'est arrivé le 07/09/2026 sur une invitation.
    expect(debit.message).toContain('Réessayez dans quelques minutes');
  });

  it('la reconnaissance ne dépend pas de la casse ni du reste du message', () => {
    expect(estLimiteDeDebit(new Error('email rate limit exceeded'))).toBe(true);
    expect(estLimiteDeDebit(new Error('For security purposes, Rate Limit reached'))).toBe(true);
    expect(estLimiteDeDebit(new Error('User not found'))).toBe(false);
    expect(estLimiteDeDebit(undefined)).toBe(false);
  });

  it('la carte le dit aussi, en passant par le branchement', async () => {
    const banc = monteLaCarte({
      reset: () => Promise.reject(new Error('email rate limit exceeded')),
    });
    await envoie(banc, 'agent@tramwaydumontblanc.fr');
    expect(banc.dom.zone.textContent).toBe(MESSAGE_DEBIT);
  });
});

// ---------------------------------------------------------------------------
// §2 — l'adresse suit l'agent
// ---------------------------------------------------------------------------

describe('§2 — le lien et la carte', () => {
  it('l’adresse saisie dans `login-email` est reportée dans la carte', () => {
    const banc = monteLaCarte();
    banc.dom.champLogin.value = '  agent@tramwaydumontblanc.fr  ';
    banc.dom.lienOubli.declenche('click');
    // L'agent vient de la taper : la redemander serait une petite insulte.
    expect(banc.dom.champOubli.value).toBe('agent@tramwaydumontblanc.fr');
  });

  it('le lien masque la connexion et montre la carte ; le retour fait l’inverse', () => {
    const banc = monteLaCarte();
    banc.dom.lienOubli.declenche('click');
    expect(banc.dom.formConnexion.hidden).toBe(true);
    expect(banc.dom.formOubli.hidden).toBe(false);
    expect(banc.dom.champOubli.focusRecu).toBe(1);
    banc.dom.lienRetour.declenche('click');
    expect(banc.dom.formConnexion.hidden).toBe(false);
    expect(banc.dom.formOubli.hidden).toBe(true);
  });

  it('la page porte bien le lien, la carte et ses organes', () => {
    // Le module peut être parfait et n'être branché sur rien.
    const html = source('supervision.html');
    expect(html).toContain('id="lien-oubli"');
    expect(html).toContain('Mot de passe oublié ?');
    expect(html).toContain('<form class="connexion-carte" id="form-oubli" hidden>');
    for (const organe of ['oubli-email', 'oubli-envoyer', 'oubli-retour', 'oubli-erreur']) {
      expect(html, `organe ${organe} absent`).toContain(`id="${organe}"`);
    }
    expect(html).toContain('Envoyer le lien');
    expect(html).toContain('Revenir à la connexion');
    // Un bouton sans `type` dans un <form> envoie le formulaire.
    expect(html).toContain('<button class="lien-discret" type="button" id="lien-oubli">');
    expect(html).toContain('<button class="lien-discret" type="button" id="oubli-retour">');
  });

  it('la supervision branche la carte sur le vrai fournisseur', () => {
    const src = source('src/pages/supervision.ts');
    expect(src).toContain('brancheMotDePasseOublie({');
    expect(src).toContain('reset: (email) => provider.resetMotDePasse(email),');
    // Aucun appel réseau ajouté au chargement : le branchement ne pose que
    // des écouteurs, et il est bien placé dans le démarrage de la page.
    const branchement = src.indexOf('brancheMotDePasseOublie({');
    const bloc = src.slice(branchement, src.indexOf('});', branchement));
    expect(bloc).not.toMatch(/await |\.then\(/);
  });

  it('le parcours éprouvé en réel n’est pas touché', () => {
    // Interdit du chantier : `form-mdp`, `detectSessionInUrl`, `urlRetourAuth`.
    const html = source('supervision.html');
    expect(html).toContain('<form class="connexion-carte" id="form-mdp" hidden>');
    expect(html).toContain('id="mdp-valider"');
    expect(source('src/data/supabase.ts')).toContain('private static urlRetourAuth(): string {');
    // Et le bouton de l'administrateur reste dans la liste des utilisateurs :
    // les deux chemins coexistent, aucun ne remplace l'autre.
    expect(source('src/pages/supervision.ts')).toContain('.resetMotDePasse(u.email)');
  });
});

// ---------------------------------------------------------------------------
// §4 — le délai d'attente
// ---------------------------------------------------------------------------

describe('§4 — le bouton se tait pendant une minute', () => {
  it('il est désactivé DÈS l’envoi, avant même la réponse', () => {
    const banc = monteLaCarte({ reset: () => new Promise(() => undefined) });
    banc.dom.lienOubli.declenche('click');
    banc.dom.champOubli.value = 'agent@tramwaydumontblanc.fr';
    banc.dom.formOubli.declenche('submit');
    // Sans attendre la moindre micro-tâche : c'est pendant que rien ne se
    // passe que l'agent clique cinq fois.
    expect(banc.dom.bouton.disabled).toBe(true);
  });

  it('il montre le décompte puis revient au bout du délai', async () => {
    const banc = monteLaCarte();
    await envoie(banc, 'agent@tramwaydumontblanc.fr');
    expect(banc.dom.bouton.disabled).toBe(true);
    expect(banc.dom.bouton.textContent).toBe(`Réessayer dans ${DELAI_REESSAI_S} s`);
    banc.horloge.avance(13);
    expect(banc.dom.bouton.textContent).toBe(`Réessayer dans ${DELAI_REESSAI_S - 13} s`);
    banc.horloge.avance(DELAI_REESSAI_S - 13 - 1);
    expect(banc.dom.bouton.textContent).toBe('Réessayer dans 1 s');
    expect(banc.dom.bouton.disabled).toBe(true);
    banc.horloge.avance(1);
    expect(banc.dom.bouton.disabled).toBe(false);
    expect(banc.dom.bouton.textContent).toBe('Envoyer le lien');
    // Et la minuterie ne survit pas au décompte.
    expect(banc.horloge.armee).toBe(false);
  });

  it('un second envoi pendant l’attente ne part pas', async () => {
    const banc = monteLaCarte();
    await envoie(banc, 'agent@tramwaydumontblanc.fr');
    banc.dom.formOubli.declenche('submit');
    await Promise.resolve();
    // `disabled` n'arrête pas un envoi par la touche Entrée : le garde-fou
    // doit être dans le code, pas seulement dans l'attribut.
    expect(banc.appels).toEqual(['agent@tramwaydumontblanc.fr']);
    banc.horloge.avance(DELAI_REESSAI_S);
    banc.dom.formOubli.declenche('submit');
    await envoie(banc, 'agent@tramwaydumontblanc.fr');
    expect(banc.appels.length).toBe(2);
  });

  it('revenir sur la carte pendant l’attente ne fait pas disparaître le message', async () => {
    // Constaté au navigateur : le bouton restait bloqué et la ligne qui
    // l'expliquait avait été effacée à la réouverture de la carte.
    const banc = monteLaCarte();
    await envoie(banc, 'agent@tramwaydumontblanc.fr');
    banc.horloge.avance(10);
    banc.dom.lienRetour.declenche('click');
    banc.dom.lienOubli.declenche('click');
    expect(banc.dom.bouton.disabled).toBe(true);
    expect(banc.dom.zone.textContent).toBe(MESSAGE_GENERIQUE);
    // Une fois l'attente finie, la carte repart propre.
    banc.horloge.avance(DELAI_REESSAI_S);
    banc.dom.lienOubli.declenche('click');
    expect(banc.dom.zone.textContent).toBe('');
  });

  it('le décompte est arrondi au plafond et n’est jamais négatif', () => {
    const decompte = creeDecompte(60);
    expect(decompte.libelle(DEPART_MS)).toBe(null); // pas encore armé
    decompte.demarre(DEPART_MS);
    expect(decompte.libelle(DEPART_MS)).toBe('Réessayer dans 60 s');
    expect(decompte.libelle(DEPART_MS + 600)).toBe('Réessayer dans 60 s');
    expect(decompte.libelle(DEPART_MS + 59_999)).toBe('Réessayer dans 1 s');
    expect(decompte.libelle(DEPART_MS + 60_000)).toBe(null);
    expect(decompte.libelle(DEPART_MS + 900_000)).toBe(null);
  });

  it('le délai est bien de soixante secondes', () => {
    expect(DELAI_REESSAI_S).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// §7.5 — une adresse impossible ne consomme rien
// ---------------------------------------------------------------------------

describe('une adresse vide ou mal formée n’appelle pas le fournisseur', () => {
  it('aucun appel, et un message qui ne parle que de la saisie', async () => {
    for (const saisie of ['', '   ', 'pas-une-adresse', 'agent@tramway', 'a b@c.fr', '@c.fr']) {
      const banc = monteLaCarte();
      await envoie(banc, saisie);
      // La limite de débit du projet est commune à tout le monde : une demande
      // vouée à l'échec ne doit pas l'entamer.
      expect(banc.appels, `« ${saisie} » est partie au fournisseur`).toEqual([]);
      expect(banc.dom.zone.textContent).toBe(MESSAGE_ADRESSE);
      // Ce message ne dit rien d'un COMPTE : il ne sert pas l'énumération.
      expect(banc.dom.zone.textContent).not.toContain('compte');
      // Et le bouton revient tout de suite : une faute de frappe ne se punit
      // pas d'une minute d'attente.
      expect(banc.dom.bouton.disabled).toBe(false);
      expect(banc.horloge.armee).toBe(false);
    }
  });

  it('les adresses plausibles passent, la validation reste au serveur', () => {
    expect(adresseUtilisable('agent@tramwaydumontblanc.fr')).toBe(true);
    expect(adresseUtilisable('  agent+test@tramwaydumontblanc.fr  ')).toBe(true);
    expect(adresseUtilisable('')).toBe(false);
    expect(adresseUtilisable('agent@@tramwaydumontblanc.fr')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §7.6 — le test porte sur l'APPEL, pas sur la présence d'une ligne de code
// ---------------------------------------------------------------------------

describe('l’appel au fournisseur a bien lieu', () => {
  it('le fournisseur de démonstration garde la trace de la demande', async () => {
    const mock = new MockProvider();
    const banc = monteLaCarte({ reset: (email) => mock.resetMotDePasse(email), modeDemo: true });
    await envoie(banc, 'agent@tramwaydumontblanc.fr');
    // La trace vient du fournisseur lui-même : la carte l'a réellement
    // sollicité, elle n'a pas seulement affiché un message.
    expect(mock.reinitialisationsDemandees).toEqual(['agent@tramwaydumontblanc.fr']);
  });

  it('l’adresse transmise est nettoyée de ses espaces', async () => {
    const banc = monteLaCarte();
    banc.dom.lienOubli.declenche('click');
    banc.dom.champOubli.value = '  agent@tramwaydumontblanc.fr ';
    banc.dom.formOubli.declenche('submit');
    await Promise.resolve();
    await Promise.resolve();
    expect(banc.appels).toEqual(['agent@tramwaydumontblanc.fr']);
  });
});

// ---------------------------------------------------------------------------
// §6 — le mode démo
// ---------------------------------------------------------------------------

describe('§6 — le mode démo le dit', () => {
  it('sans Supabase, la carte annonce qu’aucun courriel ne part', async () => {
    const banc = monteLaCarte({ modeDemo: true });
    await envoie(banc, 'agent@tramwaydumontblanc.fr');
    expect(banc.dom.zone.textContent).toBe(MESSAGE_DEMO);
    expect(banc.dom.zone.textContent).toContain('aucun courriel');
    // Le fournisseur est tout de même sollicité : on montre le vrai chemin.
    expect(banc.appels).toEqual(['agent@tramwaydumontblanc.fr']);
  });

  it('le mode démo se déduit du MÊME discriminant que le reste de la page', () => {
    // « Cherche comment la page distingue déjà les deux mondes et fais pareil,
    // n'invente pas un second mécanisme. »
    const src = source('src/pages/supervision.ts');
    expect(src).toContain('modeDemo: !configSupabasePresente(),');
    expect(source('src/data/config.ts')).toContain('export function configSupabasePresente()');
  });
});

// ---------------------------------------------------------------------------
// §5 — le compte désactivé
// ---------------------------------------------------------------------------

describe('§5 — un compte désactivé dit quoi faire', () => {
  it('le refus devient actionnable', () => {
    expect(messageRefusConnexion(new Error('Profil inactif ou absent'))).toBe(
      'Ce compte est désactivé. Demandez sa réactivation à un administrateur.',
    );
  });

  it('les autres refus passent tels quels', () => {
    expect(messageRefusConnexion(new Error('Invalid login credentials'))).toBe(
      'Invalid login credentials',
    );
    expect(messageRefusConnexion('rien du tout')).toBe('Connexion refusée');
  });

  it('le refus lui-même n’a pas changé de place', () => {
    // On rend le message actionnable, on ne touche pas à la règle.
    expect(source('src/data/supabase.ts')).toContain(
      "if (!profil?.actif) throw new Error('Profil inactif ou absent');",
    );
    expect(source('src/pages/supervision.ts')).toContain(
      "$('login-erreur').textContent = messageRefusConnexion(erreur);",
    );
  });

  it('la carte « mot de passe oublié » ne reconnaît PAS un compte désactivé', async () => {
    // Ce serait rétablir exactement la distinction que §3 interdit : ici,
    // personne n'a prouvé quoi que ce soit.
    const banc = monteLaCarte({ reset: () => Promise.reject(new Error('Profil inactif')) });
    await envoie(banc, 'agent@tramwaydumontblanc.fr');
    expect(banc.dom.zone.textContent).toBe(MESSAGE_GENERIQUE);
    expect(banc.dom.zone.textContent).not.toContain('désactivé');
  });
});
