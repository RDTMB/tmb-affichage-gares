<#
.SYNOPSIS
    Déploie les Edge Functions du projet TMB sur un projet Supabase donné.

.DESCRIPTION
    Reproduit, sans passer par le tableau de bord, le déploiement des trois
    fonctions « traduire », « inviter-utilisateur » et « supprimer-utilisateur ».

    Le script :
      - retrouve node/npx même s'il n'est pas dans le PATH (installation portable) ;
      - impose TOUJOURS --project-ref, pour qu'un projet lié en cache ne puisse
        pas détourner le déploiement vers la production ;
      - exige une confirmation tapée à la main avant tout envoi en production ;
      - travaille sans Docker (--use-api) ;
      - n'affiche, ne journalise et ne stocke JAMAIS le jeton d'accès.

    L'authentification se fait une fois pour toutes par « -Connexion », qui ouvre
    le navigateur. Aucun secret n'est à taper dans le terminal.

.PARAMETER Projet
    « test » ou « prod ». Obligatoire : il n'y a pas de valeur par défaut, pour
    qu'un oubli ne parte jamais en production.

.PARAMETER Fonctions
    Les fonctions à déployer. Par défaut les trois du projet.

.PARAMETER VersionCli
    Version de la CLI Supabase. Figée pour être reproductible ; « latest » est
    accepté pour un dépannage ponctuel.

.PARAMETER Node
    Dossier contenant npx.cmd, à indiquer seulement si le script ne le trouve
    pas seul. En cas d'échec, il affiche tout ce qu'il a essayé.

.PARAMETER Connexion
    Ouvre le navigateur pour autoriser ce poste, puis s'arrête. À faire une fois.

.PARAMETER Simulation
    Vérifie tout (npx, dossiers, autorisation, projet joignable) et affiche
    l'état actuel des fonctions déployées, mais ne déploie rien.

.NOTES
    Windows refuse par défaut d'exécuter un fichier .ps1. Passer par le lanceur
    outils\deployer-edge-functions.cmd, qui accepte exactement les mêmes
    paramètres et ne demande aucun droit particulier.

.EXAMPLE
    .\outils\deployer-edge-functions.cmd -Connexion

.EXAMPLE
    .\outils\deployer-edge-functions.cmd -Projet test -Simulation

.EXAMPLE
    .\outils\deployer-edge-functions.cmd -Projet test

.EXAMPLE
    .\outils\deployer-edge-functions.cmd -Projet prod
#>
[CmdletBinding()]
param(
    [ValidateSet('test', 'prod')]
    [string] $Projet,

    [string[]] $Fonctions = @('traduire', 'inviter-utilisateur', 'supprimer-utilisateur'),

    [string] $VersionCli = '2.116.0',

    [string] $Node,

    [switch] $Connexion,

    [switch] $Simulation
)

$ErrorActionPreference = 'Stop'

# --- Références des projets Supabase -----------------------------------------
# Écrites en dur A DESSEIN : un ref saisi à la main est un ref qu'on peut se
# tromper de taper, et se tromper ici veut dire déployer en production.
$REFS = @{
    test = 'wyltzhggbyfteojbfoup'
    prod = 'csstkdcqdzaiibfqrscv'
}

function Ecrire-Titre($texte) {
    Write-Host ''
    Write-Host "== $texte" -ForegroundColor Cyan
}

function Ecrire-Ok($texte) {
    Write-Host "   OK   $texte" -ForegroundColor Green
}

function Ecrire-Info($texte) {
    Write-Host "        $texte" -ForegroundColor DarkGray
}

# --- 1. Retrouver npx ---------------------------------------------------------
# Chaque emplacement essayé est consigné : quand rien n'est trouvé, le script
# affiche la liste plutôt qu'un « introuvable » qui n'apprend rien.
$script:Essais = New-Object System.Collections.Generic.List[object]

function Tester-Dossier {
    param([string] $Dossier)

    if ([string]::IsNullOrWhiteSpace($Dossier)) { return $null }
    $chemin = Join-Path $Dossier 'npx.cmd'
    $vu = $false
    try {
        # Test-Path répond aussi False quand l'accès est REFUSÉ, sans le dire.
        $vu = Test-Path -LiteralPath $chemin
    } catch {
        $vu = $false
    }
    $script:Essais.Add([pscustomobject]@{ Chemin = $chemin; Trouve = $vu })
    if ($vu) { return $chemin }
    return $null
}

<#
    Racines où chercher une installation portable.

    Le piège du poste : l'application Claude est un paquet MSIX. Un terminal
    ouvert DEPUIS elle tourne dans le conteneur du paquet, où LOCALAPPDATA ne
    désigne plus « …\AppData\Local » mais
    « …\AppData\Local\Packages\<paquet>\LocalCache\Local ». Le dossier node y
    paraît absent alors qu'il est bien là, un cran plus haut. On essaie donc
    aussi la racine située AVANT « \Packages\ ».
