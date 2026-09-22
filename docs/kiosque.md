# Poste écran Raspberry Pi — installation kiosque

Objectif : un Pi qui démarre SEUL sur l'écran de sa gare, sans clavier ni
souris, et se remet en route après toute coupure de courant. Procédure
d'« échange standard en 10 minutes » incluse.

> **Ce document décrit l'état MESURÉ du poste `tmb-ecran-test` le
> 15/09/2026**, pas une procédure théorique. Chaque fichier cité a été lu sur
> le Pi ce jour-là. La version précédente décrivait une variante
> **Raspberry Pi OS Lite + Xorg + systemd** qui n'a jamais été celle en
> service : le poste tourne sur **Raspberry Pi OS complet, en Wayland, sous
> labwc**, et rien ne démarre par un service `kiosque.service`.

État relevé : Debian GNU/Linux 13 (trixie), noyau 6.18.39+rpt-rpi-2712,
aarch64 (Pi 5).

---

## 1. Ce qui démarre l'écran, dans l'ordre

Il n'y a **pas** de `kiosque.service`. La chaîne est celle de Raspberry Pi OS
bureau, à laquelle rien n'a été ajouté :

1. `lightdm` démarre (`lightdm.service`, activé).
2. Il ouvre une session **sans mot de passe** pour l'utilisateur `tmb`
   (`/etc/lightdm/lightdm.conf` : `autologin-user=tmb`,
   `autologin-session=rpd-labwc`, `user-session=rpd-labwc`).
3. La session `rpd-labwc` lance le compositeur **labwc** en **Wayland**
   (`/usr/bin/labwc -m` ; `loginctl` confirme `Type=wayland`).
4. labwc exécute `~/.config/labwc/autostart`, qui lance Chromium.

Conséquence pratique : tout ce qui concerne le kiosque se règle dans le
dossier `~/.config/labwc/` de l'utilisateur `tmb`, pas dans `/etc/systemd`.

### `~/.config/labwc/autostart`

```sh
#!/bin/sh
unclutter-xfixes -idle 0 &
GARE=$(tr -d ' \r\n' < /boot/firmware/gare.txt)
chromium --kiosk --noerrdialogs --disable-infobars \
  --disable-session-crashed-bubble --check-for-update-interval=31536000 \
  --autoplay-policy=no-user-gesture-required \
  --password-store=basic --disable-features=Translate --lang=fr \
  "https://rdtmb.github.io/tmb-affichage-gares/ecran.html?gare=${GARE}&ecran=${GARE}-ecran-1" &
```

Le binaire est `chromium` (paquet `chromium`), **pas** `chromium-browser`.

> ### ⚠ `&ecran=` N'EST PAS DÉCORATIF : sans lui, le poste n'existe plus
>
> C'est ce paramètre, et lui seul, qui dit à la supervision QUEL poste
> parle. Il n'est plus déduit de la gare depuis le 19/09/2026 : ce jour-là,
> l'écran de Saint-Gervais est resté muet trois heures et un onglet
> `ecran.html?gare=saint-gervais` ouvert sur un poste de bureau battait sous
> le même identifiant que le Raspberry — la supervision l'a dit sain pendant
> une heure et **le guetteur n'a envoyé aucune alerte**.
>
> Conséquence directe pour qui touche à ce fichier : une URL sans `&ecran=`
> affiche parfaitement les horaires, mais le poste **disparaît de la
> supervision** et le guetteur finit par alerter sur un écran qui va bien.
> L'erreur ne se voit donc PAS sur l'écran — seulement en supervision, et en
> console (`[TMB] aucun signal de vie…`).
>
> La chaîne doit être **exactement** celle déclarée en supervision
> (§12). `${GARE}-ecran-1` la reconstruit pour le premier écran des départs
> d'une gare ; pour un deuxième écran, ou un poste au nom libre, écrire la
> chaîne en dur plutôt que de bricoler la variable.

### `~/.config/labwc/environment`

