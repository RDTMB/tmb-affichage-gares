# Poste écran Raspberry Pi — installation kiosque (docs/02 §6)

Objectif : un Pi qui démarre SEUL sur l'écran de sa gare, sans clavier ni
souris, et se remet en route après toute coupure de courant. Procédure
d'« échange standard en 10 minutes » incluse.

## 1. Préparer la carte SD (une fois, image standard)

1. Raspberry Pi Imager → **Raspberry Pi OS Lite (64-bit)**.
2. Dans les options de l'imager : nom d'hôte `tmb-ecran`, utilisateur
   `tmb` + mot de passe de la Régie, Wi-Fi si besoin, SSH activé.
3. Démarrer le Pi, puis installer le nécessaire :

```bash
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y --no-install-recommends xserver-xorg xinit chromium-browser unclutter fonts-dejavu
```

4. NTP : vérifier `timedatectl` → « NTP service: active » (fuseau
   `Europe/Paris` : `sudo timedatectl set-timezone Europe/Paris`).

## 2. La gare de l'écran = un seul fichier

Créer `/boot/firmware/gare.txt` contenant UNIQUEMENT l'identifiant de la
gare : `le-fayet`, `saint-gervais`, `motivon`, `col-de-voza`, `bellevue` ou
`nid-daigle`. C'est le seul élément qui change d'un Pi à l'autre.

## 3. Lancement kiosque via systemd

`/home/tmb/kiosque.sh` (adapter l'URL de production GitHub Pages) :

```bash
#!/bin/bash
GARE=$(tr -d ' \r\n' < /boot/firmware/gare.txt)
URL="https://<organisation>.github.io/tmb-affichage-gares/ecran.html?gare=${GARE}"
unclutter -idle 1 &
exec chromium-browser --kiosk --noerrdialogs --disable-infobars \
  --disable-session-crashed-bubble --check-for-update-interval=31536000 \
  --autoplay-policy=no-user-gesture-required "$URL"
```

`sudo nano /etc/systemd/system/kiosque.service` :

```ini
[Unit]
Description=Écran voyageurs TMB
After=network-online.target

[Service]
User=tmb
ExecStart=/usr/bin/startx /home/tmb/kiosque.sh -- -nocursor
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
chmod +x /home/tmb/kiosque.sh
sudo systemctl enable kiosque
```

## 4. Reboot quotidien 04:30

```bash
sudo crontab -e
# ajouter :
30 4 * * * /sbin/reboot
```

(Recharge l'application — mises à jour déployées — et purge la mémoire.)

## 5. Échange standard en 10 minutes

1. Flasher une carte SD depuis l'image standard (conservée au dépôt).
2. Écrire l'identifiant de la gare dans `gare.txt` (étape 2).
3. Brancher HDMI + RJ45 (ou Wi-Fi/5G au Nid d'Aigle) + alimentation.
4. L'écran démarre seul ; vérifier l'heure et la gare affichées.
5. Contrôler dans Supervision → Écrans que le poste apparaît « en ligne ».

## 6. Checklist de pose en gare

- [ ] Alimentation secourue/protégée (Nid d'Aigle : solaire EcoFlow — vérifier charge)
- [ ] RJ45 fibre (ou 5G au Nid d'Aigle) : tester https://github.com depuis le Pi
- [ ] Orientation et hauteur validées avec l'exploitant, pas de reflets
- [ ] Test PLEIN SOLEIL : lisibilité du tableau marine à 2 m
- [ ] `gare.txt` = identifiant correct (l'écran affiche le bon nom de gare)
- [ ] Heure exacte (NTP) et date française dans le bandeau
- [ ] Écran visible « en ligne » en supervision ; test du bouton « Recharger »
- [ ] Coupure réseau 3 min : badge « données de HH:MM » puis retour normal