#>
function Racines-Candidates {
    $racines = New-Object System.Collections.Generic.List[string]
    $bruts = @(
        $env:LOCALAPPDATA,
        [Environment]::GetFolderPath('LocalApplicationData'),
        (Join-Path $env:USERPROFILE 'AppData\Local'),
        (Join-Path "C:\Users\$env:USERNAME" 'AppData\Local')
    )
    foreach ($r in $bruts) {
        if ([string]::IsNullOrWhiteSpace($r)) { continue }
        $racines.Add($r)
        $i = $r.IndexOf('\Packages\')
        if ($i -gt 0) { $racines.Add($r.Substring(0, $i)) }
    }
    return ($racines | Select-Object -Unique)
}

function Trouver-Npx {
    param([string] $Impose)

    if (-not [string]::IsNullOrWhiteSpace($Impose)) {
        # Chemin donné à la main : accepter le dossier comme le fichier.
        if ($Impose -like '*npx.cmd') { $Impose = Split-Path -Parent $Impose }
        return (Tester-Dossier $Impose)
    }

    $trouve = Get-Command 'npx.cmd' -ErrorAction SilentlyContinue
    if ($null -ne $trouve) { return $trouve.Source }

    # Installation portable, version NON figée : on prend celle qui est là.
    foreach ($racine in Racines-Candidates) {
        $portable = Join-Path $racine 'nodejs-portable'
        $versions = @()
        try {
            $versions = Get-ChildItem -LiteralPath $portable -Directory -Filter 'node-v*-win-x64' -ErrorAction Stop
        } catch {
            $script:Essais.Add([pscustomobject]@{ Chemin = "$portable\node-v*-win-x64"; Trouve = $false })
        }
        foreach ($v in $versions) {
            $r = Tester-Dossier $v.FullName
            if ($null -ne $r) { return $r }
        }
    }

    # Installations classiques.
    foreach ($dossier in @(
            (Join-Path $env:ProgramFiles 'nodejs'),
            (Join-Path ${env:ProgramFiles(x86)} 'nodejs'),
            (Join-Path $env:APPDATA 'npm'),
            (Join-Path $env:ProgramData 'chocolatey\bin'))) {
        $r = Tester-Dossier $dossier
        if ($null -ne $r) { return $r }
    }

    return $null
}

# --- 2. Appel de la CLI -------------------------------------------------------
function Invoquer-Cli {
    param(
        [Parameter(Mandatory = $true)] [string] $Npx,
        [Parameter(Mandatory = $true)] [string[]] $Arguments,
        [switch] $ToleranteALEchec
    )

    $complets = @('--yes', "supabase@$VersionCli") + $Arguments
    Ecrire-Info "npx $($complets -join ' ')"
    & $Npx @complets
    $code = $LASTEXITCODE
    if ($code -ne 0 -and -not $ToleranteALEchec) {
        throw "La CLI Supabase a échoué (code $code)."
    }
    return $code
}

# =============================================================================
Ecrire-Titre 'Poste de travail'

$npx = Trouver-Npx -Impose $Node
if ($null -eq $npx) {
    Write-Host ''
    Write-Host 'node/npx est introuvable depuis cette fenêtre.' -ForegroundColor Red
    Write-Host ''
    Write-Host 'Ce que ce terminal résout :' -ForegroundColor Yellow
    Write-Host "  USERNAME                 $env:USERNAME"
    Write-Host "  USERPROFILE              $env:USERPROFILE"
    Write-Host "  LOCALAPPDATA             $env:LOCALAPPDATA"
    Write-Host ("  API .NET                 " + [Environment]::GetFolderPath('LocalApplicationData'))
    if ($env:LOCALAPPDATA -like '*\Packages\*') {
        Write-Host ''
        Write-Host '  Ce terminal tourne DANS un paquet Windows : son LOCALAPPDATA est' -ForegroundColor Yellow
        Write-Host '  redirigé. Le script a tenu compte de cette redirection.' -ForegroundColor Yellow
    }
    Write-Host ''
    Write-Host 'Emplacements essayés :' -ForegroundColor Yellow
    foreach ($e in $script:Essais) {
        Write-Host ("  {0,-6} {1}" -f $(if ($e.Trouve) { 'vu' } else { 'non' }), $e.Chemin)
    }
    Write-Host ''
    Write-Host 'Deux voies :'
    Write-Host '  1. Indiquer le dossier de npx.cmd à la main, en une seule ligne :'
    Write-Host '     .\outils\deployer-edge-functions.cmd -Projet test -Simulation -Node "C:\chemin\vers\node"'
    Write-Host '  2. Déployer depuis le tableau de bord Supabase'
    Write-Host '     (docs/mise-en-service.md, section E).'
    exit 2
}
Ecrire-Ok "npx : $npx"

# npx.cmd n'est qu'un lanceur : il appelle « node » et le cherche dans le PATH.
# Trouver le .cmd ne suffit donc pas, il faut aussi rendre node visible.
$dossierNode = Split-Path -Parent $npx
$env:Path = "$dossierNode;$env:Path"
if ($null -eq (Get-Command 'node.exe' -ErrorAction SilentlyContinue)) {
    Write-Host ''
    Write-Host "node.exe est absent de $dossierNode." -ForegroundColor Red
    Write-Host 'L''installation Node de ce poste est incomplète.'
    exit 2
}

$racine = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $racine
Ecrire-Ok "Dépôt : $racine"

$version = & $npx --yes "supabase@$VersionCli" --version | Select-Object -Last 1
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Impossible de lancer la CLI Supabase.' -ForegroundColor Red
    exit 2
}
Ecrire-Ok "CLI Supabase : $version"