```
XKB_DEFAULT_MODEL=pc105
XKB_DEFAULT_LAYOUT=fr
XKB_DEFAULT_VARIANT=
XKB_DEFAULT_OPTIONS=
XCURSOR_THEME=invisible
XCURSOR_SIZE=24
```

**C'est `XCURSOR_THEME=invisible` qui fait disparaître le pointeur**, pas
`unclutter`. Le thème « invisible » est un thème de curseur entièrement
transparent : le pointeur n'apparaît donc jamais, même au premier
mouvement — là où `unclutter` ne le masque qu'après un délai d'inactivité.
Si le curseur réapparaît sur un poste, c'est cette ligne qu'il faut
regarder en premier.

## 2. La gare de l'écran = un seul fichier

> Le fichier donne la GARE ; il ne donne pas le POSTE. `autostart` en déduit
> l'identifiant `${GARE}-ecran-1`, ce qui convient au premier écran des
> départs d'une gare et à lui seul. Tout autre poste (deuxième écran, grille
> horaire, nom libre) porte sa chaîne en dur dans `autostart`.

`/boot/firmware/gare.txt` contient UNIQUEMENT l'identifiant de la gare :
`le-fayet`, `saint-gervais`, `motivon`, `col-de-voza`, `bellevue` ou
`nid-daigle`. C'est le seul élément qui change d'un Pi à l'autre.

Le fichier est lu à chaud par `autostart` à chaque démarrage : le changer et
redémarrer suffit à réaffecter un Pi à une autre gare.

## 3. Les drapeaux Chromium — et le piège du nom de fichier

Chromium sur Raspberry Pi OS ne lit pas seulement la ligne de commande : le
lanceur `/usr/bin/chromium` **source tous les fichiers de `/etc/chromium.d/`**
et concatène leurs `CHROMIUM_FLAGS`. Trois d'entre eux appartiennent à des
paquets (`00-rpi-vars` à `rpi-chromium-mods`, `extensions` et `default-flags`
à `chromium`) et ajoutent des drapeaux d'extensions dont un kiosque n'a aucun
besoin — et qui travaillaient contre la politique
`ExtensionInstallBlocklist` posée le 08/09/2026 :

