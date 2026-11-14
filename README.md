# GameMap Web-App (kostenlos, ohne Mac)

Alles liegt in diesem Ordner. Es gibt keinen Build-Schritt, keinen Account bei den Kartendiensten und kein Tracking.

## Online stellen (GitHub Pages, kostenlos)
1. Auf github.com ein kostenloses Konto erstellen → **New repository** (öffentlich, z. B. `gamemap`).
2. **Add file → Upload files**: alle Dateien dieses Ordners hochladen.
3. **Settings → Pages** → Source: *Deploy from a branch* → Branch `main`, Ordner `/ (root)` → Save.
4. Nach ca. 1 Minute ist die App unter `https://DEIN-NAME.github.io/gamemap/` erreichbar.

## Aufs iPhone
Link in **Safari** öffnen → Teilen-Symbol → **Zum Home-Bildschirm**. Standortzugriff erlauben (nur "Beim Verwenden"). Danach startet sie wie eine App im Vollbild.

## Bedienung
- 🎨 wechselt den Kartenstil, ⌖ springt zu deiner Position
- Suchen oder auf die Karte tippen → **Route** → **Los**
- Während der Navigation bleibt das Display an, Ansagen kommen auf Deutsch

## Technik / Grenzen
- Karte: MapLibre GL JS + OpenFreeMap, Suche: Photon, Routing: öffentlicher Valhalla-Server von openstreetmap.de (fair use, nur für dich und wenige Leute gedacht)
- Position nur zuverlässig bei eingeschaltetem Display (Safari kann im Hintergrund nicht tracken)
- Kein CarPlay