# --- Autorisation du poste ----------------------------------------------------
if ($Connexion) {
    Ecrire-Titre 'Autorisation de ce poste'
    Ecrire-Info 'Le navigateur va s''ouvrir. Rien à taper ici.'
    Invoquer-Cli -Npx $npx -Arguments @('login') | Out-Null
    Write-Host ''
    Ecrire-Ok 'Poste autorisé. Relancer avec -Projet test ou -Projet prod.'
    exit 0
}

if ([string]::IsNullOrWhiteSpace($Projet)) {
    Write-Host ''
    Write-Host 'Préciser -Projet test ou -Projet prod (ou -Connexion la première fois).' -ForegroundColor Yellow
    exit 1
}

$ref = $REFS[$Projet]

# --- 3. Les sources sont-elles là ? ------------------------------------------
Ecrire-Titre 'Fonctions à déployer'
$manquantes = @()
foreach ($f in $Fonctions) {
    $index = Join-Path $racine "supabase\functions\$f\index.ts"
    if (Test-Path -LiteralPath $index) {
        Ecrire-Ok $f
    } else {
        $manquantes += $f
        Write-Host "   !!   $f — supabase\functions\$f\index.ts introuvable" -ForegroundColor Red
    }
}
if ($manquantes.Count -gt 0) {
    Write-Host ''
    Write-Host 'Déploiement annulé : sources manquantes.' -ForegroundColor Red
    Write-Host 'Vérifier que la branche du chantier est bien celle qui est extraite.'
    exit 1
}

# --- 4. Le projet visé --------------------------------------------------------
Ecrire-Titre "Projet visé : $($Projet.ToUpper()) ($ref)"
if ($Projet -eq 'prod') {
    Write-Host '   ATTENTION : ceci est la PRODUCTION.' -ForegroundColor Yellow
}
Ecrire-Info 'Le ref est passé explicitement à chaque commande : un projet lié'
Ecrire-Info 'en cache (supabase\.temp) ne peut pas détourner le déploiement.'

Ecrire-Titre 'État actuel des fonctions déployées'
$code = Invoquer-Cli -Npx $npx -Arguments @('functions', 'list', '--project-ref', $ref) -ToleranteALEchec
if ($code -ne 0) {
    Write-Host ''
    Write-Host 'Lecture impossible. Le plus souvent, ce poste n''est pas encore autorisé.' -ForegroundColor Yellow
    Write-Host 'Lancer une fois :' -ForegroundColor Yellow
    Write-Host '    .\outils\deployer-edge-functions.cmd -Connexion' -ForegroundColor Yellow
    exit 3
}

if ($Simulation) {
    Ecrire-Titre 'Simulation'
    Ecrire-Ok 'Tout est en place. Rien n''a été déployé.'
    Ecrire-Info "Pour déployer : .\outils\deployer-edge-functions.cmd -Projet $Projet"
    exit 0
}

# --- 5. Garde-fou production --------------------------------------------------
if ($Projet -eq 'prod') {
    Write-Host ''
    $reponse = Read-Host 'Déploiement en PRODUCTION. Taper PRODUCTION pour confirmer'
    if ($reponse -cne 'PRODUCTION') {
        Write-Host 'Annulé.' -ForegroundColor Yellow
        exit 1
    }
}

# --- 6. Déploiement -----------------------------------------------------------
Ecrire-Titre 'Déploiement'
$arguments = @('functions', 'deploy') + $Fonctions + @('--project-ref', $ref, '--use-api')
Invoquer-Cli -Npx $npx -Arguments $arguments | Out-Null

Ecrire-Titre 'État après déploiement'
Invoquer-Cli -Npx $npx -Arguments @('functions', 'list', '--project-ref', $ref) -ToleranteALEchec | Out-Null

Write-Host ''
Ecrire-Ok "Déploiement terminé sur $($Projet.ToUpper()) ($ref)."
Write-Host ''
Write-Host 'Reste à vérifier, une seule fois par projet, que le secret DEEPL_API_KEY'
Write-Host 'y est bien posé (Tableau de bord > Edge Functions > Secrets), sans quoi'
Write-Host '« traduire » répondra en erreur.'
