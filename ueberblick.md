# Wissens-App — Überblick

## Kurzfassung

Ein selbstgehostetes Notiz- und Wissensverwaltungssystem, das die üblichen Probleme bestehender Apps (Cloud-Zwang, schwache KI-Integration, keine echte Aufgaben-/Kalenderintegration) löst — und optional eine spielerische Oberfläche bekommt: die eigene Wissenssammlung als begehbare Pixel-Art-Bibliothek, in der Ordner zu Räumen, Tags zu Regalen und Notizen zu Büchern werden.

## Das Problem

Bestehende Notiz-Apps (Obsidian, Notion & Co.) haben immer einen Haken: entweder Cloud-Zwang und fragwürdiger Datenschutz, oder keine vernünftige KI-Integration, oder Sync- und Mobil-Probleme, oder alles zusammen. Eine App, die alles davon richtig macht *und* Spaß macht zu benutzen, gibt es nach eigener Recherche schlicht nicht.

## Die Idee

**Basis: eine selbstgehostete, quelloffene Wissensdatenbank** (Trilium Notes) — läuft komplett auf eigener Hardware, keine Abhängigkeit von fremden Servern, mit hierarchischem Notizbaum, Verlinkungen, Labels/Attributen, eigener Sync-Funktion und mobil nutzbarer Weboberfläche.

**Darauf aufgesetzt: ein eigener KI-Assistenzdienst** — durchsucht die eigenen Notizen inhaltlich (nicht nur nach Stichwörtern), beantwortet Fragen anhand der eigenen Wissensbasis, und stellt einen "sokratischen" Lern-Assistenten bereit, der beim Verstehen statt nur beim Nachschlagen hilft. Läuft mit einem selbst gewählten, günstigen KI-Modell — und aus Datenschutzgründen wird noch entschieden, ob das Modell lokal auf eigener Hardware läuft oder bei einem europäischen, DSGVO-konformen Anbieter.

**Aufgaben & Kalender**: ein eigener, selbstgehosteter Kalender-Server (nach offenem Standard, CalDAV) statt Google Kalender — funktioniert mit gängigen freien Apps auf Android, iPad und Desktop, keine Abhängigkeit von einem einzelnen Anbieter.

**Optional, als zweite Ebene: eine spielerische Oberfläche.** Statt nur einer klassischen Ordner-Ansicht kann man seine Wissensbasis als 2D-Pixel-Art-Welt im Seitwärts-Scroller-Stil erkunden — im Stil klassischer Metroidvania-Spiele:

- Jeder Ordner ist ein Raum, jeder Unterordner eine Tür zu einem weiteren Raum (funktioniert bei beliebig tiefer Ordnerstruktur).
- Jedes Tag ist ein Regal, jede Notiz ein Buch mit sichtbarem Buchrücken.
- Ein NPC ("Sokrates") führt sokratische Lerngespräche basierend auf den eigenen Notizen.
- Ein "Questboard" zeigt die eigenen Aufgaben als Quests.
- Später denkbar: Notizen, die man aktiv "pflegen" muss (z. B. absichtlich eingebaute Fehler, die zum erneuten Lesen anregen) — wichtig dabei: die echten Notizen werden dabei *niemals* verändert, das ist reine Spielebene.

Wer nicht spielen möchte, nutzt einfach die normale, "nüchterne" Oberfläche der Notiz-App — die spielerische Ansicht ist ein optionaler Skin auf denselben echten Daten, kein Ersatzsystem.

## Warum das interessant ist

- **Datenhoheit**: alles läuft selbstgehostet, nichts in einer fremden Cloud.
- **Kein oberflächliches Gamification**: keine sinnlose Punktejagd — falls es überhaupt ein Fortschrittssystem gibt, ist es sinnvoll in die eigene Welt eingebettet statt eine separate Statistik-Ebene.
- **Erweiterbar**: Grafik-Pakete ("Texture Packs") lassen sich austauschen, sodass andere eigene Optik beisteuern könnten.
- **Nach eigener Recherche existiert nichts Vergleichbares** — die Kombination aus echter, seriöser Wissensverwaltung und einer strukturell exakt abgebildeten Spielwelt scheint eine echte Lücke zu sein, kein bereits gelöstes Problem.

## Aktueller Stand (Stand: September 2026)

*(Hinweis, Oktober 2026: Dieser Abschnitt ist veraltet. Es gibt inzwischen eine lauffähige erste Version, "Bibliotheca" (v0.1): eine Web-App, die ein Trilium-Notizbuch als begehbare Pixel-Art-Bibliothek und als kletterbaren 3D-Baum zeigt; siehe `README.md` und den Ordner `wiki/`. Der KI-Dienst, Aufgaben/Kalender und Sokrates als echter Gesprächspartner sind noch nicht gebaut.)* Ursprünglicher Stand (September 2026): Reine Planungsphase, noch kein Code geschrieben. Die selbstgehostete Notiz-App wird gerade im Alltag getestet. Die technische Architektur (Backend, KI-Dienst, Kalender, Spieloberfläche, Netzwerkzugriff) ist bereits detailliert durchdacht und dokumentiert. Nächste Schritte: Testserver aufsetzen, dann zuerst den KI-Dienst bauen, danach Aufgaben/Kalender, erst danach die Spieloberfläche — bewusst in dieser Reihenfolge, damit die "langweiligen aber wichtigen" Teile zuverlässig funktionieren, bevor Zeit in die aufwendigere Spieloptik investiert wird.
