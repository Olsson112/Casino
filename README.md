# Kasino 🃏

Det svenska kortspelet Kasino i webbläsaren – spela mot datorn eller med upp till fyra vänner online.

- **Tre spellägen:** Klassiskt kasino, Byggkasino och Krypkasino
- **Online-rum:** skapa ett rum, dela den fyrbokstaviga koden eller länken, upp till 4 spelare
- **Datorspelare** i tre svårighetsgrader (Lätt, Medel, Svår) – fyll lediga platser eller spela solo
- Byggd för mobilen, fungerar även på dator. Tappar du anslutningen kommer du tillbaka till din plats.

## Kör lokalt

Kräver Node 18 eller senare. Inga beroenden behöver installeras.

```bash
npm start            # http://localhost:3000
npm test             # simulerar hundratals bottmatcher och kontrollerar reglerna
node test/online.js  # testar ett onlinerum (servern måste köra; URL=ws://localhost:3000/ws)
```

## Driftsätt på Render (gratis)

1. Logga in på [render.com](https://render.com) med GitHub.
2. **New → Blueprint** och välj det här repot (Render läser `render.yaml`).
   Alternativt **New → Web Service**: start command `node server/index.js`.
3. Klart. Render bygger om automatiskt vid varje push till `main`.

Gratisservern somnar efter en stund utan besökare – första laddningen kan då ta ca 30 sekunder.

Det finns även en `Dockerfile` för Fly.io, Railway eller egen server.

## Struktur

| Fil | Innehåll |
| --- | --- |
| `shared/rules.js` | Regelmotorn – används av både server och klient |
| `server/index.js` | HTTP-server, rum och spelhantering |
| `server/ws.js` | Liten WebSocket-implementation utan beroenden |
| `server/bot.js` | Datorspelarna |
| `public/` | Gränssnittet (HTML, CSS, JS) |

## Regler som används

- Ess 14 i handen / 1 på bordet, Lillan (♠2) 15 / 2, Storan (♦10) 16 / 10, knekt 11, dam 12, kung 13.
- Poäng: flest kort 1, flest spader 1, varje ess 1, Lillan 1, Storan 2, varje tabbe 1. Vid lika om flest kort/spader får ingen poängen.
- Den som tog sist får korten som ligger kvar. Sista draget i given ger ingen tabbe.
- **Byggkasino:** man får bygga till ett värde man har i handen; byggen med flera grupper är låsta; har man ett bygge på bordet måste man behålla ett kort som tar det och får inte lägga ut.
- **Krypkasino:** lägst poäng vinner, och man måste ta om man kan.
- Värden väljer spellängd: en giv, 11, 21 eller 31 poäng. Blir det lika i toppen spelas en giv till.