```sh
# extensions
export CHROMIUM_FLAGS="$CHROMIUM_FLAGS --enable-remote-extensions"
export CHROMIUM_FLAGS="$CHROMIUM_FLAGS --load-extension=`ls -dm /usr/share/chromium/extensions/* …`"
# default-flags
export CHROMIUM_FLAGS="$CHROMIUM_FLAGS --show-component-extension-options"
# 00-rpi-vars
export CHROMIUM_FLAGS="$CHROMIUM_FLAGS --force-renderer-accessibility --enable-remote-extensions"
```

On ne modifie PAS ces trois fichiers : ils appartiennent à des paquets, et la
première mise à jour les réécrirait sans prévenir — le correctif
disparaîtrait en silence. On ajoute donc un fichier à nous,
`/etc/chromium.d/zz-tmb-kiosque`, qui **retranche** ces drapeaux de la liste
déjà construite.

> ### ⚠ LE NOM DE CE FICHIER EST LE CORRECTIF
>
> `/etc/chromium.d/*` est sourcé dans **l'ordre du shell**, où les
> **chiffres passent avant les minuscules**. Un fichier nommé `99-tmb-kiosque`
> serait donc lu **avant** `extensions` et `default-flags` : il retrancherait
> des drapeaux qui ne sont pas encore là, et ne ferait **rien**. Le préfixe
> `zz-` est ce qui le fait passer en dernier.
>
> Celui qui posera le deuxième écran recopiera ce fichier. S'il le renomme —
> par réflexe, « 99- » étant la convention habituelle ailleurs — il annule le
> correctif sans le voir : Chromium démarrera normalement, l'écran affichera
> les horaires, et les extensions seront de nouveau autorisées.

Contenu de `/etc/chromium.d/zz-tmb-kiosque` :

```sh
NOUVEAU=""
for f in $CHROMIUM_FLAGS; do
  case "$f" in
    --enable-remote-extensions|--show-component-extension-options) continue ;;
    --load-extension|--load-extension=*) continue ;;
  esac
  NOUVEAU="$NOUVEAU $f"
done
export CHROMIUM_FLAGS="${NOUVEAU# }"
```

**Vérification** — la seule qui prouve quoi que ce soit est la ligne de
commande réellement obtenue, pas le contenu du fichier :

```bash
ps -eo args | grep -m1 '[c]hromium'
```

Ni `--enable-remote-extensions`, ni `--load-extension`, ni
`--show-component-extension-options` ne doivent y figurer.

## 4. L'horloge : le vrai risque d'exploitation

Le NTP sortant peut être filtré par le réseau de la gare. Une horloge fausse
ne fait pas planter l'écran : elle lui fait afficher les **mauvais trains**,
et déclenche le bandeau « horloge déréglée » qui mange de la hauteur au
tableau. D'où un service dédié.

`/etc/systemd/system/corrige-horloge.service` :

```ini
[Unit]
Description=Corrige l'horloge au demarrage si le NTP est filtre
Wants=network-online.target
After=network-online.target
Before=graphical.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/corrige-horloge.sh
RemainAfterExit=yes

[Install]
WantedBy=graphical.target
```

**`Before=graphical.target` est ce qui protège l'écran** : le service est
terminé avant que lightdm n'ouvre la session, donc avant que Chromium ne
charge la page. Sans cette ligne, l'écran pourrait afficher une page calculée
sur une heure fausse, puis ne jamais la recalculer.

`/usr/local/bin/corrige-horloge.sh` :

```sh
#!/bin/sh
for i in $(seq 1 10); do
  if [ "$(timedatectl show -p NTPSynchronized --value)" = "yes" ]; then
    exit 0
  fi
  sleep 1
done
DATE_HDR=$(curl -skI --max-time 5 https://www.google.com | grep -i '^date:' | cut -d' ' -f2-)
if [ -n "$DATE_HDR" ]; then
  date -s "$DATE_HDR"
fi
```

Il attend le NTP dix secondes, puis se rabat sur l'en-tête `Date:` d'une
réponse HTTPS.

> **Limite connue, non corrigée à ce jour** : si `curl` ne répond rien (pas de
> réseau du tout), le script **sort en succès sans rien dire**. Le service
> apparaît « réussi », l'horloge reste fausse, et personne n'est prévenu. Un
> contrôle qui ne s'exécute pas ne se distingue pas d'un contrôle qui passe.
> C'est le chantier `horloge-echec-muet` du tableau de bord.

Vérification au quotidien : `timedatectl` doit montrer
`System clock synchronized: yes` et `NTP service: active`, fuseau
`Europe/Paris`.

**Pile de l'horloge temps réel** : le Pi 5 a une RTC (`timedatectl` affiche
une ligne `RTC time`). Sans pile, elle repart de zéro à chaque coupure de
courant — exactement le scénario que le service ci-dessus rattrape. Six piles
sont à commander, une par gare.

## 5. Redémarrage quotidien 04:30

Crontab **de root** (`sudo crontab -l`) :

```
30 4 * * * /sbin/reboot
```

Recharge l'application (mises à jour déployées) et purge la mémoire. La
crontab de l'utilisateur `tmb` est vide : ne pas la chercher là.

## 6. Accès SSH — et le piège INVERSE du précédent

Accès par clés uniquement (audit E-05), posé le 08/09/2026 dans
`/etc/ssh/sshd_config.d/01-tmb-cles.conf` :

```
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
PermitRootLogin no
```

Retour arrière : supprimer ce fichier, puis `sudo systemctl reload ssh`.

> ### ⚠ Ici le préfixe `01-` est obligatoire — pour la raison OPPOSÉE
>
> `sshd` applique la **première** valeur rencontrée pour un paramètre donné,
> alors que `/etc/chromium.d/` garde la **dernière**. Le dossier contient déjà
> `50-cloud-init.conf`, qui réactive l'authentification par mot de passe. Un
> fichier nommé `99-tmb-cles.conf` serait lu **après** et n'aurait aucun
> effet.
>
> Deux dossiers, deux pièges d'ordre, deux règles contraires : `zz-` pour
> Chromium, `01-` pour sshd. Ne pas transposer l'un à l'autre.

## 7. Mises à jour automatiques

`unattended-upgrades` est actif. Les origines réellement autorisées ne se
lisent pas dans un seul fichier — `/etc/apt/apt.conf.d/50unattended-upgrades`
ne cite que Debian — mais dans le **journal**, qui montre la liste effective
après fusion de tous les fichiers de configuration :

```bash
grep 'Allowed origins' /var/log/unattended-upgrades/unattended-upgrades.log | tail -1
```

Au 15/09/2026 : les trois origines Debian **plus**
`origin=Raspberry Pi Foundation,label=Raspberry Pi Foundation`. C'est cette
dernière qui couvre les paquets propres au Pi ; sans elle, ils ne seraient
jamais mis à jour automatiquement.

Le message « 1 updates could not be installed automatically » au login
**n'est pas une panne** : le noyau et les firmwares sont volontairement sur
liste noire (`linux-image-`, `raspberrypi-kernel`, `raspberrypi-bootloader`,
`raspi-firmware`). Un écran en gare ne change pas de noyau tout seul.

## 8. Préparer une carte SD (poste neuf)

1. Raspberry Pi Imager → **Raspberry Pi OS (64-bit)**, la version **complète**
   avec bureau — pas Lite : la chaîne ci-dessus repose sur lightdm et labwc.
2. Options de l'imager : nom d'hôte (`tmb-ecran-<gare>`), utilisateur `tmb` +
   mot de passe de la Régie, Wi-Fi si besoin, SSH activé.
3. `sudo raspi-config` → *System Options* → *Boot / Auto Login* →
   **Desktop Autologin**, puis vérifier dans `/etc/lightdm/lightdm.conf` que
   `autologin-user=tmb` et `autologin-session=rpd-labwc` sont bien là.
4. `sudo timedatectl set-timezone Europe/Paris`.
5. Copier depuis un poste en service, à l'identique :
   `~/.config/labwc/autostart`, `~/.config/labwc/environment`,
   `/etc/chromium.d/zz-tmb-kiosque`,
   `/etc/systemd/system/corrige-horloge.service`,
   `/usr/local/bin/corrige-horloge.sh` (`chmod +x` sur les deux scripts),
   `/etc/ssh/sshd_config.d/01-tmb-cles.conf` (avec la clé publique du poste
   d'administration dans `~/.ssh/authorized_keys`).
   **Recopier les noms EXACTEMENT** — voir les deux encadrés ci-dessus.
6. `sudo systemctl enable corrige-horloge`, puis la crontab root du §5.
7. Déclarer le poste en supervision (§12) et vérifier que la chaîne déclarée
   est bien celle que produit le `&ecran=` d'`autostart` — un poste au nom
   libre ou un deuxième écran demande d'écrire la chaîne en dur (§1).
8. Écrire `/boot/firmware/gare.txt`, redémarrer, vérifier avec le §10.

## 9. Échange standard en 10 minutes

1. Flasher une carte SD depuis l'image standard (conservée au dépôt).
2. Écrire l'identifiant de la gare dans `gare.txt` (§2).
3. Brancher HDMI + RJ45 (ou Wi-Fi/5G au Nid d'Aigle) + alimentation.
4. L'écran démarre seul ; vérifier l'heure et la gare affichées.
5. Contrôler dans Supervision → Écrans que le poste apparaît « en ligne ».
   S'il n'apparaît pas alors que l'écran affiche bien les horaires, c'est le
   `&ecran=` d'`autostart` qu'il faut regarder en premier (§1), pas le réseau.

## 10. Vérifier un poste, en cinq commandes

```bash
ps -eo args | grep -m1 '[c]hromium'   # bons drapeaux, bonne gare ET &ecran= dans l'URL
timedatectl | head -6                  # synchronisé, Europe/Paris
systemctl is-enabled corrige-horloge lightdm
sudo crontab -l                        # le reboot de 04:30
cat /boot/firmware/gare.txt            # la bonne gare
```

## 11. Checklist de pose en gare

- [ ] Alimentation secourue/protégée (Nid d'Aigle : solaire EcoFlow — vérifier charge)
- [ ] RJ45 fibre (ou 5G au Nid d'Aigle) : tester `curl -I https://rdtmb.github.io` depuis le Pi
- [ ] Orientation et hauteur validées avec l'exploitant, pas de reflets
- [ ] Test PLEIN SOLEIL : lisibilité du tableau marine à 2 m
- [ ] `gare.txt` = identifiant correct (l'écran affiche le bon nom de gare)
- [ ] **Poste DÉCLARÉ en supervision (§12), et sa chaîne recopiée en `&ecran=`
      dans `autostart`** — `ps -eo args | grep '[c]hromium'` doit la montrer.
      Sans elle, l'écran affiche parfaitement les horaires et disparaît
      pourtant de la supervision : rien sur place ne le signale.
- [ ] Heure exacte et date française dans le bandeau ; **pile RTC en place**
- [ ] Curseur invisible (le thème, §1) — rien ne doit apparaître à la souris
- [ ] Écran visible « en ligne » en supervision ; test du bouton « Recharger »
- [ ] Coupure réseau 3 min : badge « données de HH:MM » puis retour normal

## 12. Déclarer le poste AVANT de le mettre en service

Depuis la mise en conformité des Security Advisors, un écran ne s'inscrit
plus tout seul : Supervision → onglet **Écrans** → choisir la gare, le type
(écran des départs / grille horaire) et le numéro, puis **+ Déclarer**.

**L'identifiant proposé (`le-fayet-ecran-1`) doit être RECOPIÉ dans l'URL du
poste**, en `&ecran=` (§1). La page ne le devine plus : depuis le 19/09/2026
elle ne se signale QUE sous le nom qu'on lui a donné. C'est ce qui empêche un
onglet ouvert ailleurs de battre à la place de l'écran en gare — et donc de
couvrir sa panne.

Deux situations, deux symptômes qu'il ne faut pas confondre :

| Ce qui manque                        | Ce que fait la page          | Console                              |
| ------------------------------------ | ---------------------------- | ------------------------------------ |
| `&ecran=` absent de l'URL            | horaires OK, **aucun** signal | `[TMB] aucun signal de vie…`         |
| poste non déclaré en supervision     | horaires OK, signal perdu     | `[TMB] signal de vie non enregistré…` |

Dans les deux cas l'affichage voyageurs est intact — l'échec du signal de vie
n'interrompt JAMAIS ce que voient les voyageurs — mais le poste reste
invisible en supervision, et le guetteur finira par alerter.

Pour un deuxième écran dans la même gare, déclarer le numéro 2 et lancer la
page avec `&ecran=le-fayet-ecran-2`.

## 13. Ce qui n'est pas résolu, et qu'il ne faut pas croire résolu

- **`corrige-horloge.sh` échoue en silence** quand le réseau est absent (§4).
- **Aucune mise en veille n'est configurée.** `swayidle` est installé mais ne
  tourne pas, et rien dans `autostart` ne l'appelle : c'est l'absence de
  gestionnaire d'inactivité qui garde l'écran allumé, pas un réglage.
  Un futur `swayidle` ajouté par une mise à jour de l'image éteindrait donc
  l'écran des voyageurs. `wlopm` est disponible si le contraire devient un
  jour souhaitable (extinction nocturne).
- **`unclutter-xfixes` est lancé par `autostart`** alors que le curseur est
  déjà masqué par le thème et que l'outil vise X11. Il n'a pas été établi
  qu'il fasse quoi que ce soit sous Wayland. Inoffensif ; à retirer à la
  prochaine reprise du fichier plutôt qu'à recopier comme s'il était utile.
- **Un poste de test, un seul.** Tout ce document a été relevé sur
  `tmb-ecran-test`. Le premier poste posé en gare devra être comparé à ce
  document, pas supposé conforme.
